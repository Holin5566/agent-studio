# 核心命名與責任邊界

本文件記錄 Agent Studio 對外概念的命名。這些名稱是後續 API、目錄、文件與套件命名的共同基準；目前尚未實作的部分會明確標示。

## 核心定義

### Agent

Agent 定義「要做什麼」，包含：

- 身分與名稱
- instructions / prompt
- 可使用的 tools
- knowledge sources
- 執行時需要的能力

Agent 不負責通訊協議、訊息路由或程序生命週期。

### Engine

Engine 定義「怎麼執行 Agent」，負責完成 Agent 的一次回合，包含：

- 串流事件
- 工具呼叫
- 取消與逾時
- usage 與停止原因
- 執行產物

不同 Engine 可以用不同方式完成工具迴圈：

- `codexEngine()`：由 Codex harness 管理工具迴圈。
- `claudeCodeEngine()`：由 Claude Code harness 管理工具迴圈。
- `toolLoopEngine()`：由 Agent Studio 提供工具迴圈，包裝裸模型或地端模型。
- 自製 Engine：開發者實作共同的 `Engine` 介面後注入。

Model 不是 Agent 的必要依賴。只有 `toolLoopEngine()` 需要 Model 介面；Codex、Claude Code 等 harness 已經自行管理模型與工具迴圈。

預計 API：

```ts
const agent = createAgent({
  id: 'support',
  engine: codexEngine(),
  instructions: './support.md',
  tools: [searchDocs],
  knowledge: [productDocs],
});
```

## 外圍元件

Agent 與 Engine 是中心；通訊服務所需的外圍元件使用以下名稱：

| 名稱 | 責任 |
|---|---|
| `Host` | 啟動服務並串起 Channel、Router、Session、Policy 與 Agent |
| `Channel` | 串接 Terminal、Slack、LINE、Discord、Teams 等外部協議 |
| `Router` | 依訊息內容與來源尋找符合的 Route |
| `Route` | 宣告比對條件、目標 Agent 與該入口使用的 Policy |
| `Session` | 表示一段持續對話 |
| `SessionStore` | 載入與儲存對話訊息及狀態 |
| `Policy` | 判斷本次工具或資源操作為 allow、deny 或 approval |
| `ApprovalStore` | 保存與完成待人工核准的操作 |
| `Tool` | Agent 可以呼叫的能力 |
| `ToolRegistry` | 管理本機函式與 MCP 等不同來源的工具 |
| `KnowledgeSource` | 提供 Agent 可查詢的知識 |

資料流：

```text
Channel 收到訊息
        ↓
Host 建立 MessageContext
        ↓
Router 找到 Route 與 Agent
        ↓
SessionStore 載入歷史
        ↓
Policy 算出本次可用工具
        ↓
Engine 執行 Agent
        ↓
Host 儲存結果
        ↓
Channel 發送回覆
```

`Route` 是設定，不承擔上述生命週期。`Host` 才是承載多個 Channel、Route 與 Agent 的長時間執行程序。

## 預計公開 API

```ts
const supportAgent = createAgent({
  id: 'support',
  engine: codexEngine(),
  instructions: './support.md',
  tools: [searchDocs, createTicket],
  knowledge: [productDocs],
});

const host = createHost({
  channels: [terminalChannel()],
  router: createRouter([
    route({
      match: terminal(),
      agent: supportAgent,
      policy: supportPolicy,
    }),
  ]),
  sessions: memorySessionStore(),
});

await host.start();
```

開發初期可以不建立 Host，直接透過 Terminal 執行 Agent：

```ts
const agent = createAgent({ engine, instructions, tools });
await runTerminal(agent);
```

Terminal 驗證穩定後，再加入 Host、Route 與正式 Channel。Terminal 最終仍應能走完整 Host 流程，以驗證與正式通訊平台相同的 Session、Policy 和事件處理。

## 命名規則

- 對外不建立 `Bot` 類別。Bot 是產品用途，不是必要的程式抽象。
- 對外不使用 `Runtime` 表示 Agent 執行方式；統一稱為 `Engine`。
- `Adapter` 只用於 Channel 或 Engine 內部的協議轉換實作，不作為主要公開概念。
- `Provider` 只用於外部服務的具體實作名稱；核心知識介面固定稱為 `KnowledgeSource`。
- 核心對話狀態統一稱為 `Session`；平台的 thread 只作為 Channel 輸入中的外部識別資訊。

建議 CLI 命令使用動詞：

```text
agent-studio chat
agent-studio serve
agent-studio check
agent-studio eval
agent-studio inspect
agent-studio auth
```

## 實作順序

1. 穩定 Agent 與 Engine 的共同介面。
2. 完成 Codex Engine 與 Claude Code Engine。
3. 提供 Terminal 執行入口。
4. 實作 Session 與 Policy。
5. 實作 Host、Router 與 Route。
6. 接入第一個正式 Channel。
7. 視需求提供 `toolLoopEngine()` 與 Model 介面。

目前 repository 已有的 `agent-engine` 是 Engine 原型；Host、Channel、Router、Session、Policy、KnowledgeSource 與公開的 `createAgent()` API 仍屬規劃。
