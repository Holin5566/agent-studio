/**
 * engine 自己跑的 tool loop(給 `LoopRuntime`,見 `runtimes/localLoop.ts`)—— **尚未實作,只有規劃**。
 *
 * spawn 家族的 take 走 `exec.ts`(子程序自帶 loop);loop 家族走這裡。`engine.ts` 依
 * `runtime.kind === 'loop'` 分流,**外層全部沿用**:事件編號、串流落盤、逾時、取消、salvage、
 * 產物提交、`TakeResult` 形狀都不變 —— 宿主看不出這個 take 是哪一種 runtime 跑的。
 *
 * ## loop 流程
 *
 * ```
 * tools    = gateway.listTools()                  // mcp-hub 已套好 manifest 的允許清單
 * messages = [{ role: 'user', content: prompt }]
 * 每一步(最多 maxSteps):
 *   runtime.turn({ model, messages, tools })     // 串流一輪
 *     text      → 發 `text` 事件 + store.append(draft)
 *     tool-call → 收集
 *     usage     → 累加
 *     stop: max_tokens → 收尾 truncated / max_tokens
 *   messages 加上 assistant(文字 + tool calls)
 *   沒有 tool call → 收尾 ok / end_turn
 *   每個 tool call:
 *     發 tool-start → gateway.callTool(name, args, { signal }) → 發 tool-end
 *     messages 加上 tool 結果(錯誤也回給模型,不中斷 take)
 * 步數用完 → 收尾 truncated / max_turn_requests(可 salvage)
 * ```
 *
 * ## 要做的事
 *
 * 1. **in-process gateway**:現在的 gateway 是寫一份設定檔交給 CLI 自己連(`gateway.ts`
 *    `openGatewayConfig`)。loop 家族要 engine 自己當 MCP client —— 改用 mcp-hub 的
 *    `openGateway()` 直接 `listTools` / `callTool`。允許清單照樣在 hub 落實:不在清單的
 *    tool 呼叫由 hub 拒絕,不靠 prompt。
 *    附帶好處:`EngineConfig.builtinTools` 在這條路上可以真的生效(目前一律拒絕)。
 * 2. **`TakeSpec.maxSteps`**:新欄位,只有 loop 家族能精確限制(`RuntimeCapabilities.maxSteps`)。
 *    spawn 家族宣告了要回 `EngineError('capability')`,不要默默忽略。
 * 3. **取消與逾時**:同一個 signal 給 `turn()` 的 fetch 與 `callTool()`;wall-clock 逾時
 *    沿用 `timeoutMs`,從 `startedAt` 起算。子程序 / process group 那套不適用。
 * 4. **終止原因對照**:`end_turn` → ok;`max_tokens` / 步數用完 / 逾時 → truncated
 *    (走 salvage);取消 → cancelled;HTTP 失敗 → error(`runtime`,可重試)。
 *    額度類錯誤(HTTP 429 且帶額度訊息)要不要映射成 `quota` 待確認 bifrost 的回應格式。
 * 5. **工具結果大小**:tool 回傳可能很大(log、查詢結果),塞回 messages 前要有上限,
 *    否則幾輪就撐爆本地模型的 context。上限值與截斷方式待定。
 *
 * ## 測試
 *
 * 假的 LoopRuntime(依腳本回 text / tool-call)+ 真的 in-process gateway:
 * 驗事件順序、允許清單外的 tool 被拒、步數上限、取消、逾時 salvage、tool 錯誤不中斷 take。
 */
export {};
