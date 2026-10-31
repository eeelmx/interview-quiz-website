/* ============================================================
 * quiz.js —— 答题页逻辑
 * 负责：未登录拦截、逐题渲染、上一题/下一题切换、答案即时保存与回显、
 *       每题限时（倒计时）、判分、逐题对错回看、成绩记录、错题本、
 *       多套试卷切换、重新作答、退出登录
 * 说明：本文件不依赖 app.js（quiz.html 只引入 questions.js 与 quiz.js），
 *       因此把用到的本地存储读写、成绩记录、退出登录函数在此处独立实现。
 * ============================================================ */

(function () {
  'use strict';

  /* ================= 一、常量与状态 ================= */

  // localStorage 键名
  var KEY_CURRENT_USER = 'currentUser';   // 当前登录用户（与 app.js 保持一致）
  var KEY_RECORDS = 'records';            // 成绩记录（与 app.js 保持一致）
  var KEY_ANSWERS = 'answers';            // 需求文档规定的已选答案数组
  var KEY_PAPER = 'paperId';              // 当前试卷 id
  var KEY_WRONG = 'wrongQuestions';       // 本次答错的题下标
  var KEY_WRONG_PAPER = 'wrongPaper';     // 错题所属试卷 id
  var KEY_WRONG_SNAP = 'wrongSnapshot';   // 错题的作答快照（含“你的答案”）
  var KEY_TIMER_ON = 'timerOn';           // 是否开启每题限时

  var LIMIT_SECONDS = 30;                 // 每题限时秒数

  // 运行状态
  var activePaper = null;      // 当前试卷对象
  var activeQuestions = [];    // 当前试卷的题目数组
  var index = 0;               // 当前题号（0 开始）
  var answers = [];            // 已选答案下标数组（-1 表示未选）
  var submitted = false;       // 当前试卷是否已提交
  var timerOn = true;          // 是否开启倒计时
  var timerId = null;          // 倒计时定时器
  var remaining = LIMIT_SECONDS; // 当前题剩余秒数

  /* ================= 二、工具函数 ================= */

  // 转义 HTML，避免题干或用户名中的特殊字符破坏页面结构
  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 选项字母标识
  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  // 读取 JSON，解析失败时返回默认值
  function readJSON(key, fallback) {
    var raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
      var value = JSON.parse(raw);
      return value === null || value === undefined ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // 当前登录用户
  function currentUser() {
    return localStorage.getItem(KEY_CURRENT_USER);
  }

  // 轻提示
  var toastTimer = null;
  function toast(text) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, 1900);
  }

  /* ================= 三、本地存储：答案 / 成绩 / 错题 ================= */

  // 当前试卷的答案存储键（每套试卷各存一份，互不覆盖）
  function answersKey() {
    return 'answers_' + activePaper.id;
  }

  // 当前试卷的“已提交”标记键
  function submittedKey() {
    return 'submitted_' + activePaper.id;
  }

  /**
   * 读取当前试卷的答案数组
   * 优先读该试卷专属键；首次进入时兼容读取需求文档规定的 answers 键
   */
  function loadAnswers() {
    var saved = readJSON(answersKey(), null);
    if (!saved) saved = readJSON(KEY_ANSWERS, null);
    if (Array.isArray(saved) && saved.length === activeQuestions.length) {
      return saved.slice();
    }
    // 没有历史答案，或题目数量已变化，则生成全为 -1 的新数组
    return new Array(activeQuestions.length).fill(-1);
  }

  // 把答案写入本地存储（同时维护需求文档规定的 answers 键）
  function persistAnswers() {
    writeJSON(answersKey(), answers);
    writeJSON(KEY_ANSWERS, answers);
    localStorage.setItem(KEY_PAPER, activePaper.id);
  }

  // 读取成绩记录
  function readRecords() {
    var list = readJSON(KEY_RECORDS, []);
    return Array.isArray(list) ? list : [];
  }

  // 新增一条成绩记录
  function addRecord(score, total, percent) {
    var records = readRecords();
    records.push({
      user: currentUser(),
      score: score,
      total: total,
      percent: percent,
      paper: activePaper.name,
      time: new Date().toLocaleString('zh-CN', { hour12: false })
    });
    writeJSON(KEY_RECORDS, records);
  }

  /* ================= 四、初始化 ================= */

  document.addEventListener('DOMContentLoaded', function () {
    // 4.1 未登录拦截：没有 currentUser 一律退回登录页
    if (!currentUser()) {
      window.location.replace('login.html');
      return;
    }

    // 4.2 数据文件缺失保护（例如 questions.js 未正确引入）
    if (typeof papers === 'undefined' || !papers.length) {
      document.getElementById('questionArea').innerHTML =
        '<p class="empty-tip">题库加载失败，请确认 questions.js 与 quiz.html 在同一目录下。</p>';
      return;
    }

    // 4.3 欢迎语
    document.getElementById('welcome').textContent =
      '你好，' + currentUser() + '，祝你答题顺利！';

    // 4.4 恢复倒计时开关偏好
    timerOn = localStorage.getItem(KEY_TIMER_ON) !== '0';
    document.getElementById('timerToggle').checked = timerOn;

    // 4.5 恢复试卷
    activePaper = findPaper(localStorage.getItem(KEY_PAPER)) || papers[0];
    activeQuestions = activePaper.questions;
    answers = loadAnswers();
    submitted = localStorage.getItem(submittedKey()) === '1';

    initPaperSelect();
    bindEvents();

    // 4.6 已提交过则直接回看结果，否则继续作答
    if (submitted) {
      renderResult(computeResult());
    } else {
      index = firstUnansweredIndex();
      renderQuestion();
    }
  });

  // 根据 id 找试卷
  function findPaper(id) {
    if (!id) return null;
    for (var i = 0; i < papers.length; i++) {
      if (papers[i].id === id) return papers[i];
    }
    return null;
  }

  // 找到第一道未作答的题，用于刷新后继续作答
  function firstUnansweredIndex() {
    for (var i = 0; i < answers.length; i++) {
      if (answers[i] === -1) return i;
    }
    return 0;
  }

  /* ================= 五、试卷选择（多套试卷扩展） ================= */

  function initPaperSelect() {
    var select = document.getElementById('paperSelect');
    var html = '';
    for (var i = 0; i < papers.length; i++) {
      html += '<option value="' + esc(papers[i].id) + '">' + esc(papers[i].name) + '</option>';
    }
    select.innerHTML = html;
    select.value = activePaper.id;
  }

  // 切换试卷：保存当前答案，载入目标试卷的进度
  function switchPaper(paperId) {
    var target = findPaper(paperId);
    if (!target || target.id === activePaper.id) return;

    stopTimer();
    persistAnswers(); // 先把当前试卷的选择存好

    activePaper = target;
    activeQuestions = target.questions;
    answers = loadAnswers();
    submitted = localStorage.getItem(submittedKey()) === '1';
    localStorage.setItem(KEY_PAPER, activePaper.id);

    document.getElementById('scoreMsg').innerHTML = '';
    document.getElementById('restartRow').style.display = 'none';
    document.getElementById('questionArea').style.display = '';

    if (submitted) {
      renderResult(computeResult());
    } else {
      index = firstUnansweredIndex();
      renderQuestion();
    }
  }

  /* ================= 六、题目渲染 ================= */

  // 渲染第 index 题
  function renderQuestion() {
    var q = activeQuestions[index];
    var total = activeQuestions.length;
    var area = document.getElementById('questionArea');
    var html = '';

    // 题号 + 倒计时
    html += '<div class="q-head">';
    html += '<span class="q-progress">第 ' + (index + 1) + ' / ' + total + ' 题</span>';
    if (timerOn) {
      html += '<span class="q-timer" id="timerText">' + LIMIT_SECONDS + ' 秒</span>';
    }
    html += '</div>';

    // 进度条
    html += '<div class="progress"><i style="width:' + ((index + 1) / total * 100) + '%"></i></div>';

    // 题干
    html += '<p class="q-text">' + esc(q.title) + '</p>';

    // 4 个选项
    for (var i = 0; i < q.options.length; i++) {
      var checked = answers[index] === i;
      html += '<label class="option' + (checked ? ' selected' : '') + '">';
      html += '<input type="radio" name="answer" value="' + i + '"' + (checked ? ' checked' : '') + '>';
      html += '<span class="opt-flag">' + LETTERS[i] + '</span>';
      html += '<span class="opt-text">' + esc(q.options[i]) + '</span>';
      html += '</label>';
    }

    area.innerHTML = html;
    area.style.display = '';

    // 选项变化：立即写入本地存储（保证切题、刷新后答案不丢）
    var radios = area.querySelectorAll('input[name="answer"]');
    for (var k = 0; k < radios.length; k++) {
      radios[k].addEventListener('change', onOptionChange);
    }

    updateControls();
    restartTimer();
  }

  // 选中某个选项
  function onOptionChange(event) {
    var value = Number(event.target.value);
    answers[index] = value;
    persistAnswers(); // 即时保存

    // 更新卡片选中样式
    var options = document.querySelectorAll('#questionArea .option');
    for (var i = 0; i < options.length; i++) {
      options[i].classList.toggle('selected', i === value);
    }
  }

  // 根据当前题号控制按钮显示
  function updateControls() {
    var total = activeQuestions.length;
    var prevBtn = document.getElementById('prevBtn');
    var nextBtn = document.getElementById('nextBtn');
    var submitBtn = document.getElementById('submitBtn');
    var restartRow = document.getElementById('restartRow');

    restartRow.style.display = 'none';
    prevBtn.style.display = index > 0 ? '' : 'none';

    if (index < total - 1) {
      nextBtn.style.display = '';
      submitBtn.style.display = 'none';
    } else {
      // 最后一题：不再显示“下一题”，改为显示“提交”
      nextBtn.style.display = 'none';
      submitBtn.style.display = '';
    }
  }

  /* ================= 七、每题倒计时（扩展） ================= */

  function restartTimer() {
    stopTimer();
    if (!timerOn || submitted) return;
    remaining = LIMIT_SECONDS;
    paintTimer();
    timerId = setInterval(function () {
      remaining--;
      paintTimer();
      if (remaining <= 0) {
        stopTimer();
        handleTimeout();
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function paintTimer() {
    var el = document.getElementById('timerText');
    if (!el) return;
    el.textContent = remaining + ' 秒';
    el.classList.toggle('warning', remaining <= 10);
  }

  // 超时处理：自动进入下一题；已是最后一题则自动提交
  function handleTimeout() {
    if (submitted) return;
    if (index < activeQuestions.length - 1) {
      index++;
      renderQuestion();
      toast('本题已超时，自动进入下一题（未答按错误计分）');
    } else {
      submitQuiz(true);
      toast('本题已超时，已自动提交答卷');
    }
  }

  /* ================= 八、判分与结果回看 ================= */

  // 计算成绩与逐题结果
  function computeResult() {
    var right = 0;
    var detail = [];
    for (var i = 0; i < activeQuestions.length; i++) {
      var picked = typeof answers[i] === 'number' ? answers[i] : -1;
      var ok = picked === activeQuestions[i].answer;
      if (ok) right++;
      detail.push({ index: i, picked: picked, ok: ok });
    }
    var total = activeQuestions.length;
    return {
      right: right,
      total: total,
      percent: total ? Math.round(right / total * 100) : 0,
      detail: detail
    };
  }

  // 提交答卷：判分 → 写入成绩 → 写入错题 → 展示结果
  function submitQuiz(isAuto) {
    stopTimer();
    var res = computeResult();

    submitted = true;
    localStorage.setItem(submittedKey(), '1');
    persistAnswers();

    // 成绩记录（扩展功能一）
    addRecord(res.right, res.total, res.percent);

    // 错题本（扩展功能二）：记录本次答错的题
    var wrongIndexes = [];
    var snapshot = [];
    for (var i = 0; i < res.detail.length; i++) {
      if (!res.detail[i].ok) {
        wrongIndexes.push(res.detail[i].index);
        snapshot.push({ i: res.detail[i].index, picked: res.detail[i].picked });
      }
    }
    writeJSON(KEY_WRONG, wrongIndexes);
    writeJSON(KEY_WRONG_SNAP, snapshot);
    localStorage.setItem(KEY_WRONG_PAPER, activePaper.id);

    renderResult(res, isAuto);
  }

  // 展示成绩与逐题对错（提交后与刷新回看共用）
  function renderResult(res, isAuto) {
    var area = document.getElementById('questionArea');
    area.innerHTML = '';
    area.style.display = 'none';

    document.getElementById('prevBtn').style.display = 'none';
    document.getElementById('nextBtn').style.display = 'none';
    document.getElementById('submitBtn').style.display = 'none';
    document.getElementById('restartRow').style.display = '';

    var now = new Date().toLocaleString('zh-CN', { hour12: false });
    var html = '';
    html += '<div class="result-head">';
    html += '<p class="score-text">答题完成：答对 ' + res.right + ' / ' + res.total + ' 题</p>';
    html += '<p class="score-sub">正确率 ' + res.percent + '%　·　' + esc(activePaper.name) +
            '　·　' + (isAuto ? '超时自动提交　·　' : '') + now + '</p>';
    html += '</div>';
    html += '<ul class="result-list">';

    for (var i = 0; i < res.detail.length; i++) {
      var d = res.detail[i];
      var q = activeQuestions[d.index];
      var yourText = d.picked >= 0
        ? (LETTERS[d.picked] + '. ' + esc(q.options[d.picked]))
        : '未作答';
      html += '<li class="result-item ' + (d.ok ? 'ok' : 'no') + '">';
      html += '<p class="ri-title"><span class="mark ' + (d.ok ? 'ok' : 'no') + '">' +
              (d.ok ? '对' : '错') + '</span> ' + (d.index + 1) + '. ' + esc(q.title) + '</p>';
      html += '<p class="ri-line">你的答案：' + yourText + '</p>';
      html += '<p class="ri-line">正确答案：' + LETTERS[q.answer] + '. ' + esc(q.options[q.answer]) + '</p>';
      html += '</li>';
    }
    html += '</ul>';

    document.getElementById('scoreMsg').innerHTML = html;
  }

  /* ================= 九、历史成绩 / 错题本（扩展） ================= */

  function openPanel(title, bodyHtml) {
    document.getElementById('panelTitle').textContent = title;
    document.getElementById('panelBody').innerHTML = bodyHtml;
    document.getElementById('panel').hidden = false;
  }

  function closePanel() {
    document.getElementById('panel').hidden = true;
  }

  // 历史成绩：只展示当前登录用户自己的记录，最新的排在最前面
  function showRecords() {
    var records = readRecords().filter(function (r) {
      return r.user === currentUser();
    });
    var html = '';
    if (!records.length) {
      html = '<p class="empty-tip">暂无成绩记录，先提交一次答卷吧。</p>';
    } else {
      for (var i = records.length - 1; i >= 0; i--) {
        var r = records[i];
        html += '<div class="record-item">';
        html += '<div class="record-top"><span>答对 ' + r.score + ' / ' + r.total +
                '　正确率 <em>' + r.percent + '%</em></span></div>';
        html += '<p class="record-time">' + esc(r.paper || '') + '　' + esc(r.time) + '</p>';
        html += '</div>';
      }
    }
    openPanel('历史成绩（' + records.length + ' 条）', html);
  }

  // 错题本：展示上一次提交时答错的题目、你的答案与正确答案
  function showWrong() {
    var wrongIndexes = readJSON(KEY_WRONG, []);
    var snapshot = readJSON(KEY_WRONG_SNAP, null);
    var paperId = localStorage.getItem(KEY_WRONG_PAPER);
    var paper = findPaper(paperId) || papers[0];
    var list = paper.questions;

    if (!Array.isArray(wrongIndexes) || !wrongIndexes.length) {
      openPanel('错题本', '<p class="empty-tip">暂无错题，继续保持！</p>');
      return;
    }

    var html = '<p class="result-item" style="border:none;padding:0 0 10px;">' +
               '来自：' + esc(paper.name) + '（共 ' + wrongIndexes.length + ' 道错题）</p>';

    for (var n = 0; n < wrongIndexes.length; n++) {
      var qi = wrongIndexes[n];
      var q = list[qi];
      if (!q) continue;
      // 优先从快照中取“你的答案”，没有快照时只显示正确答案
      var picked = -1;
      if (Array.isArray(snapshot)) {
        for (var s = 0; s < snapshot.length; s++) {
          if (snapshot[s].i === qi) { picked = snapshot[s].picked; break; }
        }
      }
      var yourText = picked >= 0 ? (LETTERS[picked] + '. ' + esc(q.options[picked])) : '未作答';
      html += '<div class="result-item no">';
      html += '<p class="ri-title"><span class="mark no">错</span> ' + (qi + 1) + '. ' + esc(q.title) + '</p>';
      html += '<p class="ri-line">你的答案：' + yourText + '</p>';
      html += '<p class="ri-line">正确答案：' + LETTERS[q.answer] + '. ' + esc(q.options[q.answer]) + '</p>';
      html += '</div>';
    }

    openPanel('错题本', html);
  }

  /* ================= 十、事件绑定 ================= */

  function bindEvents() {
    // 下一题
    document.getElementById('nextBtn').addEventListener('click', function () {
      if (answers[index] === -1) {
        alert('请先选择一个答案再继续');
        return;
      }
      if (index < activeQuestions.length - 1) {
        index++;
        renderQuestion();
      }
    });

    // 上一题（可自由来回切换，已选答案自动回显）
    document.getElementById('prevBtn').addEventListener('click', function () {
      if (index > 0) {
        index--;
        renderQuestion();
      }
    });

    // 提交答卷
    document.getElementById('submitBtn').addEventListener('click', function () {
      var unanswered = 0;
      for (var i = 0; i < answers.length; i++) {
        if (answers[i] === -1) unanswered++;
      }
      var tip = unanswered > 0
        ? '还有 ' + unanswered + ' 道题未作答，未作答按错误计分。确定提交吗？'
        : '确定提交答卷并查看成绩吗？';
      if (!window.confirm(tip)) return;
      submitQuiz(false);
    });

    // 再答一次：清空本试卷答案与提交标记
    document.getElementById('restartBtn').addEventListener('click', function () {
      if (!window.confirm('将清空本试卷的作答记录并重新开始，确定吗？')) return;
      answers = new Array(activeQuestions.length).fill(-1);
      index = 0;
      submitted = false;
      localStorage.removeItem(submittedKey());
      persistAnswers();
      document.getElementById('scoreMsg').innerHTML = '';
      document.getElementById('restartRow').style.display = 'none';
      renderQuestion();
      toast('已重置，开始新一轮作答');
    });

    // 历史成绩
    document.getElementById('recordsBtn').addEventListener('click', showRecords);

    // 错题本
    document.getElementById('wrongBtn').addEventListener('click', showWrong);

    // 关闭面板
    document.getElementById('panelClose').addEventListener('click', closePanel);
    document.getElementById('panel').addEventListener('click', function (e) {
      if (e.target.id === 'panel') closePanel();
    });

    // 切换试卷
    document.getElementById('paperSelect').addEventListener('change', function (e) {
      switchPaper(e.target.value);
    });

    // 倒计时开关
    document.getElementById('timerToggle').addEventListener('change', function (e) {
      timerOn = e.target.checked;
      localStorage.setItem(KEY_TIMER_ON, timerOn ? '1' : '0');
      if (submitted) {
        stopTimer();
        return;
      }
      renderQuestion(); // 重新渲染以显示/隐藏倒计时
      toast(timerOn ? '已开启每题限时 ' + LIMIT_SECONDS + ' 秒' : '已关闭倒计时');
    });

    // 退出登录
    document.getElementById('logoutBtn').addEventListener('click', function () {
      localStorage.removeItem(KEY_CURRENT_USER);
      window.location.replace('login.html');
    });
  }
})();
