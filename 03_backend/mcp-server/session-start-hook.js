#!/usr/bin/env node
// session-start-hook.js
// 星网 · Claude Code 自动加载钩子(1-③ 主动注入那一半 + 三层打分)。
//
// 干啥:Claude Code 每次开新会话时自动跑本脚本,按"你当前在干啥"挑出最相关的偏好
//       (≤5 条)塞进会话上下文——AI 一上来就自带你的偏好,不用你、也不用 AI 主动调。
//
// 智能挑:从 stdin 拿到 cwd → 探测项目语境(Python? 前端?)→ 三层打分挑前 ≤5 条。
//         在写 Python 的项目里,就不会把前端偏好塞进来。
//
// 契约(Claude Code v2.1.x):stdout 输出
//   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
//   exit 0。additionalContext 上限 1 万字符。
//
// 纪律:hook 绝不能卡住会话启动——任何异常/超时都静默吞掉、输出空上下文、exit 0。

import { getActive, detectSignals } from './store.js';

const LIMIT = 5;
const MAX_CHARS = 9000;
const STDIN_TIMEOUT_MS = 500;

function emit(additionalContext) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: additionalContext || '',
      },
    })
  );
  process.exit(0);
}

// 读 stdin 的 hook 输入(JSON,含 cwd)。带超时兜底:拿不到就当空,绝不卡住。
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(data);
    };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      finish();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

function renderRecord(r) {
  const head =
    `## ${r.title}  ·  ${r.type}  ·  优先级 ${r.priority}` +
    (r.tags.length ? `  ·  ${r.tags.join(', ')}` : '');
  const body = (r.body || '').trim();
  return body ? `${head}\n${body}` : head;
}

try {
  const raw = await readStdin();
  let cwd = '';
  try {
    cwd = (JSON.parse(raw) || {}).cwd || '';
  } catch {
    // 没有合法 stdin 就不带语境,getActive 退化成 priority 笨排序
  }

  const signals = detectSignals(cwd);
  const recs = getActive({ agent: 'claude-code', limit: LIMIT, signals });

  if (!recs.length) {
    emit(''); // 库里还没东西,不塞噪音
  }

  const ctxNote = signals.length
    ? `(已按当前项目语境挑选:${signals.join(', ')})`
    : '(按优先级挑选)';

  let text =
    '# 用户的个人偏好(来自星网,已自动加载)\n\n' +
    `以下是该用户登记的工作偏好/习惯/决策${ctxNote}。本次会话请默认按这些来做事。\n` +
    '需要更多细节,可调用星网 MCP 的 `recall` 工具按关键词查询。\n\n' +
    recs.map(renderRecord).join('\n\n');

  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  emit(text);
} catch (e) {
  process.stderr.write(`[starnet hook] 加载偏好失败,跳过注入: ${e.message}\n`);
  emit('');
}
