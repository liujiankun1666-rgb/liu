// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HotelBridge, hotelBridgeTools } from '../../electron/services/hotel/bridge';
import { HotelService } from '../../electron/services/hotel/domain';
import { MemoryHotelStore } from '../../electron/services/hotel/store';
import type { HotelRuntime } from '../../electron/services/hotel/runtime';

vi.mock('../../electron/utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../electron/utils/agent-config', () => ({ listAgentsSnapshot: vi.fn() }));
vi.mock('../../electron/services/hotel/execution-policy', () => ({ inspectHotelExecutionPolicy: vi.fn() }));
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function harness(allowDispatch = false) {
  const directory = await mkdtemp(join(tmpdir(), 'hotel-bridge-test-'));
  directories.push(directory);
  const bridge = new HotelBridge(join(directory, 'credential.json'), 13210);
  const service = new HotelService(new MemoryHotelStore());
  const runtime = { service, dispatch: vi.fn(), reconcile: vi.fn(), returnResult: service.submitResult.bind(service) } as unknown as HotelRuntime;
  const credentials = await bridge.rotate(['xingcheng-aigong'], allowDispatch);
  const grant = (await bridge.authorize(credentials.token))!;
  const call = async (name: string, args: Record<string, unknown>) => await bridge.process({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, runtime, grant) as {
    result: { isError: boolean; content: Array<{ text: string }> };
  };
  return { directory, bridge, service, runtime, credentials, grant, call };
}

describe('property-scoped hotel MCP bridge', () => {
  it('stores only a hash, uses a private file, and invalidates rotated/revoked credentials', async () => {
    const h = await harness();
    const raw = await readFile(h.bridge.path, 'utf8');
    expect(raw).not.toContain(h.credentials.token);
    expect((await stat(h.bridge.path)).mode & 0o777).toBe(0o600);
    expect(await h.bridge.authorize('wrong-key')).toBeNull();
    const next = await h.bridge.rotate(['xingcheng-aigong'], true);
    expect(await h.bridge.authorize(h.credentials.token)).toBeNull();
    expect(await h.bridge.authorize(next.token)).not.toBeNull();
    const reloaded = new HotelBridge(h.bridge.path);
    expect((await reloaded.status()).allowDispatch).toBe(true);
    await h.bridge.revoke();
    expect(await h.bridge.authorize(next.token)).toBeNull();
  });

  it('supports initialize, tool discovery and notifications without exposing approvals', async () => {
    const h = await harness();
    const initialized = await h.bridge.process({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, h.runtime, h.grant) as { result: { protocolVersion: string } };
    expect(initialized.result.protocolVersion).toBe('2025-06-18');
    expect(await h.bridge.process({ jsonrpc: '2.0', method: 'notifications/initialized' }, h.runtime, h.grant)).toBeNull();
    for (const scope of [false, true]) {
      expect(hotelBridgeTools(scope).map((tool) => tool.name).join(' ')).not.toMatch(/approve|accept|bind|config|publish|reopen/);
    }
    expect((await h.call('hotel_approve_task', { actor: 'owner' })).result.isError).toBe(true);
    expect((await h.call('hotel_reopen_review', { actor: 'owner', propertyId: 'xingcheng-aigong', taskId: 'exhausted', reason: 'pretend owner' })).result.isError).toBe(true);
    expect((await h.call('hotel_dispatch_task', { taskId: 'anything' })).result.isError).toBe(true);
    expect(h.runtime.dispatch).not.toHaveBeenCalled();
  });

  it('scopes every read and creation to authorized properties and keeps created tasks as drafts', async () => {
    const h = await harness();
    await h.service.saveProperty({ id: 'other-property', name: '测试二店', city: '测试市', timezone: 'Asia/Shanghai' });
    expect((await h.call('hotel_status', { propertyId: 'other-property' })).result.isError).toBe(true);
    const input = { propertyId: 'xingcheng-aigong', title: '请求分析', objective: '分析测试资料', role: 'supervisor', idempotencyKey: 'bridge-created', acceptanceCriteria: ['说明证据'], actor: 'owner', status: 'succeeded' };
    const created = await h.call('hotel_create_task', input);
    expect(created.result.isError).toBe(false);
    expect(JSON.parse(created.result.content[0].text).status).toBe('draft');
    expect((await h.service.snapshot()).audit[0].actor).toBe('owner'); // Property creation.
    expect((await h.service.snapshot()).audit.at(-1)?.actor).toBe('bridge');
    expect((await h.call('hotel_create_task', { ...input, propertyId: 'other-property' })).result.isError).toBe(true);
    await h.call('hotel_create_task', input);
    expect((await h.service.snapshot()).tasks).toHaveLength(1);
  });

  it('does not allow scope-enabled clients to queue production writes or cross-store tasks', async () => {
    const h = await harness(true);
    const plan = await h.service.createTask({ propertyId: 'xingcheng-aigong', title: '测试价格方案', objective: '请老板审价', role: 'revenue', action: 'price_change', acceptanceCriteria: ['具体范围'], idempotencyKey: 'price-test', plan: { target: 'fixture', before: 'old', after: 'new', reason: 'test', rollback: 'restore' } });
    expect((await h.call('hotel_queue_task', { taskId: plan.id })).result.isError).toBe(true);
    await h.service.saveProperty({ id: 'other', name: '其他测试店', city: '其他市', timezone: 'Asia/Shanghai' });
    const otherTask = await h.service.createTask({ propertyId: 'other', title: '范围外任务', objective: 'test', role: 'pms', acceptanceCriteria: ['test'], idempotencyKey: 'other' });
    expect((await h.call('hotel_dispatch_task', { taskId: otherTask.id })).result.isError).toBe(true);
    expect(h.runtime.dispatch).not.toHaveBeenCalled();
  });

  it('rejects stale attempt reports and leaves all business decisions for the owner', async () => {
    const h = await harness(true);
    const created = await h.service.createTask({ propertyId: 'xingcheng-aigong', title: '任务', objective: 'test', role: 'pms', acceptanceCriteria: ['test'], idempotencyKey: 'result' });
    const result = await h.call('hotel_submit_result', { taskId: created.id, attemptId: 'invented', result: { summary: 'success' } });
    expect(result.result.isError).toBe(true);
    expect((await h.service.snapshot()).tasks[0].status).toBe('draft');
  });

  it('does not let proposal-only credentials change a queued parent workflow', async () => {
    const h = await harness();
    const parent = await h.service.createTask({ propertyId: 'xingcheng-aigong', title: '经营调查', objective: 'test', role: 'supervisor', acceptanceCriteria: ['test'], idempotencyKey: 'parent' });
    await h.service.queueTask(parent.id);
    const created = await h.call('hotel_create_task', { propertyId: 'xingcheng-aigong', title: '非法挂子任务', objective: 'test', role: 'pms', acceptanceCriteria: ['test'], idempotencyKey: 'injected-child', parentTaskId: parent.id });
    expect(created.result.isError).toBe(true);
    expect((await h.service.snapshot()).tasks).toHaveLength(1);
  });

  it('returns a JSON-RPC protocol error for malformed requests', async () => {
    const h = await harness();
    const result = await h.bridge.process({ jsonrpc: '1.0', id: [], method: 'initialize' }, h.runtime, h.grant) as { error: { code: number } };
    expect(result.error.code).toBe(-32600);
  });
});
