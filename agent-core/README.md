# AgentCore

AgentCore 將一份 Agent 宣告執行成一次可觀測、可取消、有工具邊界的 take。

模型與工具能力由外部 harness 和 MCP Server 提供。AgentCore 管理 manifest、能力檢查、子程序、事件、逾時、取消、輸出與產物；Agency 負責派案、多次 take 的編排及結果解讀。

```text
Agency
  └─ agent-core
      ├─ Agent manifest
      ├─ Runtime adapter
      ├─ Take lifecycle
      ├─ Event / usage
      ├─ Artifact store
      └─ mcp-hub → MCP servers
```

## 現況

目前可使用 `claude -p` harness。Codex CLI 支援仍標記為 experimental，需要呼叫端明確啟用。直接呼叫裸模型 API並由 AgentCore 驅動的 tool loop 尚未實作。

現有能力包括：

- Agent manifest 載入與驗證
- Runtime capability 檢查
- 每次 take 的 MCP tool allowlist
- 子程序與 process group 清理
- `AbortSignal`、wall-clock timeout 與輸出上限
- 正規化事件與 usage
- partial output、salvage 與正式 artifact
- 記憶體及檔案 Artifact Store
- config、capability、runtime、output、quota 等錯誤分類

仍需以真實 Bot 流程驗證 CLI 權限旗標與長時間執行行為。原生 CLI 工具限制也不等同於 OS sandbox。

## 非目標

AgentCore 不負責：

- 保存或產生業務 prompt
- 決定下一個 take
- Conversation 或長期記憶
- Multi-agent workflow
- Slack／Teams 等 Channel Adapter
- Knowledge Base ingestion
- 工具本身的業務實作

## 快速開始

在 repository 根目錄執行：

```bash
npm run setup
npm run build
npm test
```

Agent manifest：

```json
{
  "id": "hello",
  "tools": [],
  "capabilities": {
    "filesystem": "none",
    "shell": false
  }
}
```

程式化執行：

```ts
import { createAgentCore } from 'agent-core';

const core = createAgentCore({ root: process.cwd() });

try {
  const result = await core.runTake({
    agent: 'hello',
    prompt: 'Hello',
    timeoutMs: 60_000,
  });

  console.log(result.output);
} finally {
  await core.close();
}
```

`root` 指向宿主專案根目錄；Agent manifests 預設位於 `manifests/agents/`，MCP Server manifests 位於 `manifests/mcp-servers/`。

## 事件與結果

AgentCore 會正規化 `started`、`text`、`tool-start`、`tool-end`、`usage`、`completed` 與 `failed` 等事件。CLI 私有的串流格式不直接暴露給 Agency。

`TakeResult.status` 可能是：

- `ok`：輸出可用，正式 artifact 已 commit
- `truncated`：被 timeout、token 或輸出預算中止
- `error`：設定、能力、runtime 或輸出處理失敗
- `cancelled`：呼叫端取消

`status`、`stopReason` 與 `cleanup` 分開記錄，避免把輸出可用性、停止原因及資源清理混成同一個欄位。

## Artifact

預設 File Store 寫入 `<root>/.agent-core/artifacts`。不需要持久化時可注入 Memory Store，也可以實作自訂 `ArtifactStore`。

輸出先寫入 draft。只有成功或通過 salvage 判斷時才 commit 正式 artifact，避免後續流程重用到半截內容。

## Runtime

內部 harness adapter 負責將通用能力翻譯成各 CLI 的設定，並將原始串流與退出狀態轉成 AgentCore 的事件和結果。

呼叫端可在建立 AgentCore 時注入 harness adapter。任意 CLI arguments 不直接開放，避免繞過 manifest 的工具和權限設定。

詳細的 runtime 差異見 [執行與工具契約](docs/runtime-and-tools.md)，內部模組責任見 [架構](docs/architecture.md)。

## 0.1 命名遷移

早期開發版本使用 `agent-engine` 名稱。更新後請調整：

| 舊名稱 | 新名稱 |
|---|---|
| package / directory `agent-engine` | `agent-core` |
| `createAgentEngine()` | `createAgentCore()` |
| `Engine` / `EngineConfig` | `AgentCore` / `AgentCoreConfig` |
| `EngineError` / `EngineErrorKind` | `AgentCoreError` / `AgentCoreErrorKind` |
| `AGENT_ENGINE_ROOT` | `AGENT_CORE_ROOT` |
| `.agent-engine/artifacts` | `.agent-core/artifacts` |
| `agent-engine-gateway` | `agent-core-gateway` |

TypeScript API 與 `AGENT_ENGINE_ROOT` 暫時保留相容 alias／fallback。既有 artifact 不會自動搬移；需要延續時請將 `.agent-engine/artifacts` 搬到 `.agent-core/artifacts`。若 prompt 寫死 MCP tool 全名，也要把 `mcp__agent-engine-gateway__` 改成 `mcp__agent-core-gateway__`。
