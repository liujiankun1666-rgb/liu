import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, lstat, mkdir, readFile, realpath, readdir, writeFile, rename } from 'node:fs/promises';
import { isAbsolute, join, resolve, relative, sep } from 'node:path';
import type { HotelTask, HotelAgentOption } from '../../../shared/hotel';
import type { HotelExecutionPolicy } from './execution-policy';

export const CODEX_TECHNICAL_ID = 'codex-cli-technical';
const CLI_VERSION = 'codex-cli 0.171.0-alpha.13.2';
const PROFILE = 'hotel-technical';
const FILESYSTEM = 'permissions.hotel-technical.filesystem={":minimal"="read",":workspace_roots"={"."="write",".git"="read",".agents"="read",".codex"="read",".aws"="read"}}';
const LIMIT = 2 * 1024 * 1024;
export const CODEX_EXECUTION_TIMEOUT_MS = 600000;
export interface CodexExecutorConfig {
  version: 1; enabled: boolean; executable: string; seedWorkspace: string; runRoot: string;
  propertyIds: string[]; model: string;
}
export interface CodexExecutionReceipt { text: string; runId: string; threadId: string; workspace: string }
export interface CodexTechnicalExecutor {
  describe(): Promise<HotelAgentOption | null>;
  inspect(propertyId: string): Promise<HotelExecutionPolicy>;
  execute(task: HotelTask, message: string): Promise<CodexExecutionReceipt>;
  reconcile(task: HotelTask): Promise<CodexExecutionReceipt>;
  cancel(task: HotelTask): Promise<boolean>;
}

function configArgs(): string[] {
  return ['-c', `default_permissions="${PROFILE}"`, '-c', FILESYSTEM,
    '-c', `permissions.${PROFILE}.network.enabled=false`, '-c', 'approval_policy="never"',
    '-c', 'features.apps=false', '-c', 'features.plugins=false', '-c', 'features.remote_plugin=false',
    '-c', 'features.hooks=false', '-c', 'features.multi_agent=false', '-c', 'features.multi_agent_v2=false',
    '-c', 'features.shell_snapshot=false', '-c', 'features.skill_mcp_dependency_install=false',
    '-c', 'features.skip_host_skill_discovery=true', '-c', 'web_search="disabled"',
    '-c', 'notify=[]', '-c', 'mcp_servers={}', '-c', 'project_doc_max_bytes=0',
    '-c', 'shell_environment_policy.inherit="none"', '-c', 'model_reasoning_effort="ultra"'];
}
export function codexExecutionArguments(config: CodexExecutorConfig, workspace: string, schema: string): string[] {
  return ['exec', '--ignore-user-config', '--ephemeral', '--strict-config', '--json', '--color', 'never',
    '--skip-git-repo-check', '-C', workspace, '-m', config.model, ...configArgs(), '--output-schema', schema, '-'];
}
function cleanEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  // Native Codex authenticates itself; never read, copy or pass another product's tokens.
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG']) if (process.env[key]) result[key] = process.env[key];
  return result;
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}
async function checkSeed(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['.codex', '.agents', '.git', '.aws'].includes(entry.name)) throw new Error('Seed workspace contains links or runtime configuration; review a clean technical source snapshot first');
    if (!entry.isDirectory() && !entry.isFile()) throw new Error('Seed workspace contains a non-regular file');
    if (entry.isDirectory()) await checkSeed(join(directory, entry.name));
  }
}
export async function runNativeCommand(executable: string, args: string[], options: { cwd: string; input?: string; timeout?: number; terminationGraceMs?: number; onChild?: (child: ChildProcess) => void }) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; pid?: number; signal: string | null; timedOut: boolean }>((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: cleanEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    options.onChild?.(child);
    let stdout = '', stderr = '', overflow = false, timedOut = false, closed = false;
    let stdinError: Error | undefined;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (closed) return;
      signalOwnedProcess(child, 'SIGTERM');
      forceTimer ??= setTimeout(() => signalOwnedProcess(child, 'SIGKILL'), options.terminationGraceMs ?? 2000);
      deadlineTimer ??= setTimeout(() => { clearTimeout(timer); reject(new Error('Native child exit remains unconfirmed after bounded termination; reconcile before retry')); }, (options.terminationGraceMs ?? 2000) + 3000);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeout ?? 15000);
    const clear = () => { clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); if (deadlineTimer) clearTimeout(deadlineTimer); };
    child.stdout!.on('data', (value) => { stdout += value; if (stdout.length > LIMIT) { overflow = true; stop(); } });
    child.stderr!.on('data', (value) => { stderr += value; if (stderr.length > LIMIT) { overflow = true; stop(); } });
    // A child can reject configuration/authentication before consuming its prompt.
    // Handle the pipe's own error event, then retain ownership until close (or the
    // existing bounded termination deadline), rather than crashing the host.
    child.stdin!.on('error', (error) => { stdinError ??= error; stop(); });
    child.on('error', (error) => { clear(); reject(error); });
    child.on('close', (code, signal) => {
      closed = true; clear();
      if (overflow) reject(new Error('Codex output exceeded the bounded receipt limit'));
      else if (stdinError) reject(new Error(`Native child stdin failed before input delivery completed: ${stdinError.message}`));
      else resolveRun({ code, stdout, stderr, pid: child.pid, signal, timedOut });
    });
    child.stdin!.end(options.input ?? '');
  });
}

function signalOwnedProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited; callers still await close. */ }
}

/** Native Codex technical executor. It never starts or imports OpenClaw. */
export class CodexCliExecutor implements CodexTechnicalExecutor {
  private active = new Map<string, ChildProcess>();
  private busy = false;
  private verified = new Map<string, string>();
  constructor(readonly configPath: string) {}
  private async config(): Promise<CodexExecutorConfig | null> {
    let text: string;
    try { text = await readFile(this.configPath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    const c = JSON.parse(text) as CodexExecutorConfig;
    if (!c.enabled) return null;
    if (c.version !== 1 || !Array.isArray(c.propertyIds) || !c.propertyIds.length || c.propertyIds.some((id) => typeof id !== 'string')
      || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(c.model)) throw new Error('Invalid native Codex configuration');
    for (const key of ['executable', 'seedWorkspace', 'runRoot'] as const) {
      if (!isAbsolute(c[key]) || await realpath(c[key]) !== resolve(c[key])) throw new Error('Native Codex paths must be canonical absolute paths');
    }
    if (!(await lstat(c.executable)).isFile() || !(await lstat(c.seedWorkspace)).isDirectory() || !(await lstat(c.runRoot)).isDirectory()) throw new Error('Native Codex paths unavailable');
    const inside = (a: string, b: string) => { const rel = relative(a, b); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
    if (inside(c.seedWorkspace, c.runRoot) || inside(c.runRoot, c.seedWorkspace)) throw new Error('Native seed and run directories must be disjoint');
    await checkSeed(c.seedWorkspace);
    return c;
  }
  async describe(): Promise<HotelAgentOption | null> {
    try { const c = await this.config(); return c ? { id: CODEX_TECHNICAL_ID, name: 'Codex CLI｜隔离技术执行端', modelDisplay: c.model, executionBackend: 'codex-cli' } : null; }
    catch { return null; }
  }
  async inspect(propertyId: string): Promise<HotelExecutionPolicy> {
    try {
      const c = await this.config();
      if (!c || !c.propertyIds.includes(propertyId)) throw new Error('Native Codex is not enabled for this property');
      if (this.busy || this.active.size) throw new Error('The native technical executor already has an active run');
      const version = await runNativeCommand(c.executable, ['--version'], { cwd: c.seedWorkspace });
      if (version.code !== 0 || version.stdout.trim() !== CLI_VERSION) throw new Error('Codex CLI version differs from the verified native permission implementation');
      const parent = join(c.runRoot, `probe-${randomUUID()}`), workspace = join(parent, 'workspace');
      await mkdir(workspace, { recursive: true, mode: 0o700 });
      await writeFile(join(workspace, 'inside.txt'), 'canary', { mode: 0o600 });
      await writeFile(join(parent, 'outside.txt'), 'outside-canary', { mode: 0o600 });
      const { symlink } = await import('node:fs/promises');
      await symlink('../outside.txt', join(workspace, 'escape.txt'));
      let hits = 0;
      const server = createServer((_req, res) => { hits++; res.end('local-canary'); });
      await new Promise<void>((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
      try {
        const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local probe listener');
        const script = `#!/bin/sh\n/bin/cat inside.txt >/dev/null 2>&1; echo inside_read=$?\nprintf ok >inside-write.txt; echo inside_write=$?\n/bin/cat ../outside.txt >/dev/null 2>&1; echo outside_read=$?\n(printf bad >../outside-write.txt) 2>/dev/null; echo outside_write=$?\n/bin/cat escape.txt >/dev/null 2>&1; echo symlink_read=$?\n(printf bad >escape.txt) 2>/dev/null; echo symlink_write=$?\n/usr/bin/curl --max-time 2 --silent http://127.0.0.1:${address.port} >/dev/null 2>&1; echo network=$?\n`;
        await writeFile(join(workspace, 'probe.sh'), script, { mode: 0o600 });
        const probe = await runNativeCommand(c.executable, ['sandbox', '-P', PROFILE, '-c', FILESYSTEM, '-c', `permissions.${PROFILE}.network.enabled=false`, '-C', workspace, '/bin/sh', 'probe.sh'], { cwd: workspace });
        const checks = Object.fromEntries(probe.stdout.trim().split('\n').map((line) => line.split('=')));
        const passed = probe.code === 0 && checks.inside_read === '0' && checks.inside_write === '0'
          && ['outside_read', 'outside_write', 'symlink_read', 'symlink_write', 'network'].every((key) => /^\d+$/.test(checks[key] ?? '') && checks[key] !== '0')
          && checks.network === '7' && hits === 0 && await readFile(join(parent, 'outside.txt'), 'utf8') === 'outside-canary';
        await atomicJson(join(parent, 'permission-evidence.json'), { version: CLI_VERSION, checks, loopbackHits: hits, passed, measuredAt: new Date().toISOString() });
        if (!passed) throw new Error('Native workspace/network permission probe failed; no task dispatched');
        this.verified.set(propertyId, createHash('sha256').update(JSON.stringify(c)).digest('hex'));
        return { allowed: true, reason: 'Native Codex probe passed: workspace only, symlink/outside access denied, command network disabled; approvals never, inherited apps/plugins/hooks disabled. Model execution still requires a real receipt.', verifiedTools: ['native-codex-workspace-tools'] };
      } finally { await new Promise<void>((ok) => server.close(() => ok())); }
    } catch (error) { this.verified.delete(propertyId); return { allowed: false, reason: error instanceof Error ? error.message : 'Native Codex preflight failed', verifiedTools: [] }; }
  }
  private location(c: CodexExecutorConfig, task: HotelTask) {
    const attempt = task.attempts.at(-1); if (!attempt || !/^[a-zA-Z0-9-]+$/.test(task.id) || !/^[a-zA-Z0-9-]+$/.test(attempt.id)) throw new Error('Invalid native execution identity');
    return { attempt, directory: join(c.runRoot, task.id, attempt.id) };
  }
  async execute(task: HotelTask, message: string): Promise<CodexExecutionReceipt> {
    if (this.busy) throw new Error('Native executor is busy');
    this.busy = true;
    try { return await this.executeOwned(task, message); } finally { this.busy = false; }
  }
  private async executeOwned(task: HotelTask, message: string): Promise<CodexExecutionReceipt> {
    const c = await this.config();
    if (!c || !c.propertyIds.includes(task.propertyId) || task.role !== 'codex' || task.action !== 'code' || task.assignedAgentId !== CODEX_TECHNICAL_ID) throw new Error('Native executor accepts only scoped Codex code tasks');
    if (this.active.size) throw new Error('Native executor is busy');
    if (this.verified.get(task.propertyId) !== createHash('sha256').update(JSON.stringify(c)).digest('hex')) throw new Error('Native configuration changed or lacks a successful current permission probe');
    const { attempt, directory } = this.location(c, task), workspace = join(directory, 'workspace');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // Exclusive reservation prevents duplicate dispatch even after a client disconnects.
    await writeFile(join(directory, 'reserved.json'), JSON.stringify({ taskId: task.id, attemptId: attempt.id, dispatchKey: attempt.dispatchKey }), { flag: 'wx', mode: 0o600 });
    await checkSeed(c.seedWorkspace);
    await cp(c.seedWorkspace, workspace, { recursive: true, errorOnExist: true, force: false, dereference: false });
    await checkSeed(workspace);
    await writeFile(join(directory, 'outside-canary.txt'), 'Task-owned non-secret boundary canary', { flag: 'wx', mode: 0o600 });
    const schema = join(directory, 'result-schema.json');
    await writeFile(schema, JSON.stringify(resultSchema(task.id, attempt.id)), { flag: 'wx', mode: 0o600 });
    const args = codexExecutionArguments(c, workspace, schema);
    await atomicJson(join(directory, 'invocation.json'), { taskId: task.id, attemptId: attempt.id, executable: c.executable, version: CLI_VERSION, model: c.model, args, startedAt: new Date().toISOString(), authSource: 'native Codex login; no credential copying', configIgnored: true });
    let response;
    try { response = await runNativeCommand(c.executable, args, { cwd: workspace, input: `${message}\n\nOnly modify this isolated technical workspace. Prefer known available /bin/sh, /bin/cat and system utilities; Python and Node are not validated in this minimal sandbox, do not install runtimes. Do not spawn agents or request permission changes. Return source/artifact URIs relative to this workspace.\n`, timeout: CODEX_EXECUTION_TIMEOUT_MS, onChild: (child) => { this.active.set(attempt.id, child); void atomicJson(join(directory, 'process.json'), { pid: child.pid, processGroup: process.platform === 'win32' ? null : child.pid, taskId: task.id, attemptId: attempt.id, startedAt: new Date().toISOString() }); } }); }
    finally { this.active.delete(attempt.id); }
    await atomicJson(join(directory, 'exit.json'), { pid: response.pid, code: response.code, signal: response.signal, timedOut: response.timedOut, endedAt: new Date().toISOString(), timeoutMs: CODEX_EXECUTION_TIMEOUT_MS });
    await writeFile(join(directory, 'stdout.jsonl'), response.stdout, { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'stderr.log'), response.stderr, { flag: 'wx', mode: 0o600 });
    const events = response.stdout.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const threadId = events.find((event) => event.type === 'thread.started')?.thread_id;
    const final = events.filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message').at(-1)?.item?.text;
    const toolEvents = events.filter((event) => event.type === 'item.completed' && ['command_execution', 'file_change'].includes(event.item?.type));
    if (response.code !== 0 || typeof threadId !== 'string' || typeof final !== 'string' || !events.some((event) => event.type === 'turn.completed') || !toolEvents.length) {
      await atomicJson(join(directory, 'failure.json'), { taskId: task.id, attemptId: attempt.id, code: response.code, hasThread: !!threadId, hasFinal: !!final, toolEvents: toolEvents.length });
      throw new Error(response.timedOut ? 'Native Codex exceeded its bounded 600-second limit; preserve the attempt and inspect exit evidence before retry' : 'Native Codex did not return a successful tool-backed structured turn; inspect the private execution logs before retrying');
    }
    const receipt = { text: final, runId: `codex-cli:${threadId}:${attempt.id}`, threadId, workspace };
    await atomicJson(join(directory, 'receipt.json'), { ...receipt, taskId: task.id, attemptId: attempt.id, configHash: createHash('sha256').update(JSON.stringify(c)).digest('hex'), completedAt: new Date().toISOString() });
    return receipt;
  }
  async reconcile(task: HotelTask): Promise<CodexExecutionReceipt> {
    const c = await this.config(); if (!c || !c.propertyIds.includes(task.propertyId) || task.role !== 'codex' || task.action !== 'code' || task.assignedAgentId !== CODEX_TECHNICAL_ID || task.attempts.at(-1)?.executor !== 'codex-cli') throw new Error('Native executor configuration or task scope unavailable');
    const { attempt, directory } = this.location(c, task);
    const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
    if (receipt.configHash !== createHash('sha256').update(JSON.stringify(c)).digest('hex') || receipt.workspace !== join(directory, 'workspace') || receipt.taskId !== task.id || receipt.attemptId !== attempt.id || typeof receipt.threadId !== 'string' || receipt.runId !== `codex-cli:${receipt.threadId}:${attempt.id}`) throw new Error('Native receipt identity mismatch');
    return receipt;
  }
  async cancel(task: HotelTask): Promise<boolean> {
    const attempt = task.attempts.at(-1); const child = attempt && this.active.get(attempt.id);
    if (!child) return false;
    return new Promise<boolean>((ok) => {
      const force = setTimeout(() => signalOwnedProcess(child, 'SIGKILL'), 2000);
      const deadline = setTimeout(() => { clearTimeout(force); ok(false); }, 5000);
      child.once('close', () => { clearTimeout(force); clearTimeout(deadline);
        try { if (child.pid && process.platform !== 'win32') { process.kill(-child.pid, 0); ok(false); } else ok(true); } catch { ok(true); }
      });
      signalOwnedProcess(child, 'SIGTERM');
    });
  }
}

function resultSchema(taskId: string, attemptId: string) {
  const text = { type: 'string' }; const array = { type: 'array', items: text };
  const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  return object({ taskId: { type: 'string', enum: [taskId] }, attemptId: { type: 'string', enum: [attemptId] }, outcome: { type: 'string', enum: ['completed', 'blocked', 'failed'] }, error: text,
    result: object({ summary: text, completedItems: array, missingItems: array, sources: { type: 'array', items: object({ label: text, uri: text, observedAt: text }) }, artifacts: { type: 'array', items: object({ label: text, uri: text }) }, dataPeriod: text, verificationNotes: text, suggestedNextActions: array }),
  });
}
