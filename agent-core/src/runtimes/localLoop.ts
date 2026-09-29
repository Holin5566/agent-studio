/**
 * 本地模型 adapter(OpenAI 相容 API:bifrost gateway / ollama)—— **尚未實作,只有規劃**。
 *
 * 跟 `claudeCli` / `codexCli` 的根本差別:那兩個 CLI 自帶 agent loop,engine 只要 spawn
 * 起來看輸出;本地模型**沒有 loop、沒有原生工具**,一次呼叫只回一輪。所以這個 adapter 只負責
 * 「一輪」的格式翻譯,tool loop 由 engine 跑(見 `run/loop.ts`)。
 *
 * ## 要做的事
 *
 * 1. 型別(放 `types.ts`):
 *    - `LoopRuntime`:`kind: 'loop'`、`name`、`capabilities`、`experimental?`,以及
 *      `turn(req, signal): AsyncIterable<TurnEvent>` —— 送一輪、串流回事件。
 *    - `TurnRequest`:`{ model?, messages, tools }`(tools 是 gateway 允許清單內的 schema)。
 *    - `TurnEvent`:`text` / `tool-call`(id、name、args)/ `usage` /
 *      `stop`(`end_turn` | `tool_use` | `max_tokens`)。
 *    - `type Runtime = SpawnRuntime | LoopRuntime`,`EngineConfig.runtime` 放寬成它
 *      (`SpawnRuntime` 的註解已預告這一步,對現有呼叫端非破壞性)。
 *
 * 2. `createLocalLoop({ baseUrl, apiKey? })`:形狀對齊 `createClaudeCli` —— 只開具名選項。
 *    - `turn()`:POST `${baseUrl}/chat/completions`(`stream: true`、帶 `tools`),
 *      SSE 解成 `TurnEvent`。signal 直接給 fetch,取消就斷線。
 *    - capabilities:`skills: false`、`nativeTools: false`、`filesystemPolicy: 'none'`、
 *      `maxSteps: true`(engine 自己跑 loop,步數觀測得到)。
 *      → 宣告了 `skills` 或 `filesystem`(要 Read / Grep)的 agent 會在 `createAgentEngine()`
 *        就被能力協商擋下,這是對的:沒工具的 agent 不能「看起來成功」。
 *
 * 3. tool call 相容性:本地模型的 tool calling 品質參差(不支援、回壞 JSON、name 不在清單)。
 *    args 解析失敗 → 當成一個 tool 錯誤回給模型讓它重來,**不要讓整個 take 掛掉**。
 *
 * ## 宿主端（不在這個套件）
 *
 * 多一個 `localEngine` singleton(同 `claudeEngine` 的 lazy + closed 寫法),
 * `runtime: createLocalLoop({ baseUrl: OPENAI_BASE_URL, apiKey: LLM_GATEWAY_KEY })`。
 * 接上後，宿主可改用 `localEngine.runTake` 並取得相同的工具與事件契約。
 *
 * ## 前置 / 相依
 *
 * - engine 端的 loop 與 in-process gateway:見 `run/loop.ts`。
 * - code-tracer 要能在本地跑,gateway 得先有 `repo-grep` / `code-refs` 這類工具
 *   (TODO「code_search MCP:Zoekt + SCIP」)—— 本地模型沒有 Bash / Read 可退。
 * - 測試用本機假的 OpenAI 相容 HTTP server,不依賴真的 bifrost。
 */
export {};
