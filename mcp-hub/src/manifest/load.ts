/**
 * 讀 `manifests/mcp-servers/`,解析成 gateway 要的宣告。
 *
 * **一台 server 一個檔,連線宣告與工具面寫在一起。** 一個上游是一個東西:它在哪、
 * 怎麼連、開哪幾個工具。拆成 mcp-servers/ 與 tools/ 兩份會讓 server id 被寫三次
 * (server 的 `id`、tools 的檔名、tools 裡的 `serverId`),而三份同一個事實就會分岔。
 *
 * 合併還讓「tool 指向未宣告的 server」這個錯**寫不出來** —— 工具的 serverId 來自
 * 它所在檔案的 `id`,不再是一個可以打錯的欄位。載入時的交叉檢查因此拿掉了:
 * 讓錯誤無法表達,比攔下它更好。
 *
 * 其餘一律 fail loud:格式錯、id 重複 —— 全在載入時就炸,不留到某個 agent 半夜
 * 呼叫工具才發現。宣告了卻靜默少一個工具,比啟動失敗難查得多。
 *
 * `example.json` 是給人看的欄位說明(葉節點放的是用途描述不是值),一律略過。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { duplicateKeys } from './duplicateKeys.js';
import { PROJECT_ROOT } from '../shared/paths.js';
import type { ToolRoute } from '../types.js';

/** 宿主的 `manifests/mcp-servers/`。hub 只讀這一個目錄,不碰 `manifests/agents/`。 */
export const MCP_SERVERS_DIR = join(PROJECT_ROOT, 'manifests', 'mcp-servers');

/** 說明檔,不是配置。 */
const EXAMPLE = 'example.json';

export type Transport = 'in-memory' | 'stdio' | 'sse' | 'streamable-http';

export interface OAuthDecl {
  type: 'oauth';
  /** token 檔名(不含副檔名);省略 = server id。 */
  store: string;
  /** 要求的 scope(例 Figma 只認 `mcp:connect`)。 */
  scope?: string;
}

export interface ServerDecl {
  id: string;
  transport: Transport;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** sse / streamable-http */
  url?: string;
  /**
   * 上游要 OAuth 時宣告(只給 sse / streamable-http)。token 存在 `<oauth dir>/<store>.json`,
   * 由 `mcp-hub auth-login <server id>` 互動登入一次;之後 SDK 會自己用 refresh token 續期。
   */
  auth?: OAuthDecl;
  /**
   * 單次 `tools/call` 的逾時(毫秒)。省略 = SDK 預設 60 秒。
   * 分 server 設是因為合理耗時差一個量級:瀏覽器動作可能破 60 秒,jira 搜尋不該。
   */
  timeoutMs?: number;
  /**
   * 總耗時上限(毫秒)。省略 = 無上限。`timeoutMs` 會被進度通知重設,這是防止
   * 一直回報進度但實際卡死的上游無限期拖著的防線。
   *
   * 只在收到進度時才檢查,所以是「大約」不是「準時」:最壞情況約
   * `maxTotalTimeoutMs + timeoutMs`。要精準期限得自己另外計時,目前不做。
   */
  maxTotalTimeoutMs?: number;
  /**
   * 連線握手(`initialize`)的逾時(毫秒)。省略 = SDK 預設 60 秒。
   * 冷啟動慢的上游要調長:`uvx` 類 MCP 第一次要建 Python venv,30–60 秒以上很常見。
   */
  connectTimeoutMs?: number;
}

export interface ToolDecl extends ToolRoute {
  /** 有值就覆蓋上游的 description;沒有就用上游 `tools/list` 給的。 */
  description?: string;
  /** 由所屬 server 宣告帶下來(見 `ServerDecl.timeoutMs`),core 呼叫時直接用。 */
  timeoutMs?: number;
  /** 同上,見 `ServerDecl.maxTotalTimeoutMs`。 */
  maxTotalTimeoutMs?: number;
}

const TRANSPORTS: Transport[] = ['in-memory', 'stdio', 'sse', 'streamable-http'];

