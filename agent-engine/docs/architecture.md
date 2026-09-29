# Agent Engine 架構

## Take

Take 是一個 Agent 的一次執行。`runTake` 會：

1. 載入並驗證 Agent manifest。
2. 檢查 runtime 能否落實宣告的能力。
3. 依 manifest 建立本次執行的 MCP tool allowlist。
4. 啟動 runtime，正規化事件並串流寫入 artifact draft。
5. 處理完成、取消、逾時、輸出上限與 cleanup。
6. 只在輸出可用時 commit 正式 artifact。

呼叫端提供完整 prompt；輸出解析與 salvage 完整性判斷可由呼叫端注入。

## Director

Director 位於宿主。它決定要執行哪些 take、是否平行、何時重用結果、何時等待人工輸入，以及如何整合多次執行。

Agent Engine 不定義通用 workflow DSL，避免把特定 Bot 的流程變成所有呼叫端都必須實作的欄位。

## Runtime

Runtime adapter 將通用執行請求轉成特定 CLI 或模型 API 的呼叫。目前正式路徑是 Claude CLI；Codex CLI adapter 仍為 experimental。

Runtime 必須：

- 在執行前驗證能力需求
- 接收 workspace、env、signal 與工具設定
- 依序傳遞正規化事件
- 將停止原因轉成通用 `stopReason`
- 在有限時間內完成資源清理，或回報 `unconfirmed`

## Artifact

Engine 先將串流輸出寫入 draft。正常完成或 salvage 判斷通過後才 commit；錯誤和取消不產生正式 artifact。

Artifact Store 可替換，讓宿主選擇本機檔案、記憶體或其他儲存方式，而不改變 take lifecycle。

## MCP Hub

Engine 從 Agent manifest 計算工具允許清單，再交給 MCP Hub。Hub 只列出被允許的工具，呼叫未授權工具時直接拒絕，不轉發上游。

MCP allowlist 限制模型透過 gateway 使用的工具。它不限制具有 Shell 能力的程序自行讀檔或連網，因此不能取代 OS sandbox。
