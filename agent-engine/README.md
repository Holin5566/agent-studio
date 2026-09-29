# Agent Engine

Agent Engine 將一份 Agent 宣告執行成一次可觀測、可取消、有工具邊界的 take。

模型與工具能力由外部 runtime 和 MCP Server 提供。Engine 管理 manifest、能力檢查、子程序、事件、逾時、取消、輸出與產物；宿主負責 prompt、路由、多次 take 的編排及結果解讀。

```text
宿主 Director
  └─ agent-engine
      ├─ Agent manifest
      ├─ Runtime adapter
      ├─ Take lifecycle
      ├─ Event / usage
      ├─ Artifact store
      └─ mcp-hub → MCP servers
```

## 現況

目前可使用 `claude -p` runtime。Codex CLI adapter 仍標記為 experimental，需要呼叫端明確啟用。直接呼叫裸模型 API 並由 Engine 驅動的 tool loop 尚未實作。

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

Agent Engine 不負責：

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
import { createAgentEngine } from 'agent-engine';

const engine = createAgentEngine({ root: process.cwd() });

try {
  const result = await engine.runTake({
    agent: 'hello',
    prompt: 'Hello',
    timeoutMs: 60_000,
  });

  console.log(result.output);
} finally {
  await engine.close();
}
```

`root` 指向宿主專案根目錄；Agent manifests 預設位於 `manifests/agents/`，MCP Server manifests 位於 `manifests/mcp-servers/`。

## 事件與結果

Engine 會正規化 `started`、`text`、`tool-start`、`tool-end`、`usage`、`completed` 與 `failed` 等事件。CLI 私有的串流格式不直接暴露給宿主。

`TakeResult.status` 可能是：

- `ok`：輸出可用，正式 artifact 已 commit
- `truncated`：被 timeout、token 或輸出預算中止
- `error`：設定、能力、runtime 或輸出處理失敗
- `cancelled`：呼叫端取消

`status`、`stopReason` 與 `cleanup` 分開記錄，避免把輸出可用性、停止原因及資源清理混成同一個欄位。

## Artifact

預設 File Store 寫入 `<root>/.agent-engine/artifacts`。不需要持久化時可注入 Memory Store，也可以實作自訂 `ArtifactStore`。

輸出先寫入 draft。只有成功或通過 salvage 判斷時才 commit 正式 artifact，避免後續流程重用到半截內容。

## Runtime

Runtime adapter 負責將通用能力翻譯成各 CLI 的設定，並將原始串流與退出狀態轉成 Engine 的事件和結果。

宿主可在建立 Engine 時注入 runtime。任意 CLI arguments 不直接開放，避免呼叫端繞過 manifest 的工具和權限設定。

詳細的 runtime 差異見 [執行與工具契約](docs/runtime-and-tools.md)，內部模組責任見 [架構](docs/architecture.md)。
