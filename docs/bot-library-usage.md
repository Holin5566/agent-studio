# Bot Library 預計使用流程

> 本文件保留早期的流程與功能構想，其中 `Bot Runtime`、`Director`、`Adapter`、`Conversation` 與 `Knowledge Provider` 等名稱尚未依最新決策重寫。正式命名與責任邊界以 [核心命名與責任邊界](naming-and-boundaries.md) 為準：Host 串接 Channel、Router、Route、Session、Policy 與 Agent，Engine 負責執行 Agent。

狀態：規劃文件。本文描述預計的開發者體驗，不代表所有功能已經實作。

目前已完成的範圍只有 `agent-engine` 與 `mcp-hub`。Bot Runtime、Terminal Adapter、Conversation、Knowledge Provider、Eval 及 Slack／Teams Adapter 仍待開發。

## 原則

開發階段先使用 Terminal 驗證對話、工具與權限，不先製作聊天 UI，也不先串接 Slack 或 Teams。

Terminal 必須走和正式通訊平台相同的 Bot Runtime，而不是直接繞過 Bot 層呼叫 Agent。確認 Bot 行為穩定後，Slack／Teams Adapter 只負責轉換訊息和呈現回覆。

```text
Terminal
   │
   ▼
Standard Message
   │
   ▼
Bot Runtime → Director → agent-engine → mcp-hub → MCP servers
   │
   ▼
Standard Response
   │
   ▼
Terminal Renderer
```

## 開發者流程

### 1. 建立 Bot 專案

第一版可以從範例目錄複製；介面穩定後再提供 scaffold 指令。

預計的專案結構：

```text
my-bot/
├─ bot.yaml
├─ agents/
│  └─ assistant.yaml
├─ prompts/
│  └─ assistant.md
├─ mcp-servers/
│  └─ jira.yaml
├─ knowledge/
├─ channels/
├─ evals/
│  └─ basic.yaml
└─ src/
   └─ director.ts
```

簡單 Bot 不需要自訂 Director，也不需要 Knowledge Provider。

### 2. 定義 Agent

Agent 定義一次 take 使用的 runtime profile、工具、skill 與執行限制。

```yaml
id: assistant
runtime: claude

tools:
  - jira-get-issue
  - jira-search

skills:
  - jira-analysis

capabilities:
  filesystem: none
  shell: false

budget:
  timeoutMs: 300000
  maxOutputBytes: 100000
```

Runtime 實例不寫進 Agent manifest。宿主建立 Engine 時注入 Runtime Registry，Agent 只引用已註冊的 profile：

```ts
const engine = createAgentEngine({
  runtimes: {
    claude: claudeRuntime({ settingsPath: './claude-settings.json' }),
    codex: codexRuntime({ configPath: './codex-config.toml' }),
    test: scriptedRuntime([]),
  },
  defaultRuntime: 'claude',
});
```

預計選擇順序：

```text
受信任的 take override
→ AgentDefinition.runtime
→ EngineConfig.defaultRuntime
```

一般對話使用者不能指定 runtime override。Override 只供 eval、canary 或管理者測試使用。

### 3. 設定 MCP 工具

```yaml
id: jira
transport: stdio
command: npx
args:
  - jira-mcp
env:
  JIRA_TOKEN: ${JIRA_TOKEN}
tools:
  jira-get-issue: get_issue
  jira-search: search
```

Agent 只能看到自己 manifest 中列出的工具。上游即使提供其他工具，也不應出現在 `tools/list`，直接呼叫也應由 `mcp-hub` 拒絕。

自建工具優先做成 MCP Server，讓 CLI runtime 和未來 embedded loop 使用同一套工具契約。

### 4. 選擇性設定知識來源

知識檢索不綁定特定向量資料庫。預計透過 provider interface 接入既有搜尋服務或自行建立的索引。

```ts
interface KnowledgeProvider {
  search(query: KnowledgeQuery): Promise<KnowledgeResult[]>;
  get(id: string): Promise<KnowledgeDocument>;
}
```

設定範例：

```yaml
id: product-docs
provider: document-search
sources:
  - confluence://PRODUCT
  - git://product-docs
retrieval:
  topK: 8
  requireCitations: true
```

Knowledge Provider 可以透過 `knowledge-search`、`knowledge-get` 等 MCP 工具提供給 Agent。文件匯入、chunk、embedding、索引更新與資料權限不是 `agent-engine` 的責任。

### 5. 定義 Bot

Bot 組合 Director、Agent 與 conversation policy，不重複宣告 Agent 的 runtime 或 tools。

```yaml
apiVersion: agent-studio/v1
kind: Bot

metadata:
  id: jira-helper
  name: Jira Helper
  version: 0.1.0

spec:
  director:
    type: simple
    agent: assistant

  conversation:
    incomingWhileRunning: queue
    sessionTtl: 24h

  responses:
    locale: zh-TW
    progressAfter: 3s
```

`simple` Director 的流程只有：

```text
收到訊息 → 組 prompt → runTake → 回覆
```

複雜 Bot 使用程式化 Director，負責 route、reuse、fan-out、synth 與 verify。這些業務判斷不進 `agent-engine`。

### 6. 使用 Terminal 對話

預計指令：

```bash
agent-studio chat --bot jira-helper
```

```text
Bot: Jira Helper 0.1.0
Runtime: claude
Identity: local-developer

User: 幫我整理 ISSUE-1234

[run] started
[tool] jira-get-issue started
[tool] jira-get-issue completed (842ms)

Assistant:
ISSUE-1234 主要包含三項需求……
```

