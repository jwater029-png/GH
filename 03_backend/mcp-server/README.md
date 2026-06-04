# 星网 MCP server(1-②)

把 `~/.starnet/personal` 里的个人偏好,通过 MCP 协议暴露给 Claude Code,
让 AI 能真读到"你怎么做事"。批次 1 主柱链条的第二环。

## 它做什么(范围:只通水管)

暴露两个工具:

| 工具 | 干啥 |
|---|---|
| `recall(query, limit?)` | **按需查**:按关键词召回相关偏好/习惯/决策(标题>标签>场景>正文 加权打分) |
| `get_active_preferences(limit?)` | **会话开头主动注入**:取当前生效的前 ≤5 条(按优先级笨排序) |

**不做的事:** 三层叠加智能打分(按项目路径/文件类型/全局智能挑)是护城河①,
留给 **1-③ 活注入引擎**。这一环只负责把管子接通。

## 技术选型

- **SDK** = 官方 `@modelcontextprotocol/sdk`(当下最优解,不自造)
- **传输** = stdio(Claude Code 把本进程当子进程拉起)
- **语言** = 纯 Node JS,直接复用 `02_frontend/starnet-format.js`(数据格式宪法代码实现,单一权威)
- **日志** = 一律走 stderr(stdout 留给 MCP 协议)

## 接入 Claude Code

在终端跑(把路径换成你本机的绝对路径):

```bash
claude mcp add starnet -- node "C:/Users/ghqah/projects/GH/03_backend/mcp-server/index.js"
```

或手动写进项目根的 `.mcp.json`:

```json
{
  "mcpServers": {
    "starnet": {
      "command": "node",
      "args": ["C:/Users/ghqah/projects/GH/03_backend/mcp-server/index.js"]
    }
  }
}
```

接好后在 Claude Code 里用 `/mcp` 能看到 `starnet`,工具名 `recall`、`get_active_preferences`。

## 数据从哪来

读 `~/.starnet/personal/` 下的 `preferences/`、`habits/`、`decisions/`(diary/workflows 阶段二三再说)。
这些文件由**星网偏好编辑器(1-①,`02_frontend/`)**写入。
可设环境变量 `STARNET_HOME` 覆盖默认根目录(测试/换机用)。

## 跑测试

```bash
npm install
npm test                 # store 逻辑冒烟测试(自建临时 fixture,11 项)
node handshake-check.js  # MCP 端到端握手(拉起真子进程,4 项)
```
