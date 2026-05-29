// app.js — 界面逻辑:列表、表单、增删改、导出。
// 依赖 window.StarnetFormat(格式)和 window.Storage(存储)。

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
function renderList() {
  const items = window.Storage.list();
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
function newItem() {
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
  renderList();
  el.title.focus();
}

// ---- 打开已有条目 ----
function openItem(id) {
  const got = window.Storage.get(id);
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
  renderList();
}

// ---- 保存(新建或更新)----
function save(e) {
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
    const old = window.Storage.get(currentId).record;
    const updated = F.updateRecord(old, { fields, body });
    record = updated.record;
    // 改 title 会让 id 变 → 旧文件名换了,删掉旧的(localStorage 版按 id 存)
    if (record.id !== currentId) window.Storage.remove(currentId);
  }

  window.Storage.save(record, body);
  currentId = record.id;
  el.deleteBtn.classList.remove('hidden');
  renderList();
  flash('已保存 ✓');
}

// ---- 删除 ----
function del() {
  if (currentId == null) return;
  if (!confirm('删除这条偏好?(会进 trash,不是彻底删)')) return;
  window.Storage.remove(currentId);
  currentId = null;
  showForm(false);
  renderList();
}

// ---- 导出当前条目为 .md 文件 ----
function exportMd() {
  const title = el.title.value.trim();
  if (!title) { flash('先填标题再导出'); return; }
  let record, body = el.body.value;
  if (currentId != null) {
    const old = window.Storage.get(currentId).record;
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
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.status.textContent = ''; }, 2500);
}

// ---- 绑定事件 + 启动 ----
el.newBtn.addEventListener('click', newItem);
el.form.addEventListener('submit', save);
el.deleteBtn.addEventListener('click', del);
el.exportBtn.addEventListener('click', exportMd);

renderList();
