// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openClawIsolation, assertIsolatedOpenClawConfig } from '../../electron/utils/openclaw-isolation';
import { getOpenClawConfigDir } from '../../electron/utils/paths';
import { getGatewayRuntimePort } from '../../electron/utils/config';
import { localOnboardingUserData } from '../../electron/utils/local-onboarding';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'clawx-isolation-'))); roots.push(root);
  for (const name of ['state', 'data', 'workspaces', 'original']) mkdirSync(join(root, name));
  const env = {
    CLAWX_ISOLATED_OPENCLAW: '1', CLAWX_LOCAL_ONBOARDING: '1', CLAWX_USER_DATA_DIR: join(root, 'data'),
    OPENCLAW_STATE_DIR: join(root, 'state'), OPENCLAW_CONFIG_PATH: join(root, 'state', 'openclaw.json'),
    CLAWX_ISOLATED_WORKSPACE_DIR: join(root, 'workspaces'), CLAWX_ISOLATION_PROTECTED_DIRS: JSON.stringify([join(root, 'original')]),
    CLAWX_PORT_OPENCLAW_GATEWAY: '18791', CLAWX_PORT_CLAWX_HOST_API: '13212',
  };
  const config = { gateway: { port: 18791 }, agents: { list: [{ id: 'synthetic', workspace: join(root, 'workspaces', 'worker'), agentDir: join(root, 'state', 'agents', 'synthetic', 'agent') }] } };
  writeFileSync(env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
  return { root, env, config };
}
describe('explicit real OpenClaw isolation', () => {
  it('keeps the default paths and port without an opt-in', () => {
    expect(openClawIsolation({ OPENCLAW_STATE_DIR: '/ignored' })).toBeUndefined();
    expect(getOpenClawConfigDir()).toBe(join(homedir(), '.openclaw'));
    expect(getGatewayRuntimePort()).toBe(18789);
  });
  it('resolves one explicit Main config and port without claiming child execution', () => {
    const { env } = fixture(); for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const selected = openClawIsolation()!;
    expect(getOpenClawConfigDir()).toBe(selected.stateDir);
    expect(join(getOpenClawConfigDir(), 'openclaw.json')).toBe(selected.configPath);
    expect(getGatewayRuntimePort()).toBe(18791);
    expect(localOnboardingUserData()).toBe(selected.userData);
    expect(process.env.OPENCLAW_STATE_DIR).toBe(selected.stateDir);
    expect(process.env.OPENCLAW_CONFIG_PATH).toBe(selected.configPath);
  });
  it.each(['CLAWX_LOCAL_ONBOARDING', 'OPENCLAW_STATE_DIR', 'OPENCLAW_CONFIG_PATH', 'CLAWX_USER_DATA_DIR', 'CLAWX_ISOLATED_WORKSPACE_DIR', 'CLAWX_ISOLATION_PROTECTED_DIRS', 'CLAWX_PORT_OPENCLAW_GATEWAY', 'CLAWX_PORT_CLAWX_HOST_API'])('fails closed without %s', (key) => {
    const { env } = fixture(); delete (env as NodeJS.ProcessEnv)[key]; expect(() => openClawIsolation(env)).toThrow();
  });
  it('refuses E2E mode and relative paths', () => {
    const { env } = fixture(); expect(() => openClawIsolation({ ...env, CLAWX_E2E: '1' })).toThrow();
    expect(() => openClawIsolation({ ...env, OPENCLAW_STATE_DIR: 'relative' })).toThrow();
  });
  it.each(['state-in-original', 'workspace-in-original', 'data-in-original', 'overlapping-roots', 'home-state'])('rejects %s', (kind) => {
    const { env, root } = fixture();
    if (kind === 'state-in-original') { env.OPENCLAW_STATE_DIR = join(root, 'original'); env.OPENCLAW_CONFIG_PATH = join(env.OPENCLAW_STATE_DIR, 'openclaw.json'); }
    if (kind === 'workspace-in-original') env.CLAWX_ISOLATED_WORKSPACE_DIR = join(root, 'original', 'nested');
    if (kind === 'data-in-original') env.CLAWX_USER_DATA_DIR = join(root, 'original');
    if (kind === 'overlapping-roots') env.CLAWX_USER_DATA_DIR = join(root, 'state', 'data');
    if (kind === 'home-state') { env.OPENCLAW_STATE_DIR = join(homedir(), '.openclaw'); env.OPENCLAW_CONFIG_PATH = join(env.OPENCLAW_STATE_DIR, 'openclaw.json'); }
    expect(() => openClawIsolation(env)).toThrow();
  });
  it('rejects symlink aliases and dangling symlinks instead of crossing protection roots', () => {
    const { env, root } = fixture(); symlinkSync(join(root, 'original'), join(root, 'alias'), 'dir');
    expect(() => openClawIsolation({ ...env, CLAWX_USER_DATA_DIR: join(root, 'alias') })).toThrow();
    symlinkSync(join(root, 'missing'), join(root, 'dangling'), 'dir');
    expect(() => openClawIsolation({ ...env, CLAWX_USER_DATA_DIR: join(root, 'dangling') })).toThrow();
  });
  it.each(['18789', '13210', '13211', '0', '65536', 'abc'])('rejects unsafe port %s', (port) => {
    const { env } = fixture(); expect(() => openClawIsolation({ ...env, CLAWX_PORT_OPENCLAW_GATEWAY: port })).toThrow();
  });
  it('rejects mismatched config path, equal ports and escaped agent directories', () => {
    const { env, root, config } = fixture();
    expect(() => openClawIsolation({ ...env, OPENCLAW_CONFIG_PATH: join(root, 'different.json') })).toThrow();
    expect(() => openClawIsolation({ ...env, CLAWX_PORT_OPENCLAW_GATEWAY: '13212' })).toThrow();
    config.agents.list[0].workspace = join(root, 'original'); writeFileSync(env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
    expect(() => assertIsolatedOpenClawConfig(env)).toThrow('workspace');
    config.agents.list[0].workspace = join(root, 'workspaces', 'worker'); config.agents.list[0].agentDir = join(root, 'original', 'agent'); writeFileSync(env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
    expect(() => assertIsolatedOpenClawConfig(env)).toThrow('directory');
  });
  it('fails startup before side effects when config port differs', () => {
    const { env, config } = fixture(); config.gateway.port = 18789; writeFileSync(env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
    expect(() => localOnboardingUserData(env)).toThrow('ports differ');
  });
});
