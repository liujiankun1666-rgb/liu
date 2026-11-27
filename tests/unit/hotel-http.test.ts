// @vitest-environment node
/**
 * Display-independent HTTP integration: real loopback sockets, route handlers,
 * domain state and bridge credentials. This is not an Electron/UI E2E test.
 * The small server mounts hotel routes after the desktop Host API auth boundary;
 * it tests the bridge's distinct authentication, not the outer server auth gate.
 */
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostApiContext } from '../../electron/api/context';
import type { HotelRuntime } from '../../electron/services/hotel/runtime';
import type { HotelTask } from '../../shared/hotel';
import { HotelService } from '../../electron/services/hotel/domain';
import { MemoryHotelStore } from '../../electron/services/hotel/store';
import { handleHotelRoutes } from '../../electron/api/routes/hotel';
import { getHotelBridge, handleHotelBridgeRequest } from '../../electron/services/hotel/bridge';

const fixtures = vi.hoisted(() => ({ userData: '', runtime: undefined as unknown }));
vi.mock('electron', () => ({ app: { getPath: () => fixtures.userData } }));
vi.mock('../../electron/services/hotel/runtime', () => ({
  getHotelRuntime: async () => fixtures.runtime,
}));

type JsonObject = Record<string, unknown>;
interface HttpResult {
  status: number;
  headers: Headers;
  body: JsonObject;
}
interface McpResult {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
  tools?: Array<{ name: string }>;
  protocolVersion?: string;
  serverInfo?: { name: string };
}

let server: Server;
let baseUrl: string;
let service: HotelService;
let dispatch: ReturnType<typeof vi.fn>;
const context = { eventBus: { emit: vi.fn() } } as unknown as HostApiContext;

async function request(path: string, options: {
  method?: string; body?: unknown; rawBody?: string; token?: string; headers?: Record<string, string>;
} = {}): Promise<HttpResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...options.headers };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'POST', headers,
    body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    signal: AbortSignal.timeout(4000),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) as JsonObject : {} };
}

async function bridgeToken(allowDispatch = false): Promise<string> {
  const response = await request('/api/hotel/bridge', {
    body: { propertyIds: ['xingcheng-aigong'], allowDispatch },
  });
  expect(response.status).toBe(200);
  expect(typeof response.body.token).toBe('string');
  return response.body.token as string;
}

async function rpc(token: string, method: string, params?: JsonObject) {
  return request('/hotel-bridge/mcp', { token, body: { jsonrpc: '2.0', id: 1, method, params } });
}

function taskInput(key: string) {
  return {
    propertyId: 'xingcheng-aigong', title: 'HTTP 集成测试任务', objective: '仅使用脱敏测试输入',
    role: 'pms', action: 'read', acceptanceCriteria: ['返回可核对的测试证据'], idempotencyKey: key,
  };
}

beforeAll(async () => {
  fixtures.userData = await mkdtemp(join(tmpdir(), 'clawx-hotel-http-'));
  server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', baseUrl || 'http://127.0.0.1');
      if (await handleHotelBridgeRequest(req, res, url, context)) return;
      if (await handleHotelRoutes(req, res, url, context)) return;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No test route' }));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unexpected route failure' }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP loopback address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  service = new HotelService(new MemoryHotelStore());
  dispatch = vi.fn();
  fixtures.runtime = {
    service, dispatch,
    snapshot: async () => ({ success: true, snapshot: await service.snapshot(), agents: [], gateway: { state: 'stopped' }, capabilities: [], templates: [] }),
  } as unknown as HotelRuntime;
  await (await getHotelBridge()).revoke();
});

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (fixtures.userData) await rm(fixtures.userData, { recursive: true, force: true });
});

