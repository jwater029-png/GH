// test.js
// store.js 冒烟测试。自建临时 fixture(不依赖你机器上的真实 ~/.starnet 数据),
// 跑完即清理。验证:能读、关键词召回准、空串/不存在词不报错、注入笨排序对。

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 必须在 import store.js 之前设好 STARNET_HOME(store 在调用时读 env,这里提前设最稳)
const FIX = mkdtempSync(join(tmpdir(), 'starnet-test-'));
process.env.STARNET_HOME = FIX;

function writeMd(sub, name, fm, body) {
  const dir = join(FIX, 'personal', sub);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `---\n${fm}\n---\n\n${body}\n`, 'utf8');
}

// 三条 fixture:高优先级 pytest 偏好、中优先级命名习惯、低优先级仅限 cursor 的决策
writeMd(
  'preferences',
  'pref-pytest-style-aaaa.md',
  [
    'id: pref-pytest-style-aaaa',
    'type: preference',
    'title: 用 pytest 写测试',
    'created: 2026-05-30',
    'updated: 2026-05-30',
    'applies-to: []',
    'context: [testing, python]',
    'priority: high',
    'tags: [test, pytest]',
    'extra: {}',
  ].join('\n'),
  '我习惯用 pytest,不用 unittest。'
);
writeMd(
  'habits',
  'habit-naming-bbbb.md',
  [
    'id: habit-naming-bbbb',
    'type: habit',
    'title: 命名用 snake_case',
    'created: 2026-05-30',
    'updated: 2026-05-30',
    'applies-to: []',
    'context: [naming]',
    'priority: medium',
    'tags: [naming, style]',
    'extra: {}',
  ].join('\n'),
  '变量函数都用 snake_case,讨厌缩写。'
);
writeMd(
  'decisions',
  'decision-cursor-only-cccc.md',
  [
    'id: decision-cursor-only-cccc',
    'type: decision-style',
    'title: 只给 cursor 的决策',
    'created: 2026-05-30',
    'updated: 2026-05-30',
    'applies-to: [cursor]',
    'context: []',
    'priority: low',
    'tags: [misc]',
    'extra: {}',
  ].join('\n'),
  '这条只对 cursor 生效。'
);
// 一条坏文件:不该让它拖垮整次读取
mkdirSync(join(FIX, 'personal', 'preferences'), { recursive: true });
writeFileSync(join(FIX, 'personal', 'preferences', 'broken.md'), '没有 frontmatter 的烂文件', 'utf8');

const { loadAll, recall, getActive } = await import('./store.js');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    process.stdout.write(`  ✅ ${name}\n`);
  } else {
    fail++;
    process.stdout.write(`  ❌ ${name}\n`);
  }
}

try {
  const all = loadAll();
  check('loadAll 读到 3 条好记录(坏文件被跳过)', all.length === 3);

  const hits = recall('pytest');
  check('recall("pytest") 命中 pytest 偏好', hits.length === 1 && hits[0].id === 'pref-pytest-style-aaaa');

  const naming = recall('命名 snake');
  check('recall("命名 snake") 命中命名习惯', naming.some((h) => h.id === 'habit-naming-bbbb'));

  check('recall 空串返回空且不报错', recall('').length === 0);
  check('recall 不存在的词返回空', recall('zzz根本不存在xyz').length === 0);

  // applies-to: [cursor] 的那条,对 claude-code 不该出现
  const forClaude = recall('决策', { agent: 'claude-code' });
  check('applies-to=[cursor] 的条目对 claude-code 不召回', !forClaude.some((h) => h.id === 'decision-cursor-only-cccc'));
  const forCursor = recall('决策', { agent: 'cursor' });
  check('同一条对 cursor 能召回', forCursor.some((h) => h.id === 'decision-cursor-only-cccc'));

  const active = getActive({ limit: 5, agent: 'claude-code' });
  check('getActive 返回 ≤5 条', active.length <= 5);
  check('getActive 笨排序:high 排第一', active[0] && active[0].priority === 'high');
  check('getActive 排除 cursor-only(claude-code 视角)', !active.some((h) => h.id === 'decision-cursor-only-cccc'));

  const top1 = getActive({ limit: 1, agent: 'claude-code' });
  check('getActive limit=1 只回 1 条', top1.length === 1);
} finally {
  rmSync(FIX, { recursive: true, force: true });
}

process.stdout.write(`\n结果: ${pass} 过 / ${fail} 挂\n`);
process.exit(fail ? 1 : 0);
