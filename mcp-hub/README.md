# mcp-hub

MCP gateway:把多台上游 MCP server 合成一台，只對呼叫端露出**允許清單裡**的工具。

允許清單外的工具不會出現在 `tools/list`,`tools/call` 也直接拒絕、不轉發上游 —— 限制在協議層，不是在 prompt 裡拜託模型。

依賴方向:`host → agent-engine → mcp-hub`。hub **不知道 agent 是什麼**:允許清單由呼叫端(agent-engine 從 agent manifest 算)傳進來。

## 入口

```bash
# stdio gateway(agent-engine 每個 take 拉起一個)
node dist/bin/entry.js --tools issue-get,browser-navigate
node dist/bin/entry.js --all-tools        # 開發用,必須明寫

# 撥號檢查:manifest 宣告的工具名在上游是否真的存在
# 要檢查宿主的 manifests,用 MCP_HUB_ROOT 指到宿主專案根(否則讀 mcp-hub 自己的)
MCP_HUB_ROOT=/path/to/project npm run check
MCP_HUB_ROOT=/path/to/project npm run check -- --server mcp-atlassian --list-tools
```

`--agent` 已移除(2026-09-24),傳了會報錯並提示改用 `--tools`。

## manifests

hub 只讀宿主的 `manifests/mcp-servers/*.json`,一台 server 一個檔:

```json
{
  "id": "mcp-atlassian",
  "transport": "stdio",
  "command": "uvx",
  "args": ["mcp-atlassian", "--jira-token=${BOT_JIRA_TOKEN}"],
  "tools": { "mcp-atlassian-jira_get_issue": "jira_get_issue" }
}
```

`tools` 左邊是**對外 tool id**(允許清單與 agent manifest 用的名字),右邊是上游 `tools/list` 的實際名稱(`--list-tools` 會印出來)。欄位說明見 `manifests/mcp-servers/example.json`。

逾時(毫秒,都可省略):`timeoutMs` 單次 `tools/call`、`maxTotalTimeoutMs` 有進度回報時的總上限、`connectTimeoutMs` 連線握手(冷啟動慢的上游要調長,例如 `uvx` 類第一次建 venv 常超過 SDK 預設的 60 秒)。

**上游故障時:** `tools/list` 平行問每台 server;連不上的那台只拿掉它自己的工具(gateway 的 stderr 會記一行「略過 …」),其他照常。**全部**連不上才整個失敗。上游連得上、卻沒有 manifest 宣告的工具,仍然整個失敗 —— 那是設定錯,不是暫時故障。

模型看到的工具名是 `mcp__agent-engine-gateway__<tool id>`。`GATEWAY_SERVER_NAME` 刻意沿用 `agent-engine-gateway`,改它等於改所有 prompt 點名的工具名。

## 專案根

`manifests/` 從 `MCP_HUB_ROOT` 找;沒設就用 `AGENT_ENGINE_ROOT`(engine 拉起 gateway 時設的)，都沒有才用 cwd。

## 信任模型

**hub 信任啟動它的人。** 允許清單與上游憑證都來自啟動者的參數與環境。它防的是**模型**,不是人 —— 所以 stdio 入口與 gateway 不可暴露到網路上。要對外開放，得在前面加一層驗證身分、由 server 端依身分決定允許清單的入口。

## 宿主自己的工具

`BuiltinTool` + `openGateway({ tools, builtinTools })` 只在 **in-process** 有效。走 `claude -p` 的路徑,gateway 是另一個程序，收不到 JS 物件 —— 那條路要把工具做成真正的 stdio MCP server,在 `manifests/mcp-servers/` 宣告成一般上游。

`serveBuiltinStdio` 把一組 `BuiltinTool` 起成 stdio server,並處理收尾(SIGINT / SIGTERM / **stdin EOF**:gateway 被 SIGKILL 時只剩管線斷掉，不自己收會留下孤兒程序):

```ts
// my-tools/serve.ts
import { serveBuiltinStdio, ToolFailure, type BuiltinTool } from 'mcp-hub';

const echo: BuiltinTool = {
  name: 'echo',
  description: 'echo back',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  async execute(args) {
    if (typeof args.text !== 'string') throw new ToolFailure('text 必填');   // → isError,模型看得到原因
    return `echoed: ${args.text}`;
  },
};

serveBuiltinStdio([echo], { name: 'my-tools' });
```

```json
// manifests/mcp-servers/my-tools.json
{ "id": "my-tools", "transport": "stdio", "command": "node", "args": ["${PROJECT}/dist/serve.js"],
  "env": { "API_TOKEN": "${API_TOKEN}" }, "tools": { "my-echo": "echo" } }
```

注意:hub 拉起 stdio 上游時只給 SDK 的預設環境(PATH、HOME…)加上 manifest `env` 明確宣告的變數，**不會**繼承完整環境。憑證要在 `env` 裡逐一宣告。

`command` / `args` / `env` / `url` 都支援插值:

| 寫法 | 沒設或空字串時 |
|---|---|
| `${VAR}` | **直接報錯**(必填) |
| `${VAR:-}` | 代入空字串(選用) |
| `${VAR:-default}` | 代入 `default` |

**憑證一律用必填形式。** 選用語法只給「不給也合法」的設定(功能開關、上限):`--token=${TOKEN:-}` 會讓漏設的 token 靜默變成空值，上游回 401 時很難查到根因。

宿主自己的工具應包成 stdio MCP Server，並在 `manifests/mcp-servers/` 宣告後供 Agent manifest 引用。

## 測試

```bash
npm test    # pretest 會先 tsc -b;跨程序的 e2e 需要 dist/bin/entry.js
```
