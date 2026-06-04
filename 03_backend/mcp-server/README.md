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

## 自动加载(无需主动调)—— 1-③ 主动注入那一半

光有 `recall` 是"插件式":AI 要主动调才生效。要做到**会话一开 AI 就自带你的偏好**,
靠的不是 MCP(它天生被动),而是 **Claude Code 的 SessionStart hook**:

- 脚本:`session-start-hook.js` —— 每次开会话自动跑,调 `getActive` 取当前生效的前 ≤5 条,
  按 hook 契约输出 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`,
  内容被注入到会话上下文最前面。异常一律静默 exit 0,绝不卡会话启动。
- 挂载位置:**user-scope** `%USERPROFILE%\.claude\settings.json` 的 `hooks.SessionStart`,
  挂 `startup` + `clear` 两个时机(全新上下文场景;`resume`/`compact` 上下文已有历史不重复注入)。

settings.json 片段(留档,该文件不在本仓库):

```json
"hooks": {
  "SessionStart": [
    { "matcher": "startup", "hooks": [
      { "type": "command",
        "command": "node C:/Users/ghqah/projects/GH/03_backend/mcp-server/session-start-hook.js",
        "timeout": 15, "statusMessage": "星网:加载你的偏好…" } ] },
    { "matcher": "clear", "hooks": [
      { "type": "command",
        "command": "node C:/Users/ghqah/projects/GH/03_backend/mcp-server/session-start-hook.js",
        "timeout": 15, "statusMessage": "星网:加载你的偏好…" } ] }
  ]
}
```

> **注:** 这只解决了 **Claude Code 一家**的自动加载。Cursor(`.cursor/rules`)、Codex(`AGENTS.md`)
> 等其它 agent 的自动加载靠 **adapters 引擎**(把偏好翻译成各家原生格式自动写入),是阶段二的活。
>
> "选哪几条注入"当前用 `getActive` 的 priority 笨排序;三层叠加智能打分(1-③ 另一半)做好后,
> 升级 `getActive` 即可,hook 不用改。

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
