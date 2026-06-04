#!/usr/bin/env node
// index.js
// 星网 MCP server 入口(1-②)。
// 借鉴对象 = 官方 @modelcontextprotocol/sdk(当下最优解,规矩 B)。
// 传输 = stdio:Claude Code 把本进程当子进程拉起,通过 stdin/stdout 对话。
//
// 暴露两个工具:
//   recall(query)            —— 按需查:按关键词召回相关偏好
//   get_active_preferences() —— 会话开头主动注入:取当前生效的前 ≤5 条
//
// 纪律:stdout 被 MCP 协议占用,日志一律走 stderr,否则会污染通信。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { recall, getActive, starnetHome } from './store.js';

// ---- 把记录渲染成喂给 AI 的文本 ----
function renderRecord(r) {
  const meta = [`id: ${r.id}`, `优先级: ${r.priority}`];
  if (r.tags.length) meta.push(`标签: ${r.tags.join(', ')}`);
  return [
    `### ${r.title}  [${r.type}]`,
    meta.join(' · '),
    '',
    r.body.trim() || '(无正文)',
  ].join('\n');
}

function renderList(records, emptyMsg) {
  if (!records.length) return emptyMsg;
  const header = `从星网本地偏好库召回 ${records.length} 条:\n`;
  return header + '\n' + records.map(renderRecord).join('\n\n---\n\n');
}

const server = new McpServer({ name: 'starnet', version: '0.1.0' });

server.registerTool(
  'recall',
  {
    title: '召回偏好',
    description:
      '按关键词从用户的星网本地偏好库(~/.starnet)召回最相关的偏好/习惯/决策风格。' +
      '当你要按用户的习惯做事时(写测试、命名、技术选型、代码风格等),' +
      '先用本工具查一下用户在这方面有没有既定偏好,有就照着来。',
    inputSchema: {
      query: z
        .string()
        .describe('关键词,空格分隔。如 "测试 pytest"、"命名风格"、"react 状态管理"'),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('最多返回几条,默认 10'),
    },
  },
  async ({ query, limit }) => {
    const hits = recall(query, { agent: 'claude-code', limit: limit ?? 10 });
    return {
      content: [
        {
          type: 'text',
          text: renderList(hits, `星网库里没有和「${query}」相关的偏好。`),
        },
      ],
    };
  }
);

server.registerTool(
  'get_active_preferences',
  {
    title: '取当前生效偏好',
    description:
      '取用户星网库里当前最该生效的偏好(按优先级排序的前几条),' +
      '建议在会话开头调用一次,先了解用户的工作习惯再开干。' +
      '注:当前按优先级笨排序;后续版本会升级为按你正在做的任务智能挑选。',
    inputSchema: {
      limit: z
        .number()
        .int()
        .positive()
        .max(20)
        .optional()
        .describe('最多返回几条,默认 5'),
    },
  },
  async ({ limit }) => {
    const recs = getActive({ agent: 'claude-code', limit: limit ?? 5 });
    return {
      content: [
        {
          type: 'text',
          text: renderList(
            recs,
            '星网库里还没有任何偏好。可以打开星网偏好编辑器添加。'
          ),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
// 启动确认走 stderr(stdout 留给协议)
process.stderr.write(`[starnet] MCP server 已启动 · 读取自 ${starnetHome()}\n`);
