# Agent Studio 架構

```text
宿主（CLI、服務、Bot Runtime）
  └─ agent-engine
      ├─ agents/：manifest、驗證與 skill 預檢
      ├─ run/：執行、gateway 與子程序生命週期
      ├─ runtimes/：CLI runtime adapters
      ├─ artifacts/：記憶體與檔案產物
      └─ mcp-hub
          ├─ manifest/：上游宣告與工具目錄
          ├─ upstream/：連線、傳輸與 OAuth
          └─ bin/：stdio gateway、check 與 auth-login
```

Engine 執行一個 Agent 的一次 take。宿主負責 prompt、conversation、路由、編排和結果解讀。MCP Hub 接收 Engine 算出的工具允許清單，不讀 Agent manifest，也不處理 Bot 業務。

詳細說明見 [Agent Engine](../agent-engine/README.md)、[MCP Hub](../mcp-hub/README.md) 與 [Bot Library 預計使用流程](bot-library-usage.md)。
