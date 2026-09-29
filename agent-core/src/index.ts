/**
 * AgentCore 的公開介面。呼叫端只從這裡匯入。
 *
 * `createAgentCore()` 在建立時就做完載入、交叉驗證與能力協商;執行期只剩
 * 「跑一次」的紀律。業務決策(路由、扇出、reuse、synth、人工 gate)不在這裡。
 */
export type {
  AgentCapabilities,
  ArtifactKey,
  ArtifactRef,
  DraftRef,
  EventMeta,
  RuntimeDecoder,
  RuntimeEvent,
  ArtifactStore,
  CommandContext,
  Engine,
  EngineConfig,
  AgentCore,
  AgentCoreConfig,
  AgentCoreErrorKind,
  EngineErrorKind,
  PlanEntry,
  RunEvent,
  RuntimeCapabilities,
  SkillAvailability,
  SpawnCommand,
  SpawnRuntime,
  StopReason,
  TakeResult,
  TakeSpec,
  TakeStatus,
  Usage,
} from './types.js';

export { AgentCoreError, EngineError } from './types.js';
export { statusFor, isSalvageable } from './run/status.js';
export { createAgentCore, createAgentEngine } from './engine.js';
export { createMemoryStore } from './artifacts/memory.js';
export { createFileStore } from './artifacts/fileStore.js';
export { createSkillChecker, resolveClaudeConfigDir } from './agents/skills.js';
export type { SkillCheckerOpts } from './agents/skills.js';
export type { FileStoreOpts } from './artifacts/fileStore.js';
export { buildRegistry, validateManifests } from './agents/registry.js';
export { openGatewayConfig, createGatewayPool, GATEWAY_ENTRY } from './run/gateway.js';
export { execRuntime } from './run/exec.js';
export { killAllRuntimeGroups } from './run/childGroups.js';
export type { ExecOpts, ExecResult } from './run/exec.js';
export type { GatewaySession } from './run/gateway.js';
export type { AgentRegistry } from './agents/registry.js';
export { claudeCli, createClaudeCli, toolsFor } from './runtimes/claudeCli.js';
export type { ClaudeCliOptions } from './runtimes/claudeCli.js';
export { GATEWAY_SERVER_NAME } from './shared/names.js';
export { createClaudeDecoder } from './runtimes/claudeStream.js';
export { codexCli, createCodexCli, sandboxFor } from './runtimes/codexCli.js';
export type { CodexCliOptions } from './runtimes/codexCli.js';
