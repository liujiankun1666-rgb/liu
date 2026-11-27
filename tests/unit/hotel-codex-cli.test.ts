// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexCliExecutor, codexExecutionArguments, runNativeCommand, CODEX_EXECUTION_TIMEOUT_MS, type CodexExecutorConfig } from '../../electron/services/hotel/codex-cli';
import { CALLBACK_RECEIVED_HTML } from '../../electron/utils/openai-codex-oauth';
import type { HotelTask } from '../../shared/hotel';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hotel-native-test-'))); roots.push(root);
  await mkdir(join(root, 'seed')); await mkdir(join(root, 'runs'));
  const config: CodexExecutorConfig = { version: 1, enabled: true, executable: await realpath('/bin/sh'), seedWorkspace: join(root, 'seed'), runRoot: join(root, 'runs'), propertyIds: ['test'], model: 'gpt-6-astra' };
  const path = join(root, 'config.json'); const save = () => writeFile(path, JSON.stringify(config)); await save();
  return { root, config, save, executor: new CodexCliExecutor(path) };
}
describe('native Codex technical boundary', () => {
  it('builds fixed non-inheriting, non-escalating native execution arguments', async () => {
    const f = await fixture(); const args = codexExecutionArguments(f.config, '/private/workspace', '/private/receipt-schema.json');
    for (const value of ['--ignore-user-config', '--ephemeral', '--strict-config', 'approval_policy="never"', 'features.apps=false', 'features.plugins=false', 'features.hooks=false', 'mcp_servers={}', 'notify=[]', 'web_search="disabled"', 'permissions.hotel-technical.network.enabled=false']) expect(args).toContain(value);
    expect(args).not.toContain('--sandbox'); expect(args.join(' ')).not.toContain('danger-full-access');
    expect(args.join(' ')).not.toContain('--trust');
  });
  it('rejects nested roots and linked source snapshots before launching a process', async () => {
    const f = await fixture(); f.config.runRoot = f.config.seedWorkspace; await f.save();
    expect((await f.executor.inspect('test')).reason).toMatch(/disjoint/);
    f.config.runRoot = join(f.root, 'runs'); await f.save(); await symlink('/bin/sh', join(f.config.seedWorkspace, 'linked'));
    expect((await f.executor.inspect('test')).reason).toMatch(/links/);
  });
  it('reserves the executor synchronously across asynchronous config reads and releases on failure', async () => {
    const f = await fixture(); const task = { role: 'codex', action: 'code', propertyId: 'test', assignedAgentId: 'codex-cli-technical' } as HotelTask;
    const first = f.executor.execute(task, 'test'); const second = f.executor.execute(task, 'test');
    const result = await Promise.allSettled([first, second]);
    expect(result[1].status).toBe('rejected'); if (result[1].status === 'rejected') expect(String(result[1].reason)).toContain('busy');
    await expect(f.executor.execute(task, 'test')).rejects.toThrow('permission probe');
  });
  it('does not accept an OAuth callback as completed authentication', () => {
    expect(CALLBACK_RECEIVED_HTML).toContain('Authorization callback received');
    expect(CALLBACK_RECEIVED_HTML).toContain('token exchange may still fail');
    expect(CALLBACK_RECEIVED_HTML).not.toContain('Authentication successful');
  });
});


it('bounds an uncooperative owned process with TERM then KILL instead of hanging', async () => {
  const f = await fixture(); const started = Date.now();
  const result = await runNativeCommand('/bin/sh', ['-c', "trap '' TERM; /bin/sleep 30"], { cwd: f.root, timeout: 80, terminationGraceMs: 100 });
  expect(result.timedOut).toBe(true); expect(result.code).toBeNull(); expect(result.signal).toBe('SIGKILL');
  expect(Date.now() - started).toBeLessThan(2500);
  expect(CODEX_EXECUTION_TIMEOUT_MS).toBe(600000);
});

it('handles an early child exit while a large prompt is still being written', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hotel-stdin-test-'))); roots.push(root);
  let closed = false;
  const result = runNativeCommand(process.execPath, ['-e', 'process.exit(0)'], {
    cwd: root,
    input: 'x'.repeat(1024 * 1024),
    timeout: 10000,
    onChild: (child) => child.once('close', () => { closed = true; }),
  });
  await expect(result).rejects.toThrow('Native child stdin failed before input delivery completed');
  expect(closed).toBe(true);
}, 15000);
