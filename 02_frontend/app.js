// app.js — 界面逻辑:列表、表单、增删改、导出。
// 依赖 window.StarnetFormat(格式)和 window.Storage(存储)。
// 注:Storage 已改为异步(Tauri 命令是异步的),所有 Storage.* 调用都用 await,
//     相关函数都改成 async。这是套 Tauri 壳唯一需要的界面侧改动(逻辑不变)。

const F = window.StarnetFormat;

// 当前正在编辑的条目 id(null = 新建模式)
let currentId = null;

// ---- DOM 抓取 ----
const el = {
  list: document.getElementById('list'),
  count: document.getElementById('count'),
  empty: document.getElementById('empty'),
  form: document.getElementById('form'),
  placeholder: document.getElementById('placeholder'),
  newBtn: document.getElementById('new-btn'),
  exportBtn: document.getElementById('export-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  status: document.getElementById('status'),
  title: document.getElementById('f-title'),
  type: document.getElementById('f-type'),
  priority: document.getElementById('f-priority'),
  tags: document.getElementById('f-tags'),
  body: document.getElementById('f-body'),
  appliesWrap: document.getElementById('f-applies'),
};

// ---- 渲染左侧列表 ----
async function renderList() {
  const items = await window.Storage.list();
  el.count.textContent = items.length + ' 条';
  el.empty.classList.toggle('hidden', items.length > 0);
  el.list.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'list-item' + (it.id === currentId ? ' active' : '');
    li.dataset.id = it.id;
    const typeLabel = { preference: '偏好', habit: '习惯', 'decision-style': '决策' }[it.type] || it.type;
    li.innerHTML =
      '<div class="it-title"></div>' +
      '<div class="it-meta">' + typeLabel + ' · ' + (it.priority || 'medium') + ' · ' + (it.updated || '') + '</div>';
    li.querySelector('.it-title').textContent = it.title || '(无标题)';
    li.addEventListener('click', () => openItem(it.id));
    el.list.appendChild(li);
  }
}

// ---- 读复选框里勾选的 AI ----
function getAppliesTo() {
  return [...el.appliesWrap.querySelectorAll('input:checked')].map((c) => c.value);
}
function setAppliesTo(arr) {
  const set = new Set(arr || []);
  el.appliesWrap.querySelectorAll('input').forEach((c) => { c.checked = set.has(c.value); });
}

// ---- 标签字符串 <-> 数组 ----
function parseTags(str) {
  return String(str).split(',').map((s) => s.trim()).filter(Boolean);
}

// ---- 显示表单 / 占位 ----
function showForm(show) {
  el.form.classList.toggle('hidden', !show);
  el.placeholder.classList.toggle('hidden', show);
}

// ---- 新建模式:清空表单 ----
async function newItem() {
  currentId = null;
  el.title.value = '';
  el.type.value = 'preference';
  el.priority.value = 'medium';
  el.tags.value = '';
  el.body.value = '';
  setAppliesTo([]);
  el.deleteBtn.classList.add('hidden');
  el.status.textContent = '';
  showForm(true);
  await renderList();
  el.title.focus();
}

// ---- 打开已有条目 ----
async function openItem(id) {
  const got = await window.Storage.get(id);
  if (!got) return;
  const { record, body } = got;
  currentId = id;
  el.title.value = record.title || '';
  el.type.value = record.type || 'preference';
  el.priority.value = record.priority || 'medium';
  el.tags.value = (record.tags || []).join(', ');
  el.body.value = body || '';
  setAppliesTo(record['applies-to']);
  el.deleteBtn.classList.remove('hidden');
  el.status.textContent = '';
  showForm(true);
  await renderList();
}

// ---- 保存(新建或更新)----
async function save(e) {
  e.preventDefault();
  const title = el.title.value.trim();
  if (!title) { flash('标题不能为空'); return; }

  const fields = {
    title,
    type: el.type.value,
    priority: el.priority.value,
    'applies-to': getAppliesTo(),
    tags: parseTags(el.tags.value),
  };
  const body = el.body.value;

  try {
    let record;
    if (currentId == null) {
      // 新建
      const created = F.createRecord({
        type: fields.type, title, body,
        priority: fields.priority, appliesTo: fields['applies-to'], tags: fields.tags,
      });
      record = created.record;
    } else {
      // 更新已有
      const old = (await window.Storage.get(currentId)).record;
      const updated = F.updateRecord(old, { fields, body });
      record = updated.record;
      // 改 title 会让 id 变 → 旧文件名换了,删掉旧的
      if (record.id !== currentId) await window.Storage.remove(currentId);
    }

    await window.Storage.save(record, body);
    currentId = record.id;
    el.deleteBtn.classList.remove('hidden');
    await renderList();
    flash('已保存 ✓');
  } catch (err) {
    flashError('保存失败', err);
  }
}

