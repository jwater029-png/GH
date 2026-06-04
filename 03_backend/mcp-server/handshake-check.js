// handshake-check.js
// 端到端验证:用官方 SDK 的 client 端,把 index.js 当子进程通过 stdio 拉起,
// 走完 initialize → listTools → callTool,证明 MCP 管子真能通。
// 用临时 fixture 数据,不碰真实 ~/.starnet。跑完即清理。

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = mkdtempSync(join(tmpdir(), 'starnet-hs-'));
const prefDir = join(FIX, 'personal', 'preferences');
mkdirSync(prefDir, { recursive: true });
writeFileSync(
  join(prefDir, 'pref-pytest-style-aaaa.md'),
  [
    '---',
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
    '---',
    '',
    '我习惯用 pytest,不用 unittest。',
    '',
  ].join('\n'),
  'utf8'
);

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; process.stdout.write(`  ✅ ${name}\n`); }
  else { fail++; process.stdout.write(`  ❌ ${name}\n`); }
}

const transport = new StdioClientTransport({
  command: process.execPath, // node
  args: [join(__dirname, 'index.js')],
  env: { ...process.env, STARNET_HOME: FIX },
});
const client = new Client({ name: 'starnet-handshake', version: '0.1.0' });

try {
  await client.connect(transport);
  check('initialize 握手成功', true);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check('列出两个工具 recall + get_active_preferences', names.join(',') === 'get_active_preferences,recall');

  const r = await client.callTool({ name: 'recall', arguments: { query: 'pytest' } });
  const text = (r.content || []).map((c) => c.text || '').join('\n');
  check('调用 recall("pytest") 返回内容含 pytest 偏好', text.includes('用 pytest 写测试'));

  const a = await client.callTool({ name: 'get_active_preferences', arguments: {} });
  const atext = (a.content || []).map((c) => c.text || '').join('\n');
  check('调用 get_active_preferences 返回那条 high 偏好', atext.includes('用 pytest 写测试'));
} catch (e) {
  fail++;
  process.stdout.write(`  ❌ 握手过程抛错: ${e.message}\n`);
} finally {
  try { await client.close(); } catch {}
  rmSync(FIX, { recursive: true, force: true });
}

process.stdout.write(`\n端到端结果: ${pass} 过 / ${fail} 挂\n`);
process.exit(fail ? 1 : 0);