describe('display-independent hotel HTTP integration', () => {
  it('creates and queues a task, and binds a concrete price approval to its current version', async () => {
    const created = await request('/api/hotel/tasks', { body: taskInput('http-read') });
    expect(created.status).toBe(201);
    const task = created.body.task as HotelTask;
    expect(task.status).toBe('draft');
    const queued = await request(`/api/hotel/tasks/${task.id}/queue`, { body: {} });
    expect(queued.status).toBe(200);
    expect((queued.body.task as HotelTask).status).toBe('queued');

    const plan = { target: '脱敏测试房型与日期', before: 'fixture-old', after: 'fixture-new', reason: '测试版本审批', rollback: '恢复测试前状态' };
    const price = await request('/api/hotel/tasks', {
      body: { ...taskInput('http-price'), role: 'revenue', action: 'price_change', plan },
    });
    expect(price.status).toBe(201);
    const priceTask = price.body.task as HotelTask;
    const approvalQueue = await request(`/api/hotel/tasks/${priceTask.id}/queue`, { body: {} });
    expect((approvalQueue.body.task as HotelTask).status).toBe('awaiting_approval');
    const approved = await request(`/api/hotel/tasks/${priceTask.id}/approve`, {
      body: { decision: 'approve', planVersion: priceTask.planVersion, note: '核对测试计划后批准' },
    });
    expect(approved.status).toBe(200);
    expect((approved.body.task as HotelTask).approval).toMatchObject({ decision: 'approve', planVersion: 1, actor: 'owner' });
    expect((approved.body.task as HotelTask).status).toBe('blocked');
    expect((approved.body.task as HotelTask).attempts).toHaveLength(0);

    const revised = await request(`/api/hotel/tasks/${priceTask.id}`, {
      method: 'PUT', body: { plan: { ...plan, after: 'fixture-revised' } },
    });
    expect(revised.status).toBe(200);
    const revision = revised.body.task as HotelTask;
    expect(revision.planVersion).toBe(2);
    expect(revision.approval).toBeUndefined();
    await request(`/api/hotel/tasks/${priceTask.id}/queue`, { body: {} });
    const stale = await request(`/api/hotel/tasks/${priceTask.id}/approve`, {
      body: { decision: 'approve', planVersion: 1, note: '旧版本不能批准新内容' },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.success).toBe(false);
    expect(stale.body.error).toMatch(/changed|current version/i);
    const current = (await service.snapshot()).tasks.find((entry) => entry.id === priceTask.id)!;
    expect(current.status).toBe('awaiting_approval');
    expect(current.approval).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'a different token', status: 401, token: 'not-the-issued-token', headers: {}, method: 'POST' },
    { name: 'a browser Origin', status: 403, headers: { Origin: 'https://example.invalid' }, method: 'POST' },
    { name: 'non-JSON Content-Type', status: 415, headers: { 'Content-Type': 'text/plain' }, method: 'POST' },
    { name: 'GET streaming requests', status: 405, headers: {}, method: 'GET' },
  ])('rejects $name at the actual bridge HTTP boundary', async (scenario) => {
    const token = await bridgeToken();
    const response = await request('/hotel-bridge/mcp', {
      token: scenario.token ?? token, headers: scenario.headers, method: scenario.method,
      ...(scenario.method === 'GET' ? {} : { body: { jsonrpc: '2.0', id: 1, method: 'ping' } }),
    });
    expect(response.status).toBe(scenario.status);
    expect(typeof response.body.error).toBe('string');
    if (scenario.status === 405) expect(response.headers.get('allow')).toBe('POST');
  });

  it('initializes and discovers only the tools granted to the current scoped token', async () => {
    const token = await bridgeToken();
    const initialized = await rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test', version: '1' } });
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get('cache-control')).toBe('no-store');
    expect(initialized.body).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'clawx-hotel-command-center' } } });
    const discovered = await rpc(token, 'tools/list');
    expect(discovered.status).toBe(200);
    const tools = (discovered.body.result as McpResult).tools!.map((tool) => tool.name);
    expect(tools).toEqual(['hotel_status', 'hotel_report', 'hotel_create_task']);
    const dispatchDenied = await rpc(token, 'tools/call', { name: 'hotel_dispatch_task', arguments: { taskId: 'unknown' } });
    expect((dispatchDenied.body.result as McpResult).isError).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();

    const replacement = await bridgeToken(true);
    expect((await rpc(token, 'ping')).status).toBe(401);
    const enabled = await rpc(replacement, 'tools/list');
    const enabledNames = (enabled.body.result as McpResult).tools!.map((tool) => tool.name);
    expect(enabledNames).toContain('hotel_dispatch_task');
    expect(enabledNames.join(' ')).not.toMatch(/approve|accept|bind|publish/);
  });

  it('returns an MCP permission error for another property without disclosing that property', async () => {
    await request('/api/hotel/properties', {
      body: { id: 'other-hotel', name: '范围外测试店名称', city: '测试市', timezone: 'Asia/Shanghai' },
    });
    const token = await bridgeToken();
    const allowed = await rpc(token, 'tools/call', { name: 'hotel_status', arguments: { propertyId: 'xingcheng-aigong' } });
    expect((allowed.body.result as McpResult).isError).toBe(false);
    const denied = await rpc(token, 'tools/call', { name: 'hotel_status', arguments: { propertyId: 'other-hotel' } });
    // Domain 403 is serialized as an MCP tool error under HTTP 200, as opposed
    // to authentication/Origin failures at the HTTP transport boundary.
    expect(denied.status).toBe(200);
    const error = denied.body.result as McpResult;
    expect(error.isError).toBe(true);
    expect(error.content?.[0].text).toContain('outside this credential scope');
    expect(JSON.stringify(denied.body)).not.toContain('范围外测试店名称');
  });

  it('routes explicit reopening with Host-derived authority and never body actor', async () => {
    const reopen = vi.spyOn(service, 'reopenSupervisorReview').mockResolvedValue({ id: 'replacement' } as HotelTask);
    const response = await request('/api/hotel/tasks/exhausted/reopen-review', { body: { propertyId: 'xingcheng-aigong', reason: 'Fixed review contract', actor: 'bridge' } });
    expect(response.status).toBe(200);
    expect(reopen).toHaveBeenCalledWith('exhausted', { actor: 'owner', propertyId: 'xingcheng-aigong', reason: 'Fixed review contract' });
    const token = await bridgeToken(true);
    const denied = await rpc(token, 'tools/call', { name: 'hotel_reopen_review', arguments: { taskId: 'exhausted', propertyId: 'xingcheng-aigong', reason: 'Spoof owner', actor: 'owner' } });
    expect((denied.body.result as McpResult).isError).toBe(true);
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it.each(['/api/hotel/tasks', '/hotel-bridge/mcp'])('returns JSON 400 for malformed input on %s', async (path) => {
    const token = path.includes('bridge') ? await bridgeToken() : undefined;
    const response = await request(path, { token, rawBody: '{broken-json' });
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.body.error).toContain('JSON');
  });

  it.each(['/api/hotel/tasks', '/hotel-bridge/mcp'])('returns JSON 413 for an oversized body on %s', async (path) => {
    const token = path.includes('bridge') ? await bridgeToken() : undefined;
    const response = await request(path, { token, body: { padding: 'x'.repeat(1024 * 1024 + 1) } });
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.body.error).toContain('1 MB');
  });
});
