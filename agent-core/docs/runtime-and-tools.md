# 執行與工具契約

## Runtime 的兩個家族

模型是可替換的（claude / codex / ollama…），但它們不是同一種東西：

| | **自帶 agent loop** | **裸模型** |
|---|---|---|
| 成員 | `claude -p`、`codex exec` | ollama 或任何 chat completions |
| 誰驅動推理迴圈 | CLI 自己 | **engine 自己** |
| engine 看得到什麼 | stdout 串流 + 退出碼 | 每一步 |
| 工具怎麼給 | MCP 設定交給 CLI，它自己決定何時叫 | engine 拿 schema 給模型、解 tool_call、執行、餵回去 |
| 要補什麼 | 一個 spawn adapter | **一整個迴圈**（`LoopRuntime`）|

換 claude ↔ codex 是換 adapter；接 ollama 是寫迴圈。差異大到不該用同一個詞掩蓋。

### 工具層兩邊共用

工具層（`mcp-hub/`，2026-09-24 起是跟本套件平行的獨立 package）當初就做成兩種消費方式，共用同一個 `core.ts`（權限、路由、三態）：

```
core.ts ── 權限 / 路由 / 三態工具結果
   ├─ gateway.ts → MCP server（stdio）    ← 自帶 loop 家族，跨程序
   └─ hub.ts     → list() / call()        ← 裸接家族，in-process
```

`Hub` 的介面（`list` / `call` / `close`）**就是 LoopRuntime 需要的 ToolPort**。所以裸接要補的只有迴圈本身，工具、權限、三態都現成。

順帶解掉一個限制：宿主注入的 builtin tools 在裸接家族**直接可用**，因為迴圈就在同一個程序，不必繞成 stdio server。

### 第一版只做子程序家族

目前正式支援的流程使用 `claude -p`。其他自帶 agent loop 的 CLI 可以透過相同 runtime contract 接入。

所以第一版只做子程序家族，而且**這個限制寫在型別名字上**：介面叫 `SpawnRuntime` 不叫 `Runtime`。

```ts
export interface SpawnRuntime {
  name: string;
  capabilities: RuntimeCapabilities;
  experimental?: string;   // 有值 = createAgentEngine 拒絕,除非 allowExperimentalRuntime
  command(ctx: CommandContext): SpawnCommand;  // { file, args, env?, cwd?, stdin? } ← 只表達得了「spawn 一個 binary」
  createDecoder?(): RuntimeDecoder;            // push(chunk) / finish() → RuntimeEvent[]
}
```

裸模型家族塞不進 `command()`，SDK 形式的 runtime 也塞不進去。**這不是「之後加一個 adapter」就能延伸的形狀**，屆時會變成：

```ts
type Runtime = SpawnRuntime | LoopRuntime;
```

現在不先定那個聯合，因為 `LoopRuntime` 還沒寫過任何一個，現在定等於憑空設計第二個分支。到時候把 `EngineConfig.runtime` 的型別放寬，對現有呼叫端是非破壞性的。

## 能力矩陣

runtime 之間**能力不等價**，manifest 必須宣告需求、engine 必須在開跑前拒絕不匹配的組合：

| manifest 宣告 | claude | codex | ollama（裸接）|
|---|:--:|:--:|:--:|
| `tools`（MCP）| ✓ | ✓ | ✓ |
| `skills`（claude plugin）| ✓ | ✗ | ✗ |
| **原生工具**（Read / Bash…）| ✓ | ✓ | **✗** |
| 檔案系統限制的表達方式 | 工具名單 + deny | 沙箱等級（`-s read-only`…）| 不適用 |
| `maxSteps` / `maxToolCalls` | 觀測不到 | 觀測不到 | ✓ 可精確限制 |
| 輸出 schema | 無 | `--output-schema` | 可自行驗證 |

不支援時要回明確的 `EngineError('capability')`（每個 agent 第一次被用到時、spawn 之前做能力協商；`engine.check()` 可在 boot 一次驗完），**不能默默用一個缺能力的 runtime 跑完**——那會產出一份「跑得動但什麼都沒查到」的報告。

### 一個連帶後果：原生工具是可攜性的阻礙

看矩陣第三列：裸接家族沒有原生工具，**一切能力只能來自 gateway**。

所以 bug 的 `code-tracer` 目前還靠 Bash 查 code 這件事，不只是「沙箱不完整」——**它讓那個 take 永遠綁死在自帶 loop 的家族**。把 Bash 用法換成 `repo-grep` / `git-grep` / `git-log` 這類 gateway 工具，是 runtime 可替換的**前置條件**，不是有空再做的清理。

