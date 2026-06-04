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

// ──────────────────────────────────────────────────────────────
// 三层叠加打分(1-③ 护城河①核心)
// 对齐数据格式宪法的真实字段:applies-to=哪些agent、context=场景标签、tags=自由标签。
// (产品决策清单把 applies-to 当"项目路径"是旧语义,已被宪法 v3.0 改写,这里按宪法来。)
//
// 三层:
//   1. 全局保底 —— priority 基础分,任何语境都给,保证高优先级偏好不被挤掉
//   2. 语境匹配 —— 当前在干啥(项目语言/文件类型/任务关键词)命中偏好 context → 重加分
//                  "项目路径"和"文件类型"在真实数据里都落到 context/tags,故合一为"语境匹配"
//   3. tag 加分 —— tags 命中 → 轻加分(决策:tag 仅加分项,不主依赖)
//   外加 title 命中小补;recall 这类按词查的场景额外查正文(body=true)。
// ──────────────────────────────────────────────────────────────

const BASE_BY_PRIORITY = { high: 3, medium: 2, low: 1 };

// 给一条记录按一组语境关键词打分。
// signals:小写关键词数组(来自 recall 的 query 或 hook 探测的项目语言)。
// 返回 { score, matched };matched=命中了几处,recall 用它过滤"必须沾边"。
export function scoreRecord(rec, signals = [], { body = false } = {}) {
  let score = BASE_BY_PRIORITY[rec.priority] ?? 2;
  let matched = 0;
  const ctx = rec.context.map((s) => String(s).toLowerCase());
  const tags = rec.tags.map((s) => String(s).toLowerCase());
  const title = rec.title.toLowerCase();
  const bodyText = body ? rec.body.toLowerCase() : '';
  for (const sig of signals) {
    if (!sig) continue;
    if (ctx.includes(sig)) { score += 4; matched++; }
    if (tags.includes(sig)) { score += 2; matched++; }
    if (title.includes(sig)) { score += 1; matched++; }
    if (body && bodyText.includes(sig)) { score += 1; matched++; }
  }
  return { score, matched };
}

// 从工作目录探测"当前语境"关键词:这项目用啥语言/框架。
// 给 hook 自动注入用——会话开始时还不知道在编辑哪个文件,只能用项目整体语言近似。
// (更细的"具体文件类型"要等编辑事件 hook,阶段一先到项目级。)
const SIGNAL_BY_MARKER = {
  'pyproject.toml': ['python'],
  'requirements.txt': ['python'],
  Pipfile: ['python'],
  'Cargo.toml': ['rust'],
  'go.mod': ['go'],
  'pom.xml': ['java'],
  'tsconfig.json': ['typescript'],
};

export function detectSignals(cwd) {
  if (!cwd) return [];
  const out = new Set();
  try {
    const entries = readdirSync(cwd);
    for (const [marker, sigs] of Object.entries(SIGNAL_BY_MARKER)) {
      if (entries.includes(marker)) sigs.forEach((s) => out.add(s));
    }
    if (entries.some((f) => f.endsWith('.py'))) out.add('python');
    if (entries.includes('package.json')) {
      out.add('node');
      out.add('javascript');
      try {
        const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const names = Object.keys(deps);
        for (const f of ['react', 'vue', 'next', 'svelte', 'express', 'tauri', 'typescript']) {
          if (names.some((d) => d.includes(f))) out.add(f);
        }
      } catch {
        // package.json 坏了不影响其它信号
      }
    }
  } catch {
    // 目录读不了就当没有语境信号
  }
  return [...out];
}

// recall:按关键词"按需查"。要求至少沾边(matched>0)才返回,按得分高到低排。
export function recall(query, { agent = 'claude-code', limit = 10 } = {}) {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return [];

  const hits = [];
  for (const r of loadAll()) {
    if (!appliesToAgent(r, agent)) continue;
    const { score, matched } = scoreRecord(r, terms, { body: true });
    if (matched > 0) hits.push({ ...r, score });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, limit);
}

// 会话开头主动注入接口:三层打分取前 limit 条(默认 5,呼应"≤5 条保底")。
// signals = 当前语境关键词(hook 从 cwd 探测)。
// 不传 signals 时只剩 priority 保底分 = 退化成笨排序,向后兼容。
// 注:所有记录都参与(没命中也靠 priority 保底),这跟 recall 的"必须沾边"不同——
// 注入要保证总有 ≤5 条垫底,查询则只回相关的。
export function getActive({ agent = 'claude-code', limit = 5, signals = [] } = {}) {
  const scored = loadAll()
    .filter((r) => appliesToAgent(r, agent))
    .map((r) => ({ ...r, score: scoreRecord(r, signals).score }));
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return scored.slice(0, limit);
}