function readJsonFiles(dir: string): Array<{ file: string; body: unknown }> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e: any) {
    // 只有「目錄不存在」算作沒有宣告。權限不足、路徑指到檔案等一律往上丟 ——
    // 那些是環境壞掉,靜默當成空清單會變成「工具莫名其妙全都不見」。
    if (e?.code === 'ENOENT') return [];
    throw e;
  }
  return names
    .filter((f) => f.endsWith('.json') && f !== EXAMPLE)
    .sort()
    .map((file) => {
      const text = readFileSync(join(dir, file), 'utf8');
      const body = JSON.parse(text);
      const dup = duplicateKeys(text);
      if (dup.length) throw new Error(`${file}: 重複的 key ${dup.map((k) => `"${k}"`).join(', ')} —— JSON 會靜默保留後面那個`);
      return { file, body };
    });
}

function str(v: unknown, where: string, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${where}: ${field} 必須是非空字串`);
  return v;
}

function validateServer(raw: unknown, where: string): ServerDecl {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where}: 必須是物件`);
  const o = raw as Record<string, unknown>;
  const id = str(o.id, where, 'id');
  const transport = str(o.transport, where, 'transport') as Transport;
  if (!TRANSPORTS.includes(transport)) {
    throw new Error(`${where}: transport 必須是 ${TRANSPORTS.join(' / ')},收到 ${transport}`);
  }

  const decl: ServerDecl = { id, transport };
  // 每種 transport 需要的欄位在載入時就驗,phase 4 實作 connect() 時不必再驗一次。
  if (transport === 'stdio') {
    decl.command = str(o.command, where, 'command');
    if (o.args !== undefined) {
      if (!Array.isArray(o.args) || !o.args.every((a) => typeof a === 'string')) {
        throw new Error(`${where}: args 必須是字串陣列`);
      }
      decl.args = o.args as string[];
    }
    if (o.env !== undefined) {
      if (!o.env || typeof o.env !== 'object' || Array.isArray(o.env)) {
        throw new Error(`${where}: env 必須是物件`);
      }
      // 值要是字串:`"MAX": 3` 不擋的話,要等到連線時插值才以 TypeError 炸,看不出是哪個檔。
      const bad = Object.entries(o.env).filter(([, v]) => typeof v !== 'string').map(([k]) => k);
      if (bad.length) throw new Error(`${where}: env 的值必須是字串(${bad.join(', ')})—— 數字請加引號`);
      decl.env = o.env as Record<string, string>;
    }
  } else if (transport === 'sse' || transport === 'streamable-http') {
    decl.url = str(o.url, where, 'url');
    if (o.auth !== undefined) {
      const a = o.auth as any;
      if (!a || typeof a !== 'object' || Array.isArray(a) || a.type !== 'oauth') {
        throw new Error(`${where}: auth 必須是 { "type": "oauth", "store"?: string, "scope"?: string }`);
      }
      decl.auth = {
        type: 'oauth',
        store: a.store === undefined ? id : str(a.store, where, 'auth.store'),
        ...(a.scope === undefined ? {} : { scope: str(a.scope, where, 'auth.scope') }),
      };
      if (!/^[A-Za-z0-9_.-]+$/.test(decl.auth.store)) throw new Error(`${where}: auth.store 只能用英數、_ . -(它是檔名)`);
    }
  }
  if (o.auth !== undefined && transport !== 'sse' && transport !== 'streamable-http') {
    throw new Error(`${where}: auth 只支援 sse / streamable-http`);
  }

  for (const field of ['timeoutMs', 'maxTotalTimeoutMs', 'connectTimeoutMs'] as const) {
    const v = o[field];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new Error(`${where}: ${field} 必須是正整數毫秒`);
    }
    decl[field] = v;
  }
  if (decl.maxTotalTimeoutMs !== undefined && decl.timeoutMs !== undefined
      && decl.maxTotalTimeoutMs < decl.timeoutMs) {
    // 上限比單次逾時還短 = 第一次逾時前就被硬砍,timeoutMs 形同虛設。
    throw new Error(`${where}: maxTotalTimeoutMs 不可小於 timeoutMs`);
  }
  return decl;
}