## claude 與 codex 的旗標對照

兩者形狀一致（收 prompt、串流、回文字、可取消），差別只在旗標：

| 需求 | `claude -p` | `codex exec`（0.147.0）|
|---|---|---|
| 一次性執行 + prompt | `-p`，prompt 走 stdin（adapter 現行做法）| `exec -`，prompt 走 stdin（adapter 現行做法）|
| MCP 設定 | `--mcp-config <json>` + `--strict-mcp-config` | `-c mcp_servers.<name>=...`（TOML）|
| 選模型 | `--model` | `-m` |
| 串流事件 | `--output-format stream-json` | `--json`（JSONL）|
| 取最終輸出 | 解析 json 的 `.result` | `-o <file>` 直接寫檔 |
| 檔案系統限制 | 工具名單 + deny | `-s read-only \| workspace-write \| danger-full-access` |

gateway 本身**完全不用改**——MCP 是標準協議，兩邊都吃。只有設定檔的寫法不同。

## 現行 CLI 路徑

`runTake` 讀 `manifests/agents/<id>.json`。有 `tools` 的 agent 會建立單次使用的 MCP 設定，指向 `mcp-hub/dist/bin/entry.js --tools <ids>`，再以 `--strict-mcp-config --mcp-config <path>` 啟動 `claude -p`。允許清單由 engine 從 agent manifest 算好再交給 gateway（hub 不讀 agent manifest，所以 `EngineConfig.agents` 的 inline agent 也適用），CLI 只列得到該 agent 被授權的 MCP 工具。設定檔於執行結束後清理；缺少 build 產物會立即報錯。prompt 經 stdin 交給子程序（argv 有長度上限，且 `-` 開頭的 prompt 會被當成 option），子程序 cwd 預設是 `root`。`EngineConfig.env` 只寫進 gateway 的設定（`${VAR}` 插值的取值來源），不進 CLI 子程序的環境。

gateway 入口從 `mcp-hub` package 解析，manifests 相對 `PROJECT_ROOT`——兩者必須分開，否則裝成宿主的相依之後指不到（見 README）。

## 工具面是 agent 的靜態屬性

**manifest 是工具邊界的唯一事實來源，呼叫端不能覆寫。**

e2e 有幾個階段看起來「同一個 phase 有兩套工具面」（`plan` 依有沒有 RAG、`ac` 的格式 retry），但檢查後發現它們**連 prompt 也不一樣**——是不同的 agent，不是同一個 agent 換工具。變動的是宿主「跑哪個 agent」的路由，那本來就不進這一層。

不開覆寫的決定性理由：呼叫端拿不到 agent 有哪些工具。要寫覆寫清單，只能開 API 洩漏 manifest 內容，或讓呼叫端自抄一份然後慢慢分岔。

代價是多寫幾份 manifest（`plan-rag` / `plan-code` / `ac` / `ac-reformat`…），換來 mcp-hub 的 `npm run check` 驗得到每一種工具面。

## 原生工具限制：宣告意圖，不是旗標

原本的 manifest 欄位 `nativeTools` **只有宣告，沒有執行效果**，已移除，改成下面的 `capabilities`（claude 由 `toolsFor` 翻成 `--tools`）。沒宣告 `capabilities` 的 agent 仍不下 `--tools`、Bash 全開，那種 agent 的強制允許清單只涵蓋 Gateway 暴露的 MCP 工具，**不能稱為完整工具沙箱**：模型繞過 gateway 直接 `bash grep` 是做得到的。（`RuntimeCapabilities.nativeTools` 是 runtime 有沒有原生工具，跟這裡無關。）

原生工具限制必須能 **deny**，不只是 allow。例如只需產生文字的 take 應能明確禁止寫檔與 Shell，避免模型把外部副作用誤當成輸出。

### 但當時的欄位形狀是錯的

```json
"nativeTools": ["Read", "Grep"]     // ← 這是 claude 的詞彙
```

同一件事在 codex 上是沙箱等級（`-s read-only`），在裸接家族則沒有原生工具。不同 adapter 必須將共同意圖翻譯成各自能落實的限制。

所以 manifest 該宣告意圖，由各 adapter 翻譯：

```json
"capabilities": { "filesystem": "read-only", "shell": false }
```

**（已照此改完。）** 當時改是免費的，因為 `nativeTools` 還沒有任何實作、沒有相容包袱。等它實作成 `--tools` 直通、外面有一批 manifest 在用了，再改就是 migration。還沒實作的欄位，正是現在要定對的那一個。

