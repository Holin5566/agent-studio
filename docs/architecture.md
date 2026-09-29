# JackIn 架構

```text
Agency（CLI 或服務）
  └─ agent-core
      ├─ agents/：manifest、驗證與 skill 預檢
      ├─ run/：執行、gateway 與子程序生命週期
      ├─ runtimes/：CLI runtime adapters
      ├─ artifacts/：記憶體與檔案產物
      └─ mcp-hub
          ├─ manifest/：上游宣告與工具目錄
          ├─ upstream/：連線、傳輸與 OAuth
          └─ bin/：stdio gateway、check 與 auth-login
```

AgentCore 執行一個 Agent 的一次 take。未來由 Agency 串接 Desk、Dispatcher、Assignment、Casebook、Policy 與 Agent。MCP Hub 接收 AgentCore 算出的 Capability 允許清單，不讀 Agent manifest，也不處理通訊服務業務。

詳細說明見 [核心命名與責任邊界](naming-and-boundaries.md)、[AgentCore](../agent-core/README.md)、[MCP Hub](../mcp-hub/README.md) 與 [預計使用流程](bot-library-usage.md)。