/**
 * 同一個檔案裡的 `tools` 表 —— 這台 server 對 agent 公布的工具面。
 *
 * `{ "browser-click": "browser_click" }` 的左邊是對外的 tool id,右邊是該
 * server 上的精確工具名 —— **右邊一律照上游 `tools/list` 抄**,不要從左邊推導。
 * kebab→snake 看起來是機械對應,但 `figma-get-data` → `get_figma_data` 就不是,
 * 而「照著猜」正是 `check.ts --list-tools` 存在要抓的那種錯。
 *
 * 要覆寫給模型看的描述就把值寫成 `{ toolName, description }`。
 *
 * `tools` 省略 = 這台宣告了但一個工具都不開(例 gitlab:上游 118 個,尚無用例)。
 * 這裡不學 agent manifest 的 fail-loud —— agent 少寫 `tools` 會讓它默默沒工具可用,
 * 而 server 少寫只是沒人連得到它,沒有可以誤讀的中間狀態。
 *
 * 同一個檔裡重複的 key(`JSON.parse` 會靜默保留後者)在讀檔時由 `duplicateKeys` 擋下,
 * 所以維持物件寫法 —— 換成陣列會讓 16 個 browser 工具從 16 行變成 48 行。
 */
function validateTools(
  raw: unknown,
  serverId: string,
  limits: Pick<ServerDecl, 'timeoutMs' | 'maxTotalTimeoutMs'>,
  where: string,
): ToolDecl[] {
  const o = raw as Record<string, unknown>;
  if (o.tools === undefined) return [];
  if (!o.tools || typeof o.tools !== 'object' || Array.isArray(o.tools)) {
    throw new Error(`${where}: tools 必須是物件 { "<tool id>": "<上游工具名>" }`);
  }

  return Object.entries(o.tools as Record<string, unknown>).map(([id, value]) => {
    // 錯誤訊息指到「哪個檔的哪一條」—— 一個檔裝 16 個工具時,只講檔名不夠用。
    const at = `${where}:${id}`;
    if (!id.trim()) throw new Error(`${where}: tool id 不可為空字串`);
    const base = {
      id, serverId,
      ...(limits.timeoutMs !== undefined ? { timeoutMs: limits.timeoutMs } : {}),
      ...(limits.maxTotalTimeoutMs !== undefined
        ? { maxTotalTimeoutMs: limits.maxTotalTimeoutMs } : {}),
    };
    if (typeof value === 'string') return { ...base, toolName: str(value, at, 'toolName') };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${at}: 值必須是上游工具名,或 { toolName, description }`);
    }
    const v = value as Record<string, unknown>;
    const decl: ToolDecl = { ...base, toolName: str(v.toolName, at, 'toolName') };
    if (v.description !== undefined) decl.description = str(v.description, at, 'description');
    return decl;
  });
}

function dedupe<T extends { id: string }>(items: Array<{ file: string; decl: T }>, kind: string): T[] {
  const seen = new Map<string, string>();
  for (const { file, decl } of items) {
    const prev = seen.get(decl.id);
    if (prev) throw new Error(`duplicate ${kind} id "${decl.id}" (${prev} 與 ${file})`);
    seen.set(decl.id, file);
  }
  return items.map((i) => i.decl);
}

export interface Catalog {
  servers: ServerDecl[];
  tools: ToolDecl[];
}

/**
 * 一次讀完:每個檔同時給出「怎麼連」與「開哪些工具」。
 *
 * 不做 tool → server 的交叉檢查,因為工具的 `serverId` 是它所在檔案的 `id`,
 * 指錯這件事已經沒有語法可以表達了(見檔頭)。
 */
export function loadCatalog(dir: string = MCP_SERVERS_DIR): Catalog {
  const parsed = readJsonFiles(dir).map(({ file, body }) => {
    const at = `mcp-servers/${file}`;
    const decl = validateServer(body, at);
    // serverId 直接取自剛驗過的 decl.id —— 工具沒有自己的 serverId 欄可以打錯。
    return { file, decl, tools: validateTools(body, decl.id, decl, at) };
  });

  return {
    servers: dedupe(parsed.map(({ file, decl }) => ({ file, decl })), 'server'),
    tools: dedupe(
      parsed.flatMap(({ file, tools }) => tools.map((decl) => ({ file, decl }))),
      'tool',
    ),
  };
}

/**
 * 解析某個 agent 的允許清單。引用不存在的 tool id 一律報錯 —— 靜默忽略會讓
 * agent 少一個它以為有的工具,而且症狀出現在很後面。
 */
export function resolveAllow(catalog: Catalog, wanted: string[]): string[] {
  const known = new Set(catalog.tools.map((t) => t.id));
  const missing = wanted.filter((w) => !known.has(w));
  if (missing.length > 0) throw new Error(`未定義的 tool id: ${missing.join(', ')}`);
  return wanted;
}