實作時兩個家族要同時寫翻譯，兩邊都通才算做對。

## 三態工具結果

- **查無**：工具正常完成，沒有符合資料；模型可據此縮小推論。
- **失敗**：服務、參數、ref 或連線出錯；以 `ToolFailure`／MCP `isError` 告知，不能偽裝成查無。
- **取消**：AbortError 原樣傳遞，不能當作工具故障或空結果。

這個區分直接影響事故分析。若「RAG 服務不可用」變成「code 不存在」，後續結論就建立在錯誤前提上。

工具實作者自己要分清楚這三態，這是刻意的負擔——把它自動化（例如「throw 就當查無」）等於毀掉它。

## 內建工具的掛法

套件自己不帶任何工具，`BUILTIN_TOOLS` 永遠是空的。宿主經 `openGateway({ builtinTools })` 或 `createClientRegistry(..., builtinTools)` 注入，工具仍須在 `manifests/mcp-servers/` 宣告一台 `transport: "in-memory"` 的 server 才路由得到。

注入只對 **in-process** 有效。走 `claude -p` 的 take 在另一個程序，傳不了 JS 物件——那條路要讓工具成為真正的 stdio MCP server。這也是比較推薦的做法：兩邊同時生效、工具崩潰不拖垮宿主，代價是多一次跨程序往返。

宣告多台 in-memory server 又要注入工具時會直接報錯——「哪台提供哪些工具」沒有答案，不如擋下來。

## ACP：吃形狀，不吃相依

[Agent Client Protocol](https://agentclientprotocol.com/) 是 Zed 做的協議，用意跟 LSP 一樣：解決「N 個 client × M 個 coding agent」。它標準化的正好是這裡本來要自己發明的那一層——事件流、取消、用量、權限請求。

**支援現況（2026-09 查證）**：

| Agent | 支援 | 怎麼接 | 誰維護 |
|---|---|---|---|
| Gemini CLI | 原生 | `--acp` | Google |
| GitHub Copilot CLI | 原生 | `--acp` | GitHub |
| **Claude Code** | **adapter** | `npx @zed-industries/claude-code-acp` | **Zed**，非 Anthropic |
| **Codex CLI** | **adapter** | `codex-acp` | ACP 專案／社群 |

**決定：現在對齊事件與狀態的形狀，不接 ACP transport。**

對齊的三項已經落地：`plan` 事件、`StopReason`、`TakeStatus` 的 `timeout` → `truncated`。理由是這幾個當時**一行實作都還沒有**，改起來免費；等兩套 parser 寫完、事件名散進宿主的 heartbeat 程式碼，再改就是 migration。

不接 transport 的理由是：最在意的兩家都靠**非原廠維護的 adapter**，上游 CLI 改版時多一層等待。等真的需要「換 agent 不改程式」時再加 `AcpRuntime`，屆時零 migration。

**互補而非重疊**：ACP 的工具粒度是「一整台 MCP server」，給或不給；「這個 agent 只能用這台上的三個工具」是 mcp-hub 的事。而 ACP 規定 stdio 是所有 agent 的必備能力，所以現在的 `mcp-hub/dist/bin/entry.js` 對每一個 ACP agent 都通。

⚠️ 連帶修正：先前評估過「把 gateway 改成 engine 內部的 loopback HTTP server」以砍掉子程序。**那會跟 ACP 衝突**——http 在 ACP 是選配（要 agent 宣告 `mcpCapabilities.http`）。stdio 入口必須保留為可攜路徑，in-process HTTP 只能當 runtime 支援時的最佳化。

## 落地順序

1. **`claude -p`**（已有）——先把單一 runtime 的 take 做對，之後加第二種才有對照基準。
2. **`codex exec`**——最便宜的可攜性驗證：只是換 adapter，而且能力矩陣相近。第二個 adapter 通了，才算證明介面沒有偷偷綁死在 claude 上。
3. **`LoopRuntime`（ollama 等裸模型）**——要寫迴圈，但工具層現成（`Hub`）。引入時它遵守同一份 take 結果與事件契約，能力不等價時由預檢拒絕。

是否用 Claude Agent SDK 取代 spawn，取決於 stream-json parser 的維護成本，或是否需要逐次工具核可與活 session 互動。e2e 的 executor 已經在用 `--output-format stream-json` 配一支 python filter 解析，有實作可參考。

暫不導入 LangChain、LangGraph 或通用 Director。
