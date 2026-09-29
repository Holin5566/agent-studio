# Agent Studio

Agent Studio 目前是一組 TypeScript 套件，用來從後端程式啟動一次 CLI Agent 執行，並限制它可使用的 MCP 工具。

長期希望把它發展成通訊軟體 Bot 的共用 library，讓不同 Bot 共用執行、工具權限、知識檢索與 Slack／Teams 等通訊介面。不過這些能力大多仍在規劃中；目前專案還不是完整的 Bot framework。

## 現有範圍

| 套件 | 已實作 | 文件 |
|---|---|---|
| `agent-engine` | Agent manifest、CLI runtime、執行、取消、逾時、事件、usage、partial output 與產物 | [README](agent-engine/README.md) |
| `mcp-hub` | 上游 MCP 連線、工具 catalog、工具 allowlist、轉發與連線清理 | [README](mcp-hub/README.md) |

依賴方向是 `host → agent-engine → mcp-hub`。兩個套件放在相鄰目錄，透過 `file:../mcp-hub` 與 TypeScript project reference 建置。

Engine 的邊界是執行一個 Agent 的一次 take。它目前不負責：

- Slack、Teams、LINE 等通訊軟體串接
- Conversation、thread 或長期記憶
- 多個 take 的路由、平行執行、彙整與人工 gate
- 身分登入、角色與 tenant 權限
- Knowledge Base 的匯入、索引與檢索
- Bot 建立介面、部署、版本與回滾

這些功能應由宿主處理，或在後續獨立的 Bot Runtime 實作，不放進單次 take 的執行核心。

## 想解決的使用情境

目標使用方式是讓開發者建立一個 Bot 定義，選擇 Agent、工具與知識來源，再把同一套 Bot 邏輯接到不同通訊軟體：

```text
Slack / Teams / LINE
          │
          ▼
    Channel Adapter       尚未實作
          │
          ▼
      Bot Runtime         尚未實作
          │
          ▼
     agent-engine         已實作，仍需真實 Bot 驗證
          │
          ▼
       mcp-hub            已實作 tool allowlist
          │
          ▼
 Jira / DB / ELK / Git / other MCP servers
```

預期 Bot 最終需要四類能力：

1. **通訊介面**：把各平台的訊息、thread、附件和互動元件轉成共通格式。
2. **Agent 執行**：處理 tool loop、逾時、取消、進度、錯誤與產物。
3. **工具權限**：限制 Bot 能看到的工具，並逐步加入使用者身分、參數政策、人工核准與 audit。
4. **知識檢索**：透過可替換的 provider 查詢企業文件或既有搜尋系統，不綁定特定向量資料庫。

目前只有第 2 項的 CLI runtime，以及第 3 項的 MCP tool allowlist 有實作。其他項目不能視為現有功能。

## 接下來的驗證順序

1. 用一條真實 Bot 流程驗證 `agent-engine`，比對新舊結果、取消、逾時和產物行為。
2. 通過後再遷移其餘 take，確認 engine API 足以支援實際流程。
3. 定義最小的訊息與 Bot Runtime contract，先接一個 Slack Bot。
4. 再建立一個較簡單的 Bot；如果它仍需要修改 engine，表示共用邊界還沒有穩定。
5. 第二個 Bot 能只靠設定和少量業務程式建立後，再考慮 Teams、Knowledge Provider、Blueprint 或管理介面。

近期不打算自建完整 workflow engine、統一聊天 UI、模型託管服務或向量資料庫。

較完整的 Terminal-first 開發流程與預計 API，見 [Bot Library 預計使用流程](docs/bot-library-usage.md)。

## 開始使用目前的 Engine

需要 Node.js 18 以上及 npm；實際執行 Claude agent 另需可用的 Claude CLI 與登入環境。

```bash
npm run setup
npm run build
npm test
```

測試包含模擬 runtime 與本機 MCP server，不需要真實模型帳號。宿主自行提供 agent manifest、prompt、workspace 及上游憑證；範例放在各套件的 `manifests/`。

```js
const { createAgentEngine } = require('./agent-engine');
const engine = createAgentEngine({ root: '/path/to/host' });
// 宿主在 manifests/agents/hello.json 宣告 { "id": "hello", "tools": [] }
async function main() {
  try {
    const result = await engine.runTake({ agent: 'hello', prompt: 'Hello' });
    console.log(result.output);
  } finally {
    await engine.close();
  }
}
main().catch(console.error);
```

責任邊界見 [架構](docs/architecture.md)。
