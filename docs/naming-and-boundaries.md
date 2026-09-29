# 核心命名與責任邊界

本文件記錄 JackIn 的正式詞彙。公開 API、套件、目錄與後續文件以這套名稱為準。

## 核心

### Agent

Agent 定義「要做什麼」，包含身分、instructions、Capabilities 與 Archives。Agent 不負責通訊協議、派案或程序生命週期。

### AgentCore

AgentCore 定義「怎麼執行 Agent」，負責完成一次 take：

- 啟動 Codex、Claude Code 等 harness
- 串流與正規化事件
- 工具邊界
- 取消、逾時與停止原因
- usage 與執行產物

地端或裸模型由 JackIn 提供 tool loop 包裝成 AgentCore；開發者也可以實作共同介面後自行注入。Model 只有這類 AgentCore 需要，並非所有 Agent 的必要依賴。

目前套件名稱為 `agent-core`，主要入口為 `createAgentCore()`。

```ts
const core = createAgentCore({ runtime: codexCli });
```

## Agency 模型

外圍採用事務所／行動單位的專業分工：

| 名稱 | 責任 |
|---|---|
| `Agency` | 承載整套服務並管理生命週期 |
| `Desk` | 串接 Terminal、Slack、LINE、Discord、Teams 等外部窗口 |
| `Dispatcher` | 根據輸入尋找符合的 Assignment |
| `Assignment` | 宣告派案條件、目標 Agent 與 Policy |
| `Case` | 一件持續處理的工作或對話 |
| `Casebook` | 載入與保存 Case |
| `Agent` | 定義專業角色與工作能力 |
| `AgentCore` | 執行 Agent 的一次 take |
| `Capability` | Agent 可以呼叫的能力；可來自本機函式或 MCP |
| `Archive` | Agent 可以查詢的知識來源 |
| `Policy` | 判斷操作為 allow、deny 或 approval |
| `ClearanceRequest` | 等待人工核准的操作 |
| `CaseLog` | Case 的結構化執行紀錄 |
| `Dispatch` | Desk 收到或送出的標準訊息 |

資料流：

```text
Desk 收到 Dispatch
        ↓
Agency 建立或載入 Case
        ↓
Dispatcher 依 Assignment 派給 Agent
        ↓
Policy 決定可用 Capabilities
        ↓
AgentCore 執行 Agent
        ↓
Agency 寫入 Casebook 與 CaseLog
        ↓
Desk 發送回覆
```

Assignment 是派案設定，不承擔執行生命週期。Agency 才是承載多個 Desk、Assignment 與 Agent 的長時間執行程序。

## 預計公開 API

```ts
const supportAgent = createAgent({
  id: 'support',
  core: createAgentCore({ runtime: codexCli }),
  instructions: './support.md',
  capabilities: [searchDocs, createTicket],
  archives: [productDocs],
});

const agency = createAgency({
  desks: [terminalDesk()],
  dispatcher: createDispatcher([
    assignment({
      match: terminal(),
      agent: supportAgent,
      policy: supportPolicy,
    }),
  ]),
  casebook: memoryCasebook(),
});

await agency.open();
```

開發初期可以先直接透過 Terminal 執行 Agent：

```ts
await runTerminal(agent);
```

行為穩定後再加入 Agency、Dispatcher 與正式 Desk。Terminal 最終仍應能走完整 Agency 流程，以驗證和正式通訊軟體相同的 Case、Policy 與事件處理。

## 命名規則

- 專案與頂層框架名稱為 **JackIn**，概念為賽博調度與接入中樞（Patcher / Rig）。
- 對外不建立 `Bot` 類別；Bot 是產品用途，不是必要的程式抽象。
- 對外不使用 `Engine` 表示 Agent 執行核心，統一稱為 `AgentCore`。
- 包裝外部 CLI（Claude Code / Codex）或自建 loop 的低階載體統一稱為 `Runtime`（如 `SpawnRuntime`）。
- `Adapter` 只用於 Desk 或 AgentCore 內部的協議轉換，不作為主要公開概念。
- 通訊狀態統一稱為 `Case`（或 `Session`）；平台 thread 只是 Dispatch 中的外部識別資訊。
- MCP tool 與本機 function 對 Agent 都呈現為 `Capability`。
- 可查詢的知識來源統一稱為 `Archive`。

CLI 命令使用直接的動詞：

```text
jackin chat
jackin serve
jackin check
jackin eval
jackin inspect
jackin auth
```

## 實作順序

1. 穩定 Agent 與 AgentCore 的共同介面。
2. 完成 Codex 與 Claude Code 的 AgentCore 支援。
3. 提供 Terminal 執行入口。
4. 實作 Case、Casebook 與 Policy。
5. 實作 Agency、Dispatcher 與 Assignment。
6. 接入第一個正式 Desk。
7. 視需求提供官方 tool loop 與 Model 介面。

目前 repository 已有 `agent-core`；Agency、Desk、Dispatcher、Assignment、Casebook、Archive 與公開的 `createAgent()` API 仍屬規劃。
