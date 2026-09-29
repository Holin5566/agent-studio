/**
 * 檔案型 OAuthClientProvider:hub 自己持有上游(例如 Figma remote MCP)的 OAuth 憑證。
 *
 * SDK 的 `auth()` 負責整個流程(資源探索 → AS metadata → 動態註冊 → PKCE → 換 token → 自動
 * refresh);這裡只實作它要的儲存與 redirect hook。所有狀態存在同一個檔案:
 *
 *   <MCP_HUB_OAUTH_DIR 或 ~/.config/e2e-runner/mcp-oauth>/<store>.json   (chmod 600)
 *
 * 兩種模式:
 * - `login`:`mcp-hub auth-login` 用。redirect 時把授權網址交給呼叫端(開瀏覽器)
 * - `gateway`:平常跑。**不能開瀏覽器**(伺服器上沒有),需要重新授權就直接丟錯 ——
 *   服務沒授權要說沒授權,不能讓模型以為「上游沒有這個東西」
 *
 * 見 Obsidian `MCP Hub/OAuth 與憑證.md`。
 */
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthDecl } from '../manifest/load.js';

export const DEFAULT_REDIRECT_URL = 'http://localhost:7777/callback';

export function oauthDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.MCP_HUB_OAUTH_DIR || join(homedir(), '.config', 'e2e-runner', 'mcp-oauth');
}

export function redirectUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.MCP_HUB_OAUTH_REDIRECT || DEFAULT_REDIRECT_URL;
}

interface Stored {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
}

/** gateway 模式下需要重新授權。訊息直接告訴人怎麼修。 */
export class OAuthLoginRequired extends Error {
  constructor(readonly serverId: string) {
    super(`上游 "${serverId}" 尚未授權或授權已失效 —— 請在本機執行:npm --prefix mcp-hub run auth-login -- ${serverId}`);
    this.name = 'OAuthLoginRequired';
  }
}

export class FileOAuthProvider implements OAuthClientProvider {
  readonly file: string;

  constructor(
    readonly serverId: string,
    readonly decl: OAuthDecl,
    readonly mode: 'login' | 'gateway',
    private readonly onRedirect?: (url: URL) => void | Promise<void>,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.file = join(oauthDir(env), `${decl.store}.json`);
  }

  /** 這個實例最後一次交給 SDK 的 tokens(序列化後),`invalidateCredentials` 用來判斷別人是否已經換過。 */
  private handedOut: string | undefined;

  /**
   * 壞掉的檔(寫到一半、被手改壞)先備份再當成空的 —— 直接當空的話,下一次 write 會把裡面的
   * client 註冊一起蓋掉,連手動救回都沒辦法。
   */
  private read(): Stored {
    if (!existsSync(this.file)) return {};
    const raw = readFileSync(this.file, 'utf8');
    try {
      return JSON.parse(raw);
    } catch {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try { renameSync(this.file, backup); } catch { /* 別的程序已經搬走了 */ }
      process.stderr.write(`[mcp-hub oauth] ${this.file} 無法解析,已備份到 ${backup},視為未授權\n`);
      return {};
    }
  }

  /**
   * 讀 → 合併 → 寫整段持鎖。每個 gateway 是獨立程序、共用同一個檔:不鎖的話 A 寫 tokens、
   * B 同時寫 client,其中一個會被另一個蓋掉。SDK 的 provider 介面是同步的,所以鎖也是同步的。
   */
  private write(patch: Partial<Stored> | ((current: Stored) => Stored)): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    withFileLock(`${this.file}.lock`, () => {
      const current = this.read();
      const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    });
  }

  get redirectUrl(): string { return redirectUrl(this.env); }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `jackin mcp-hub (${this.serverId})`,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.decl.scope ? { scope: this.decl.scope } : {}),
    };
  }

  /**
   * 一定要實作:Figma 宣告 `require_state_parameter: true`,SDK 又把 `state()` 當選配 ——
   * 沒實作就不帶 state,授權會被擋。登入回呼時用 `expectedState()` 比對,防 CSRF。
   */
  state(): string {
    const state = randomBytes(16).toString('hex');
    this.write({ state });
    return state;
  }

  expectedState(): string | undefined { return this.read().state; }

  clientInformation(): OAuthClientInformationMixed | undefined { return this.read().client; }
  saveClientInformation(client: OAuthClientInformationMixed): void { this.write({ client }); }

  tokens(): OAuthTokens | undefined {
    const tokens = this.read().tokens;
    this.handedOut = tokens ? JSON.stringify(tokens) : undefined;
    return tokens;
  }
  saveTokens(tokens: OAuthTokens): void {
    this.write({ tokens });
    this.handedOut = JSON.stringify(tokens);
  }

  saveCodeVerifier(codeVerifier: string): void { this.write({ codeVerifier }); }
  codeVerifier(): string {
    const v = this.read().codeVerifier;
    if (!v) throw new Error(`${this.serverId}: 沒有 PKCE code verifier(登入流程沒走完)`);
    return v;
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (this.mode === 'gateway' || !this.onRedirect) throw new OAuthLoginRequired(this.serverId);
    await this.onRedirect(url);
  }

  /**
   * 會輪替 refresh token 的上游:兩個 gateway 同時拿同一個 refresh token 去換,只有一個成功,
   * 另一個收到 invalid_grant,SDK 就叫這裡作廢 tokens —— 把**贏家剛存的新 tokens** 刪掉,
   * 之後大家都要重新登入。所以作廢 tokens 前先比對:檔裡的已經不是我交出去的那組,就是別人
   * 換過了,留著。
   */
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'discovery') return;
    this.write((s) => {
      if (scope === 'all') return {};
      const next = { ...s };
      if (scope === 'client') delete next.client;
      if (scope === 'verifier') delete next.codeVerifier;
      if (scope === 'tokens') {
        const replacedByOther = next.tokens !== undefined && JSON.stringify(next.tokens) !== this.handedOut;
        if (!replacedByOther) delete next.tokens;
      }
      return next;
    });
  }
}

/** 持鎖多久算殘留(持鎖的程序當掉了)。正常持鎖只有一次小檔讀寫,毫秒等級。 */
const STALE_LOCK_MS = 10_000;
const LOCK_WAIT_MS = 5_000;
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** `O_EXCL` 建鎖檔;搶不到就等,殘留的鎖(持有者當掉)逾期後清掉。 */
export function withFileLock<T>(lockPath: string, fn: () => T): T {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lockPath, 'wx', 0o600));
      break;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) { unlinkSync(lockPath); continue; }
      } catch { continue; } // 剛好被釋放
      if (Date.now() > deadline) throw new Error(`等不到 OAuth token 檔的鎖:${lockPath}`);
      sleepSync(10);
    }
  }
  try {
    return fn();
  } finally {
    try { unlinkSync(lockPath); } catch { /* 已被當成殘留清掉 */ }
  }
}
