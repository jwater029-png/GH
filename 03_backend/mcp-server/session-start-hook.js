#!/usr/bin/env node
// session-start-hook.js
// 星网 · Claude Code 自动加载钩子(1-③ 主动注入那一半)。
//
// 干啥:Claude Code 每次开新会话时自动跑本脚本,把用户当前生效的偏好
//       (≤5 条)按 SessionStart hook 契约塞进会话上下文——AI 一上来就自带你的偏好,
//       不用你、也不用 AI 主动调任何工具。这就是"自动加载"。
//
// 契约(Claude Code v2.1.x):stdout 输出
//   {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}
//   exit 0。additionalContext 上限 1 万字符。
//
// 纪律:hook 绝不能卡住会话启动——任何异常都静默吞掉、输出空上下文、exit 0。
//
// 注:这一版"选哪几条"用 store.js 的 getActive 笨排序(按 priority)。
//     1-③ 的另一半(三层叠加智能打分:按当前任务/项目/文件类型挑)做好后,
//     getActive 升级即可,本 hook 不用改。

import { getActive } from './store.js';

const LIMIT = 5;
const MAX_CHARS = 9000; // 留余量,契约上限 1 万

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

function renderRecord(r) {
  const head = `## ${r.title}  ·  ${r.type}  ·  优先级 ${r.priority}` +
    (r.tags.length ? `  ·  ${r.tags.join(', ')}` : '');
  const body = (r.body || '').trim();
  return body ? `${head}\n${body}` : head;
}

try {
  const recs = getActive({ agent: 'claude-code', limit: LIMIT });
  if (!recs.length) {
    // 库里还没东西,不注入任何内容(别给 AI 塞噪音)
    emit('');
  }

  const blocks = recs.map(renderRecord).join('\n\n');
  let text =
    '# 用户的个人偏好(来自星网,已自动加载)\n\n' +
    '以下是该用户登记的工作偏好/习惯/决策。本次会话请默认按这些来做事。\n' +
    '需要更多细节,可调用星网 MCP 的 `recall` 工具按关键词查询。\n\n' +
    blocks;

  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  emit(text);
} catch (e) {
  // 出任何错都不能拖累会话启动:走 stderr 记一笔,注入空内容
  process.stderr.write(`[starnet hook] 加载偏好失败,跳过注入: ${e.message}\n`);
  emit('');
}
