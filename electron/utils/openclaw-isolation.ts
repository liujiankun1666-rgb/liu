import { existsSync, readFileSync, realpathSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

export interface OpenClawIsolation {
  stateDir: string; configPath: string; workspaceRoot: string; userData: string;
  gatewayPort: number; hostPort: number;
}
function canonical(input: string): string {
  const suffix: string[] = []; let cursor = resolve(input);
  while (!existsSync(cursor)) {
    try { lstatSync(cursor); throw new Error('Unresolved existing isolation path'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(cursor); if (parent === cursor) throw new Error('Cannot resolve isolation directory');
    suffix.unshift(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1))); cursor = parent;
  }
  return resolve(realpathSync(cursor), ...suffix);
}
function nested(root: string, item: string): boolean {
  const rel = relative(root, item); return !rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
function overlaps(a: string, b: string): boolean { return nested(a, b) || nested(b, a); }

/** Opt-in local integration isolation; never redirects HOME or Codex authentication. */
export function openClawIsolation(env: NodeJS.ProcessEnv = process.env, userHome = homedir()): OpenClawIsolation | undefined {
  if (env.CLAWX_ISOLATED_OPENCLAW !== '1') return undefined;
  if (env.CLAWX_LOCAL_ONBOARDING !== '1' || env.CLAWX_E2E === '1') throw new Error('Isolated OpenClaw requires real local onboarding');
  const pathValue = (key: string) => {
    const value = env[key]?.trim(); if (!value || !isAbsolute(value)) throw new Error(`Isolation requires absolute ${key}`);
    return canonical(value);
  };
  const stateDir = pathValue('OPENCLAW_STATE_DIR'), configPath = pathValue('OPENCLAW_CONFIG_PATH');
  const workspaceRoot = pathValue('CLAWX_ISOLATED_WORKSPACE_DIR'), userData = pathValue('CLAWX_USER_DATA_DIR');
  if (configPath !== join(stateDir, 'openclaw.json')) throw new Error('Main and Gateway must use the same isolated config');
  const roots = [stateDir, workspaceRoot, userData];
  if (roots.some((a, i) => roots.slice(i + 1).some((b) => overlaps(a, b)))) throw new Error('Isolated state, userData and workspaces must not overlap');
  let supplied: unknown;
  try { supplied = JSON.parse(env.CLAWX_ISOLATION_PROTECTED_DIRS ?? ''); } catch { throw new Error('Explicit protected original directories are required'); }
  if (!Array.isArray(supplied) || !supplied.length || supplied.some((x) => typeof x !== 'string' || !isAbsolute(x))) throw new Error('Explicit absolute protected original directories are required');
  const protectedRoots = [join(userHome, '.openclaw'), join(userHome, '.clawx'), ...supplied as string[]].map(canonical);
  if (roots.some((a) => protectedRoots.some((b) => overlaps(a, b)))) throw new Error('Isolation overlaps an original configuration or workspace');
  const portValue = (key: string) => {
    const value = env[key] ?? ''; if (!/^\d+$/.test(value)) throw new Error(`Explicit ${key} required`);
    const port = Number(value); if (!Number.isInteger(port) || port < 1024 || port > 65535 || [13210, 13211, 18789].includes(port)) throw new Error('Isolation requires distinct non-default ports');
    return port;
  };
  const gatewayPort = portValue('CLAWX_PORT_OPENCLAW_GATEWAY'), hostPort = portValue('CLAWX_PORT_CLAWX_HOST_API');
  if (gatewayPort === hostPort) throw new Error('Gateway and Host API ports must differ');
  return { stateDir, configPath, workspaceRoot, userData, gatewayPort, hostPort };
}

/** Call before startup side effects and before launching the owned Gateway. */
export function assertIsolatedOpenClawConfig(env: NodeJS.ProcessEnv = process.env): void {
  const isolation = openClawIsolation(env); if (!isolation) return;
  const config = JSON.parse(readFileSync(isolation.configPath, 'utf8'));
  const agents = config.agents?.list;
  if (!Array.isArray(agents) || !agents.length) throw new Error('Isolation requires explicitly configured agents');
  const checkWorkspace = (value: unknown) => {
    if (typeof value !== 'string' || !isAbsolute(value) || !nested(isolation.workspaceRoot, canonical(value))) throw new Error('Agent workspace is outside the isolated workspace root');
  };
  if (config.agents?.defaults?.workspace !== undefined) checkWorkspace(config.agents.defaults.workspace);
  for (const agent of agents) {
    checkWorkspace(agent.workspace);
    if (typeof agent.agentDir !== 'string' || !isAbsolute(agent.agentDir) || !nested(join(isolation.stateDir, 'agents'), canonical(agent.agentDir))) throw new Error('Agent auth/session directory is outside isolated state');
  }
  if (config.gateway?.port !== isolation.gatewayPort) throw new Error('Config and process Gateway ports differ');
}
