/* ============================================================
 * app.js —— 登录页 / 注册页公用逻辑
 * 内容：用户注册、登录、当前用户读写、退出登录、历史成绩读写
 * 数据全部保存在浏览器 localStorage，不发起任何网络请求
 * ============================================================ */

/* ---------- localStorage 中使用的键名（统一在此定义，避免拼写错误） ---------- */
var USERS_KEY = 'users';               // 账号表：{ 用户名: 密码 }
var CURRENT_USER_KEY = 'currentUser';  // 当前登录用户
var RECORDS_KEY = 'records';           // 成绩记录数组

/* ---------- 1. 账号数据读写 ---------- */

// 读取全部用户，返回形如 { '小明': '123456' } 的对象
function getUsers() {
  var data = localStorage.getItem(USERS_KEY);
  if (!data) return {};
  try {
    return JSON.parse(data) || {};
  } catch (e) {
    // 本地数据被破坏时兜底为空对象，避免整个页面报错
    return {};
  }
}

// 保存全部用户
function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

/* ---------- 2. 注册 ---------- */

/**
 * 注册账号
 * @param {string} username 用户名
 * @param {string} password 密码
 * @returns {string} 结果提示文案（"注册成功，请去登录" 表示成功）
 */
function register(username, password) {
  var users = getUsers();
  // 用户名已存在则直接返回提示
  if (Object.prototype.hasOwnProperty.call(users, username)) {
    return '该用户名已存在，请换一个';
  }
  users[username] = password;
  saveUsers(users);
  return '注册成功，请去登录';
}

/* ---------- 3. 登录 / 当前用户 ---------- */

/**
 * 登录校验
 * @returns {string} 结果提示文案（"登录成功" 表示成功）
 */
function login(username, password) {
  var users = getUsers();
  if (!Object.prototype.hasOwnProperty.call(users, username)) {
    return '用户名不存在，请先注册';
  }
  if (users[username] !== password) {
    return '密码错误，请重试';
  }
  // 校验通过，写入当前登录用户
  localStorage.setItem(CURRENT_USER_KEY, username);
  return '登录成功';
}

// 读取当前登录用户名；未登录返回 null
function getCurrentUser() {
  return localStorage.getItem(CURRENT_USER_KEY);
}

// 退出登录：只清除当前用户，账号与历史成绩保留
function logout() {
  localStorage.removeItem(CURRENT_USER_KEY);
}

/* ---------- 4. 成绩记录读写 ---------- */

// 读取全部成绩记录
function getRecords() {
  var data = localStorage.getItem(RECORDS_KEY);
  if (!data) return [];
  try {
    var list = JSON.parse(data);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

/**
 * 新增一条成绩记录
 * @param {number} score   答对题数
 * @param {number} total   总题数
 * @param {number} percent 正确率（整数百分比）
 * @param {string} paper   试卷名称（多套试卷扩展使用，可选）
 */
function addRecord(score, total, percent, paper) {
  var records = getRecords();
  records.push({
    user: getCurrentUser(),
    score: score,
    total: total,
    percent: percent,
    paper: paper || '',
    time: new Date().toLocaleString('zh-CN', { hour12: false })
  });
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

/* ---------- 5. 提示信息辅助函数 ---------- */

/**
 * 在提示区显示文字，并区分成功（绿色）/ 失败（红色）两种颜色
 * @param {HTMLElement} el   提示元素
 * @param {string} text      提示文字
 * @param {boolean} isOk     true 表示成功样式
 */
function showMsg(el, text, isOk) {
  if (!el) return;
  el.textContent = text;
  el.className = 'msg ' + (isOk ? 'success' : 'error');
}

/* ---------- 6. 页面按钮绑定（登录页与注册页共用本文件，按 id 是否存在分别绑定） ---------- */

document.addEventListener('DOMContentLoaded', function () {
  bindRegisterPage();
  bindLoginPage();
});

// 注册页：点击注册按钮时进行三项校验
function bindRegisterPage() {
  var registerBtn = document.getElementById('registerBtn');
  if (!registerBtn) return; // 当前不是注册页，直接返回

  var usernameInput = document.getElementById('regUsername');
  var passwordInput = document.getElementById('regPassword');
  var confirmInput = document.getElementById('regConfirm');
  var msg = document.getElementById('regMsg');

  function doRegister() {
    var username = usernameInput.value.trim();
    var password = passwordInput.value;
    var confirmPwd = confirmInput.value;

    // 校验一：用户名与密码不能为空
    if (!username || !password) {
      showMsg(msg, '请填写完整的用户名和密码', false);
      return;
    }
    // 校验二：两次密码必须一致
    if (password !== confirmPwd) {
      showMsg(msg, '两次输入的密码不一致', false);
      return;
    }
    // 校验三：用户名不能重复（在 register 内部判断）
    var result = register(username, password);
    var isOk = result === '注册成功，请去登录';
    showMsg(msg, result + (isOk ? '，正在跳转…' : ''), isOk);

    if (isOk) {
      // 稍作停留让用户看清提示，再跳转到登录页
      setTimeout(function () {
        window.location.href = 'login.html';
      }, 900);
    }
  }

  registerBtn.addEventListener('click', doRegister);
  // 支持回车键提交，提升使用体验
  [usernameInput, passwordInput, confirmInput].forEach(function (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doRegister();
    });
  });
}

// 登录页：点击登录按钮时校验并跳转答题页
function bindLoginPage() {
  var loginBtn = document.getElementById('loginBtn');
  if (!loginBtn) return; // 当前不是登录页，直接返回

  var usernameInput = document.getElementById('loginUsername');
  var passwordInput = document.getElementById('loginPassword');
  var msg = document.getElementById('loginMsg');

  function doLogin() {
    var username = usernameInput.value.trim();
    var password = passwordInput.value;

    // 校验：用户名与密码非空
    if (!username || !password) {
      showMsg(msg, '请输入用户名和密码', false);
      return;
    }

    var result = login(username, password);
    var isOk = result === '登录成功';
    showMsg(msg, isOk ? '登录成功，正在进入答题页…' : result, isOk);

    if (isOk) {
      setTimeout(function () {
        window.location.href = 'quiz.html';
      }, 500);
    }
  }

  loginBtn.addEventListener('click', doLogin);
  [usernameInput, passwordInput].forEach(function (input) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doLogin();
    });
  });
}