互動命令先保持精簡：

```text
/help
/status
/tools
/artifacts
/attach <path>
/cancel
/reset
/exit
```

第一版使用一般 stdin/stdout REPL，不先做 TUI、滑鼠操作或 dashboard。

## 三種 CLI 模式

### 單次 Agent

```bash
agent-studio run --agent code-tracer --prompt "找出登入入口"
```

直接測試 `agent-engine.runTake()`，適合驗證 Agent manifest、runtime、MCP、事件、逾時與 artifact。

### Bot 對話

```bash
agent-studio chat --bot incident-helper
```

走完整的 Terminal Adapter、Bot Runtime、Director 與 Agent Engine，適合測試多輪對話、使用者補充、進度、取消和 approval。

### Eval

```bash
agent-studio eval --bot incident-helper
```

重播固定案例，優先驗證可確定的行為：

- 選擇的 Agent
- 呼叫的工具
- 是否嘗試使用未授權工具
- 回覆 schema
- 必要引用
- Approval 是否出現
- 錯誤是否被正確分類

第一版不需要依賴另一個模型替回答打分。

## Terminal 身分與權限測試

Terminal 測試不能預設略過權限。啟動時指定測試身分與環境：

```bash
agent-studio chat \
  --bot incident-helper \
  --as oncall \
  --tenant local \
  --environment uat
```

測試 principal 範例：

```yaml
principals:
  oncall:
    id: dev-oncall
    roles:
      - oncall
    attributes:
      environments:
        - uat
      brands:
        - brand-a
```

這讓開發者可以在本機驗證：

```text
查 UAT 資料 → 允許
查 PROD 資料 → 拒絕
寫入 Jira → 需要核准
未列入 allowlist 的工具 → 不可見且不可呼叫
```

目前 `mcp-hub` 只有 tool allowlist。Principal、argument policy、approval 與 audit 尚未實作。

## Terminal Approval

預計呈現方式：

```text
[approval required]

Tool: jira-update
Target: ISSUE-1234
Action: append investigation result

Approve? [y]es / [n]o / [d]etails
```

核准狀態由 Bot Runtime 管理，Terminal 只負責收集決定。未來 Slack 或 Teams 改用按鈕，但沿用同一套 approval request、expiry、approver policy 和 payload digest。

## Debug 與 Trace

預設模式只顯示終端使用者會看到的訊息：

```bash
agent-studio chat --bot incident-helper
```

開發模式顯示執行事件：

```bash
agent-studio chat --bot incident-helper --debug
```

```text
[09:41:02] bot.run.started
[09:41:03] take.started agent=log-investigator
[09:41:04] tool.started tool=elk-search
[09:41:06] tool.completed outcome=success elapsed=1822ms
[09:41:12] take.completed
```

需要完整紀錄時輸出 JSONL：

```bash
agent-studio chat \
  --bot incident-helper \
  --trace .agent-studio/traces/session.jsonl
```

Trace 預設不得記錄 credential、完整敏感參數或未遮罩個資。

## Conversation 與 Transcript

預計允許保存與繼續本機 session：

```bash
agent-studio chat --bot incident-helper --session ./sessions/incident-001.json
agent-studio chat --bot incident-helper --resume ./sessions/incident-001.json
```

對話紀錄應分開保存：

- 使用者可見訊息
- 標準 inbound/outbound events
- Agent take summaries
- Tool call metadata
- Artifact references

成功案例之後可以整理成 eval fixture，但第一版不必自動把所有 transcript 轉成測試。

## Channel Adapter

Terminal 是第一個 reference adapter。所有 Channel Adapter 使用相同的標準型別：

```ts
interface InboundMessage {
  eventId: string;
  channel: ChannelReference;
  actor: ExternalActor;
  message: MessageContent;
  receivedAt: string;
}

type BotResponse =
  | { type: 'text'; text: string }
  | { type: 'progress'; text: string }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'file'; artifactId: string }
  | { type: 'error'; message: string; retryable: boolean };
```

Adapter 另外宣告平台能力：

```ts
interface ChannelCapabilities {
  threads: boolean;
  messageUpdate: boolean;
  buttons: boolean;
  forms: boolean;
  fileUpload: boolean;
  maxMessageLength: number;
  streaming: 'native' | 'message-update' | 'none';
}
```

Terminal 可以用 channel profile 模擬 Slack 或其他平台限制：

```bash
agent-studio chat --bot incident-helper --channel-profile slack
```

這可以在真正部署前發現訊息過長、無法更新進度或互動元件不能降級等問題。

## 預計實作順序

1. 現有 `agent-engine` CLI 與真實 Bot 流程驗證。
2. Standard Message、BotResponse 與 Terminal Adapter。
3. `simple` Director 與最小 Bot Runtime。
4. 複雜 Director 接入。
5. Conversation、identity、approval、transcript 與 eval。
6. Slack Adapter。
7. Queue、inbox/outbox 與 worker crash recovery。
8. Knowledge Provider 與 argument-level tool policy。
9. Teams 等其他 Channel Adapter。

第一個可用版本的目標流程是：

```text
複製範例
→ 寫 Agent manifest
→ 設定 MCP tools
→ 寫 bot.yaml
→ 在 Terminal 對話與除錯
→ 啟動 Slack Adapter
```

在 Terminal 尚未證明對話、工具、權限和取消行為以前，不先投入通訊平台整合或管理 UI。
