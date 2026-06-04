// store.js
// 读 ~/.starnet/personal 下的偏好/习惯/决策,解析成统一记录,供 MCP 工具用。
//
// 单一权威:数据格式宪法的代码实现复用偏好编辑器那一份 starnet-format.js,
// 不在这里复制一遍解析逻辑(规矩 A:守简单、不重复)。
//
// 范围(1-②):只"通水管"——读真实文件 + 关键词召回 + 笨排序注入。
// 三层叠加智能打分是护城河①,留给 1-③,这里不做。

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// 复用偏好编辑器的"数据格式宪法代码实现"(CommonJS),单一权威。
const StarnetFormat = require(join(__dirname, '..', '..', '02_frontend', 'starnet-format.js'));

// 星网数据根:默认 ~/.starnet,可用 STARNET_HOME 覆盖(测试/换机用)。
export function starnetHome() {
  return process.env.STARNET_HOME || join(homedir(), '.starnet');
}

// personal 下纳入召回的子目录。
// diary 是阶段二(且非偏好)、workflows 是阶段三,这里都不读。
const PERSONAL_DIRS = ['preferences', 'habits', 'decisions'];

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

// applies-to 过滤:空数组 = 全适用(宪法第五节默认值)。
function appliesToAgent(rec, agent) {
  if (!agent) return true;
  if (!rec.appliesTo || rec.appliesTo.length === 0) return true;
  return rec.appliesTo.includes(agent);
}

// 把宪法 record 收敛成召回用的轻量记录,数组字段做防御性兜底。
function toRecord(parsed, filePath) {
  const r = parsed.record || {};
  return {
    id: r.id,
    type: r.type,
    title: r.title || '',
    priority: PRIORITY_RANK[r.priority] != null ? r.priority : 'medium',
    tags: Array.isArray(r.tags) ? r.tags : [],
    context: Array.isArray(r.context) ? r.context : [],
    appliesTo: Array.isArray(r['applies-to']) ? r['applies-to'] : [],
    body: parsed.body || '',
    filePath,
  };
}

// 读出 personal 下所有偏好/习惯/决策记录。
// 宪法第十一节:坏数据提示不崩——一条解析失败只跳过它,不拖垮整次召回。
export function loadAll() {
  const base = join(starnetHome(), 'personal');
  const out = [];
  for (const sub of PERSONAL_DIRS) {
    const dir = join(base, sub);
    if (!existsSync(dir)) continue;
    let files;
    try {
      files = readdirSync(dir);
    } catch (e) {
      process.stderr.write(`[starnet] 无法读取目录 ${dir}: ${e.message}\n`);
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const filePath = join(dir, f);
      try {
        const parsed = StarnetFormat.parseMarkdown(readFileSync(filePath, 'utf8'));
        out.push(toRecord(parsed, filePath));
      } catch (e) {
        process.stderr.write(`[starnet] 跳过无法解析的文件 ${filePath}: ${e.message}\n`);
      }
    }
  }
  return out;
}

// recall:按关键词召回最相关的几条。
// 命中权重:标题 > 标签 > 场景 > 正文;同分再按优先级。
// 这是"按需查"的实现,不含三层打分(那是 1-③)。
export function recall(query, { agent = 'claude-code', limit = 10 } = {}) {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return [];

  const scored = [];
  for (const r of loadAll()) {
    if (!appliesToAgent(r, agent)) continue;
    const title = r.title.toLowerCase();
    const tags = r.tags.join(' ').toLowerCase();
    const ctx = r.context.join(' ').toLowerCase();
    const body = r.body.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 5;
      if (tags.includes(t)) score += 3;
      if (ctx.includes(t)) score += 2;
      if (body.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ ...r, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.title.localeCompare(b.title)
  );
  return scored.slice(0, limit);
}

// 会话开头主动注入接口:按优先级取前 limit 条(默认 5,呼应"≤5 条保底")。
// 笨排序占位——1-③ 把这里换成按当前任务的三层叠加打分。
export function getActive({ agent = 'claude-code', limit = 5 } = {}) {
  const records = loadAll().filter((r) => appliesToAgent(r, agent));
  records.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.title.localeCompare(b.title)
  );
  return records.slice(0, limit);
}