// ---- 删除 ----
async function del() {
  if (currentId == null) return;
  if (!confirm('删除这条偏好?(会进 trash,不是彻底删)')) return;
  await window.Storage.remove(currentId);
  currentId = null;
  showForm(false);
  await renderList();
}

// ---- 导出当前条目为 .md 文件 ----
async function exportMd() {
  const title = el.title.value.trim();
  if (!title) { flash('先填标题再导出'); return; }
  let record, body = el.body.value;
  if (currentId != null) {
    const old = (await window.Storage.get(currentId)).record;
    record = F.updateRecord(old, {
      fields: {
        title, type: el.type.value, priority: el.priority.value,
        'applies-to': getAppliesTo(), tags: parseTags(el.tags.value),
      },
      body,
    }).record;
  } else {
    record = F.createRecord({
      type: el.type.value, title, body,
      priority: el.priority.value, appliesTo: getAppliesTo(), tags: parseTags(el.tags.value),
    }).record;
  }
  const md = F.buildMarkdown(record, body);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = record.id + '.md';
  a.click();
  URL.revokeObjectURL(a.href);
  flash('已导出 ' + record.id + '.md');
}

// ---- 状态提示一闪 ----
let flashTimer = null;
function flash(msg) {
  el.status.textContent = msg;
  el.status.classList.remove('err');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.status.textContent = ''; }, 2500);
}

// 出错时把报错红字钉在状态栏(不自动消失),方便把真实原因念出来排查
function flashError(prefix, e) {
  const msg = (e && (e.message || e.toString())) || String(e);
  el.status.textContent = prefix + ':' + msg;
  el.status.classList.add('err');
  clearTimeout(flashTimer);
  console.error(prefix, e);
}

// 兜底:任何没被捕获的异步报错也显示出来
window.addEventListener('unhandledrejection', (ev) => {
  flashError('未捕获错误', ev.reason);
});

// 启动自检:把当前运行环境亮出来(Tauri 还是网页),一眼看出走了哪条存储分支
function showEnv() {
  const where = window.STARNET_IN_TAURI ? 'Tauri 桌面(写真实文件)' : '网页(localStorage)';
  el.status.textContent = '运行环境:' + where;
}

// ---- 视图切换(节点图 ⇄ 编辑器)----
// 节点图是灵魂层的"脸",默认打开它;编辑器是写偏好的地方。
const views = {
  graph: document.getElementById('graph-view'),
  editor: document.getElementById('editor-view'),
};
const tabs = {
  graph: document.getElementById('view-graph'),
  editor: document.getElementById('view-editor'),
};

function showView(name) {
  for (const key of Object.keys(views)) {
    const on = key === name;
    views[key].classList.toggle('hidden', !on);
    tabs[key].classList.toggle('active', on);
  }
  // 切到节点图时让它按最新数据重画(可能刚在编辑器里改过)
  if (name === 'graph' && window.StarnetGraph) {
    window.StarnetGraph.render().catch((err) => console.error('节点图渲染失败', err));
  }
}

tabs.graph.addEventListener('click', () => showView('graph'));
tabs.editor.addEventListener('click', () => showView('editor'));

// 暴露给 graph.js:点节点 → 切到编辑器并打开那一条
window.StarnetApp = {
  openItemFromGraph(id) {
    showView('editor');
    openItem(id).catch((err) => flashError('打开失败', err));
  },
};

// ---- 绑定事件 + 启动 ----
el.newBtn.addEventListener('click', () => { showView('editor'); newItem(); });
el.form.addEventListener('submit', save);
el.deleteBtn.addEventListener('click', del);
el.exportBtn.addEventListener('click', exportMd);

// 启动:先亮环境,再渲染列表(渲染失败也把错误显示出来)
showEnv();
renderList().catch((err) => flashError('启动读取失败', err));
