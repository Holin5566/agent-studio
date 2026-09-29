/**
 * engine 建立時不做 IO,每個 agent 第一次被用到才載入並驗證。
 *
 * 動機:宿主要能在 module 頂層 `export const engine = createAgentEngine(...)` —— import 沒有
 * 副作用,也不必自己包一層 lazy。代價由「故障範圍 = 一個 agent」補回:一份壞掉的 manifest
 * 不能拖垮同一個 engine 上的其他 agent。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentEngine } from '../engine.js';
import { createMemoryStore } from '../artifacts/memory.js';
import type { Engine, RunEvent, SpawnRuntime } from '../types.js';

let root = '';
let engine: Engine | undefined;
afterEach(async () => {
  await engine?.close(); engine = undefined;
  if (root) rmSync(root, { recursive: true, force: true }); root = '';
});

const agentsDir = () => join(root, 'manifests', 'agents');

/** 一個好的 agent、一個工具不存在的 agent、一份壞 JSON。catalog 是空的。 */
function brokenRoot(): string {
  root = mkdtempSync(join(tmpdir(), 'lazy-agents-'));
  mkdirSync(agentsDir(), { recursive: true });
  mkdirSync(join(root, 'manifests', 'mcp-servers'), { recursive: true });
  writeFileSync(join(agentsDir(), 'ok.json'), JSON.stringify({ id: 'ok', tools: [] }));
  writeFileSync(join(agentsDir(), 'bad-tool.json'), JSON.stringify({ id: 'bad-tool', tools: ['does-not-exist'] }));
  writeFileSync(join(agentsDir(), 'broken.json'), '{ not json');
  return root;
}

const echo: SpawnRuntime = {
  name: 'echo',
  capabilities: { skills: true, nativeTools: true, filesystemPolicy: 'tool-list', maxSteps: false },
  command: (ctx) => ({ file: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1])', ctx.prompt] }),
};

function make(r: string) {
  engine = createAgentEngine({ root: r, runtime: echo, log: () => {}, artifacts: createMemoryStore() });
  return engine;
}

describe('建立時不做 IO', () => {
  it('root 不存在也建得起來;錯誤出在用到 agent 的那一刻', async () => {
    const e = make(join(tmpdir(), `no-such-root-${Date.now()}`));
    await expect(e.runTake({ agent: 'x', prompt: 'p' })).rejects.toMatchObject({ kind: 'config' });
  });

  it('壞掉的 manifest 不影響建立', () => {
    expect(() => make(brokenRoot())).not.toThrow();
  });
});

describe('故障範圍 = 一個 agent', () => {
  it('同一個 engine 上,壞掉的 agent 被拒,好的照常跑', async () => {
    const e = make(brokenRoot());
    await expect(e.runTake({ agent: 'bad-tool', prompt: 'p' })).rejects.toThrow(/bad-tool.*does-not-exist/);
    const ok = await e.runTake({ agent: 'ok', prompt: 'hello' });
    expect(ok).toMatchObject({ status: 'ok', output: 'hello' });
  });

  it('被拒的 agent 不發事件、不 spawn', async () => {
    const events: RunEvent[] = [];
    const e = make(brokenRoot());
    await expect(e.runTake({ agent: 'bad-tool', prompt: 'p', onEvent: (ev) => { events.push(ev); } })).rejects.toBeDefined();
    expect(events).toEqual([]);
  });

  it('失敗不快取:修好 manifest,下一次 take 就能跑', async () => {
    const e = make(brokenRoot());
    await expect(e.runTake({ agent: 'bad-tool', prompt: 'p' })).rejects.toBeDefined();
    writeFileSync(join(agentsDir(), 'bad-tool.json'), JSON.stringify({ id: 'bad-tool', tools: [] }));
    expect((await e.runTake({ agent: 'bad-tool', prompt: 'fixed' })).output).toBe('fixed');
  });

  it('成功會快取:之後檔案壞掉,已載入的 agent 不受影響', async () => {
    const e = make(brokenRoot());
    await e.runTake({ agent: 'ok', prompt: 'p' });
    writeFileSync(join(agentsDir(), 'ok.json'), '{ broken now');
    expect((await e.runTake({ agent: 'ok', prompt: 'still' })).output).toBe('still');
  });
});

describe('check():boot 時 fail fast', () => {
  it('全量驗證,壞掉就丟;修好後回傳驗過的 id', () => {
    const e = make(brokenRoot());
    expect(() => e.check()).toThrow();
    writeFileSync(join(agentsDir(), 'bad-tool.json'), JSON.stringify({ id: 'bad-tool', tools: [] }));
    rmSync(join(agentsDir(), 'broken.json'));
    expect(e.check()).toEqual(['bad-tool', 'ok']);
  });

  it('有 agentIds 就只驗那幾個,也只准用那幾個', async () => {
    engine = createAgentEngine({ root: brokenRoot(), runtime: echo, agentIds: ['ok'], log: () => {}, artifacts: createMemoryStore() });
    expect(engine.check()).toEqual(['ok']);
    await expect(engine.runTake({ agent: 'bad-tool', prompt: 'p' })).rejects.toThrow(/只用 ok/);
  });
});
