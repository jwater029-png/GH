// test.js
// store.js 冒烟测试。自建临时 fixture(不依赖你机器上的真实 ~/.starnet 数据),跑完即清理。
// 覆盖:读取/坏文件跳过、recall 关键词查、applies-to 过滤、三层打分按语境挑对、detectSignals 探测语境。

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 必须在 import store.js 之前设好 STARNET_HOME
const FIX = mkdtempSync(join(tmpdir(), 'starnet-test-'));
process.env.STARNET_HOME = FIX;

function writeMd(sub, name, fm, body) {
  const dir = join(FIX, 'personal', sub);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `---\n${fm.join('\n')}\n---\n\n${body}\n`, 'utf8');
}

writeMd(
  'preferences',
  'pref-pytest-style-aaaa.md',
  ['id: pref-pytest-style-aaaa', 'type: preference', 'title: 用 pytest 写测试', 'created: 2026-05-30', 'updated: 2026-05-30', 'applies-to: []', 'context: [testing, python]', 'priority: high', 'tags: [test, pytest]', 'extra: {}'],
  '我习惯用 pytest,不用 unittest。'
);
writeMd(
  'habits',
  'habit-naming-bbbb.md',
  ['id: habit-naming-bbbb', 'type: habit', 'title: 命名用 snake_case', 'created: 2026-05-30', 'updated: 2026-05-30', 'applies-to: []', 'context: [naming]', 'priority: medium', 'tags: [naming, style]', 'extra: {}'],
  '变量函数都用 snake_case,讨厌缩写。'
);
writeMd(
  'preferences',
  'pref-react-fc-dddd.md',
  ['id: pref-react-fc-dddd', 'type: preference', 'title: React 用函数组件', 'created: 2026-05-30', 'updated: 2026-05-30', 'applies-to: []', 'context: [react, frontend]', 'priority: medium', 'tags: [react, css]', 'extra: {}'],
  '前端一律函数组件 + hooks,不写 class 组件。'
);
writeMd(
  'decisions',
  'decision-cursor-only-cccc.md',
  ['id: decision-cursor-only-cccc', 'type: decision-style', 'title: 只给 cursor 的决策', 'created: 2026-05-30', 'updated: 2026-05-30', 'applies-to: [cursor]', 'context: []', 'priority: low', 'tags: [misc]', 'extra: {}'],
  '这条只对 cursor 生效。'
);
// 坏文件:不该拖垮整次读取
mkdirSync(join(FIX, 'personal', 'preferences'), { recursive: true });
writeFileSync(join(FIX, 'personal', 'preferences', 'broken.md'), '没有 frontmatter 的烂文件', 'utf8');

const { loadAll, recall, getActive, scoreRecord, detectSignals } = await import('./store.js');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; process.stdout.write(`  ✅ ${name}\n`); }
  else { fail++; process.stdout.write(`  ❌ ${name}\n`); }
}

try {
  const all = loadAll();
  check('loadAll 读到 4 条好记录(坏文件被跳过)', all.length === 4);

  // ── recall(按需查)──
  check('recall("pytest") 命中 pytest', recall('pytest').some((h) => h.id === 'pref-pytest-style-aaaa'));
  check('recall("react") 命中 react 偏好', recall('react').some((h) => h.id === 'pref-react-fc-dddd'));
  check('recall("unittest") 能查到正文里的词', recall('unittest').some((h) => h.id === 'pref-pytest-style-aaaa'));
  check('recall 空串返回空且不报错', recall('').length === 0);
  check('recall 不存在的词返回空', recall('zzz不存在xyz').length === 0);
  check('applies-to=[cursor] 对 claude-code 不召回', !recall('决策', { agent: 'claude-code' }).some((h) => h.id === 'decision-cursor-only-cccc'));
  check('同一条对 cursor 能召回', recall('决策', { agent: 'cursor' }).some((h) => h.id === 'decision-cursor-only-cccc'));

  // ── scoreRecord(三层打分)──
  const pytestRec = all.find((r) => r.id === 'pref-pytest-style-aaaa');
  check('scoreRecord:语境命中(python)比无语境得分高', scoreRecord(pytestRec, ['python']).score > scoreRecord(pytestRec, []).score);
  check('scoreRecord:high 基础分 > low 基础分', scoreRecord(pytestRec, []).score > scoreRecord(all.find((r) => r.id === 'decision-cursor-only-cccc'), []).score);

  // ── getActive 带语境(护城河①的核心:按语境挑对)──
  const inPython = getActive({ agent: 'claude-code', signals: ['python'] });
  check('Python 语境:pytest 排第一', inPython[0] && inPython[0].id === 'pref-pytest-style-aaaa');

  const inReact = getActive({ agent: 'claude-code', signals: ['react'] });
  check('React 语境:react 偏好排第一(顶过 high 优先级的 pytest)', inReact[0] && inReact[0].id === 'pref-react-fc-dddd');
  check('React 语境:pytest 没被错塞到第一(语境不串台)', inReact[0].id !== 'pref-pytest-style-aaaa');

  // ── getActive 无语境:退化成 priority 笨排序(向后兼容)──
  const noCtx = getActive({ agent: 'claude-code' });
  check('无语境:high 的 pytest 排第一', noCtx[0] && noCtx[0].priority === 'high');
  check('无语境:claude 视角排除 cursor-only', !noCtx.some((h) => h.id === 'decision-cursor-only-cccc'));
  check('getActive 返回 ≤5 条', getActive({ agent: 'claude-code', limit: 5 }).length <= 5);

  // ── detectSignals(从项目目录探测语境)──
  const pyProj = mkdtempSync(join(tmpdir(), 'starnet-pyproj-'));
  writeFileSync(join(pyProj, 'pyproject.toml'), '[project]\nname="x"', 'utf8');
  const pySig = detectSignals(pyProj);
  check('detectSignals:pyproject.toml → python', pySig.includes('python'));
  rmSync(pyProj, { recursive: true, force: true });

  const feProj = mkdtempSync(join(tmpdir(), 'starnet-feproj-'));
  writeFileSync(join(feProj, 'package.json'), JSON.stringify({ dependencies: { react: '^18' } }), 'utf8');
  const feSig = detectSignals(feProj);
  check('detectSignals:package.json+react → node+react', feSig.includes('node') && feSig.includes('react'));
  rmSync(feProj, { recursive: true, force: true });

  check('detectSignals:空 cwd 返回空数组', detectSignals('').length === 0);
} finally {
  rmSync(FIX, { recursive: true, force: true });
}

process.stdout.write(`\n结果: ${pass} 过 / ${fail} 挂\n`);
process.exit(fail ? 1 : 0);
