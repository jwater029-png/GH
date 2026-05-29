// starnet-format.js
// 数据格式宪法的代码实现。后面所有批次都复用这个文件。
// 宪法来源:01_docs/03_WORKING_PLAN/参考文档/星网_数据格式宪法.md
//
// 职责:id 生成、slug 生成、frontmatter 拼装/解析、字段顺序锁死、默认值、updated 刷新。
// 不依赖任何第三方库(规矩 A:纯 JS,不引框架)。

// ---- 类型 ↔ 前缀(宪法第三节)----
const TYPE_PREFIX = {
  preference: 'pref',
  habit: 'habit',
  'decision-style': 'decision',
  workflow: 'workflow',
  node: 'node',
};

const VALID_TYPES = Object.keys(TYPE_PREFIX);

// frontmatter 字段顺序锁死(宪法第十一节写入清单)
const FIELD_ORDER = [
  'id', 'type', 'title', 'created', 'updated',
  'applies-to', 'context', 'priority', 'tags', 'extra',
];

// 默认值(宪法第五节)
const DEFAULTS = {
  'applies-to': [], // 空 = 全适用
  context: [],
  priority: 'medium',
  tags: [],
  extra: {},
};

// ---- 工具:今天的 ISO 日期(本地)----
function today() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---- slug 生成(宪法第三节)----
// 默认保留中文,标点/空格转横线。需要拼音时另配,这一版不背拼音库(奥卡姆剃刀)。
function slugify(title) {
  return String(title)
    .trim()
    .toLowerCase()
    // 把不是字母/数字/中文的字符都转成横线
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '') // 去掉首尾横线
    || 'untitled';
}

// ---- short uuid:4 位 [0-9a-z](宪法第三节)----
function shortUuid() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

// ---- 生成 id:<前缀>-<slug>-<uuid> ----
function makeId(type, title, uuid) {
  const prefix = TYPE_PREFIX[type];
  if (!prefix) throw new Error(`未知类型: ${type}`);
  return `${prefix}-${slugify(title)}-${uuid || shortUuid()}`;
}

// ---- 从已有 id 里取出 4 位 uuid 后缀(改 title 时保留它)----
function uuidFromId(id) {
  const m = String(id).match(/-([a-z0-9]{4})$/);
  return m ? m[1] : null;
}

// ====================================================================
// frontmatter 序列化 / 解析
// 不引 YAML 库:我们的 frontmatter 形状固定且简单(标量、数组、空对象)。
// 自己实现这一小块,守住"不引框架/不背重依赖"。复杂度上来再换成成熟库。
// ====================================================================

// 把一个值写成 YAML 片段
function dumpValue(v) {
  if (Array.isArray(v)) {
    // 数组写成 [a, b, c];空数组写 []
    return '[' + v.map((x) => dumpScalar(x)).join(', ') + ']';
  }
  if (v && typeof v === 'object') {
    // 这一版只支持空对象 extra: {};非空对象暂不展开(留给后面批次)
    return Object.keys(v).length === 0 ? '{}' : JSON.stringify(v);
  }
  return dumpScalar(v);
}

// 标量:数字/布尔直出;字符串只在必要时加引号
function dumpScalar(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  // 含特殊字符就加双引号,避免 YAML 歧义
  if (s === '' || /[:#\[\]{}",&*!|>'%@`]/.test(s) || /^\s|\s$/.test(s)) {
    return '"' + s.replace(/"/g, '\\"') + '"';
  }
  return s;
}

// 把一条记录(对象 + body)拼成完整 markdown 文本
// record: { id, type, title, created, updated, 'applies-to', context, priority, tags, extra, ...其他 }
// body:   正文字符串
function buildMarkdown(record, body) {
  const lines = ['---'];
  const seen = new Set();
  // 先按锁死顺序写
  for (const key of FIELD_ORDER) {
    if (key in record) {
      lines.push(`${key}: ${dumpValue(record[key])}`);
      seen.add(key);
    }
  }
  // 其他未知字段排在 extra 之后(宪法第十一节:...→ extra → 其他)
  for (const key of Object.keys(record)) {
    if (!seen.has(key)) {
      lines.push(`${key}: ${dumpValue(record[key])}`);
    }
  }
  lines.push('---', '', String(body || '').trim(), '');
  return lines.join('\n');
}

// 解析一个 YAML 标量片段(去引号、转数字/布尔)
function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' ) return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // 去引号
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"');
  }
  return s;
}

// 解析一行的值:可能是数组 [..]、空对象 {}、或标量
function parseValue(raw) {
  const s = raw.trim();
  if (s === '{}') return {};
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    // 简单按逗号分割(我们的数组元素不含逗号)
    return inner.split(',').map((x) => parseScalar(x));
  }
  return parseScalar(s);
}

// 把完整 markdown 文本解析回 { record, body }
// 宪法第十一节:YAML 解析失败要提示而不是崩;未知字段进 extra 不丢。
function parseMarkdown(text) {
  const str = String(text);
  const m = str.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) {
    throw new Error('frontmatter 格式不合法:找不到 --- 包裹的头部');
  }
  const [, head, body] = m;
  const record = {};
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1);
    record[key] = parseValue(val);
  }
  // 补默认值(宪法第五节;老文件缺字段时给默认值)
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in record)) {
      record[key] = Array.isArray(DEFAULTS[key]) ? [...DEFAULTS[key]]
        : (typeof DEFAULTS[key] === 'object' ? { ...DEFAULTS[key] } : DEFAULTS[key]);
    }
  }
  return { record, body: body.trim() };
}

// ====================================================================
// 高层 helper:新建 / 更新一条记录
// ====================================================================

// 新建:用户填 { type, title, body, priority?, appliesTo?, tags?, context? }
// 返回 { record, body, filename }
function createRecord(input) {
  const type = input.type;
  if (!VALID_TYPES.includes(type)) throw new Error(`未知类型: ${type}`);
  const t = today();
  const uuid = shortUuid();
  const record = {
    id: makeId(type, input.title, uuid),
    type,
    title: input.title,
    created: t,
    updated: t,
    'applies-to': input.appliesTo || [...DEFAULTS['applies-to']],
    context: input.context || [...DEFAULTS.context],
    priority: input.priority || DEFAULTS.priority,
    tags: input.tags || [...DEFAULTS.tags],
    extra: {},
  };
  return { record, body: input.body || '', filename: record.id + '.md' };
}

// 更新:改了 title 时 slug 跟着变但保留 uuid 后缀;updated 自动刷新(宪法第十一节)
// 返回 { record, body, filename }
function updateRecord(oldRecord, changes) {
  const record = { ...oldRecord, ...changes.fields };
  // title 变了 → 重算 id 的 slug,保留原 uuid
  if (changes.fields && 'title' in changes.fields) {
    const uuid = uuidFromId(oldRecord.id) || shortUuid();
    record.id = makeId(record.type, record.title, uuid);
  }
  record.updated = today();
  return { record, body: changes.body != null ? changes.body : '', filename: record.id + '.md' };
}

// ---- 导出(同时支持浏览器全局和模块)----
const StarnetFormat = {
  TYPE_PREFIX, VALID_TYPES, FIELD_ORDER, DEFAULTS,
  today, slugify, shortUuid, makeId, uuidFromId,
  buildMarkdown, parseMarkdown, createRecord, updateRecord,
};

if (typeof window !== 'undefined') window.StarnetFormat = StarnetFormat;
if (typeof module !== 'undefined' && module.exports) module.exports = StarnetFormat;
