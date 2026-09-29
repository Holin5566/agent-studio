/**
 * `claude -p` adapter。
 *
 * 只負責「指令長什麼樣」—— spawn、串流、逾時、取消、產物、事件全在 engine。
 * 這支檔案薄是設計的結果,不是偷懶。
 */
import type { AgentCapabilities, CommandContext, SpawnRuntime, SpawnCommand } from '../types.js';
import { createClaudeDecoder } from './claudeStream.js';

/**
 * 只讀的原生工具。`filesystem: 'read-only'` 時開這些,其餘一律不給。
 *
 * ⚠️ 用 `--tools` 不是 `--allowedTools`:實測 `--allowedTools` 不控制可用範圍。
 * CLI 旗標的實際限制行為仍需由 runtime conformance test 驗證。
 */
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];

/**
 * `filesystem` + `shell` 兩個意圖翻成一份工具名單。
 *
 * **宣告了 `capabilities` 就是一份完整聲明:沒寫到的一律不給。** 例如只寫
 * `{ shell: true }` 代表「只能跑 shell,連讀檔都不行」,不是「可以跑 shell,其餘
 * 照舊」。權限邊界的預設方向只能是收緊 —— 不然漏寫一個欄位就是默默開一個洞。
 *
 * 完全不宣告 `capabilities` = 不限制(回 undefined,不下 `--tools`)。
 */
export function toolsFor(caps: AgentCapabilities | undefined): string[] | undefined {
  if (!caps || (caps.filesystem === undefined && caps.shell === undefined)) return undefined;

  const tools: string[] = [];
  // 'none' 代表連讀都不行 —— 不加任何檔案工具。
  if (caps.filesystem === 'read-only' || caps.filesystem === 'workspace-write') {
    tools.push(...READ_ONLY_TOOLS);
  }
  if (caps.filesystem === 'workspace-write') tools.push('Write', 'Edit');
  if (caps.shell === true) tools.push('Bash');
  return tools;
}

/**
 * 宿主可調的部分。**只開具名選項,不開任意參數**:工具範圍、MCP 來源、模型、輸出格式由
 * manifest 決定,宿主沒有管道附一組 `--mcp-config` / `--tools` 繞過 gateway 的邊界。
 * 要新的 CLI 旗標就在這裡加一個選項。
 */
export interface ClaudeCliOptions {
  /** `--settings <file>`:疊在使用者設定之上(例如關掉宿主用不到的 plugin)。 */
  settings?: string;
  /** `--dangerously-skip-permissions`:headless 執行不停下來問權限。工具範圍仍由 `--tools` 與 gateway 限制。 */
  skipPermissions?: boolean;
  /**
   * 不讓子程序繼承的環境變數。例如 `ANTHROPIC_API_KEY`:它在的話 `claude -p` 會靜默改走
   * 計費 API 而不是訂閱,額度一耗盡每次呼叫都失敗。
   */
  unsetEnv?: string[];
}

export function createClaudeCli(opts: ClaudeCliOptions = {}): SpawnRuntime {
  const unset = opts.unsetEnv?.length ? Object.fromEntries(opts.unsetEnv.map((k) => [k, undefined])) : undefined;
  return {
    name: 'claude-cli',

    capabilities: {
      skills: true,
      nativeTools: true,
      // 用工具名單表達檔案系統限制,所以 deny 要靠「不列進名單」達成。
      filesystemPolicy: 'tool-list',
      // `claude -p` 自帶 agent loop,外面觀測不到步數 —— 不可宣告 maxSteps。
      maxSteps: false,
    },

    command({ prompt, mcpConfigPath, capabilities, skills, model }: CommandContext): SpawnCommand {
      const tools = toolsFor(capabilities);
      return {
        file: 'claude',
        // prompt 走 stdin(見 SpawnCommand.stdin):`-p` 沒有位置參數時從 stdin 讀。
        stdin: prompt,
        ...(unset ? { env: unset } : {}),
        args: [
          '-p',
          // **一律帶 `--strict-mcp-config`,即使沒有 gateway。**
          //
          // 實測:少了它,一個宣告 `tools: []` 的 agent 會繼承使用者全域設定的
          // 每一台 MCP server —— Gmail、Google Drive、Figma 全都在。而 `--tools`
          // 只管得到原生工具,對 `mcp__*` 完全無效,所以擋不住這條。
          //
          // 「沒有工具」的 agent 能寄信,是這包程式最不該出現的失敗。
          '--strict-mcp-config',
          ...(mcpConfigPath ? ['--mcp-config', mcpConfigPath] : []),
          // 空陣列是有意義的值(全關),所以判 undefined 而不是判長度。
          ...(tools !== undefined ? ['--tools', tools.join(',')] : []),
          ...(model ? ['--model', model] : []),
          // skill 跟工具同一個原則:manifest 沒宣告就不給。slash command 是 skill 的入口,
          // 沒宣告 skills 的 agent 一律關掉 —— 否則它能叫出使用者裝的任何 plugin。
          ...(skills?.length ? [] : ['--disable-slash-commands']),
          ...(opts.settings ? ['--settings', opts.settings] : []),
          ...(opts.skipPermissions ? ['--dangerously-skip-permissions'] : []),
          // stream-json 才有 tool_use / tool_result / usage 可解;`-p` 配它時
          // CLI 要求一併給 --verbose,否則會拒絕啟動。
          '--output-format', 'stream-json', '--verbose',
        ],
      };
    },

    createDecoder: createClaudeDecoder,
  };
}

/** 不帶任何選項的預設 adapter(`createAgentEngine` 省略 runtime 時用它)。 */
export const claudeCli: SpawnRuntime = createClaudeCli();
