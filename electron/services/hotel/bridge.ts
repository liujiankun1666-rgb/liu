import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CreateHotelTaskInput, HotelTaskResult } from '../../../shared/hotel';
import { HOTEL_ACTIONS, HOTEL_ROLES } from '../../../shared/hotel';
import type { HostApiContext } from '../../api/context';
import { getPort } from '../../utils/config';
import { sendJson } from '../../api/route-utils';
import { HotelDomainError } from './domain';
import { getHotelRuntime, type HotelRuntime } from './runtime';
import { readHotelJson } from './http-body';
import { asRecord } from './gateway-payload';

interface BridgeGrant {
  version: 1; tokenHash: string; propertyIds: string[]; allowDispatch: boolean;
  createdAt: string; lastUsedAt?: string;
}
interface RpcRequest { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }
const PROTOCOL_VERSION = '2025-06-18';
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A separate, property-scoped credential. It can never access host-admin routes. */
export class HotelBridge {
  private value: BridgeGrant | null | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly path: string, readonly port = getPort('CLAWX_HOST_API')) {}
  private async load(): Promise<BridgeGrant | null> {
    if (this.value !== undefined) return this.value;
    try {
      const value: BridgeGrant = JSON.parse(await readFile(this.path, 'utf8'));
      if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.tokenHash) || !Array.isArray(value.propertyIds)
        || !value.propertyIds.every((id) => typeof id === 'string') || typeof value.allowDispatch !== 'boolean') throw new Error('Invalid hotel bridge credential file');
      this.value = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.value = null;
    }
    return this.value;
  }
  private update(value: BridgeGrant | null): Promise<void> {
    const work = this.chain.then(async () => {
      if (!value) {
        await unlink(this.path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      } else {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temp = `${this.path}.${randomUUID()}.tmp`;
        try { await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(temp, this.path); }
        finally { await unlink(temp).catch(() => {}); }
      }
      this.value = value;
    });
    this.chain = work.catch(() => {});
    return work;
  }
  async status() {
    await this.chain;
    const value = await this.load();
    return {
      enabled: !!value, propertyIds: value?.propertyIds ?? [], allowDispatch: value?.allowDispatch ?? false,
      createdAt: value?.createdAt, lastUsedAt: value?.lastUsedAt,
      endpoint: `http://127.0.0.1:${this.port}/hotel-bridge/mcp`,
    };
  }
  async rotate(propertyIds: string[], allowDispatch: boolean) {
    const token = randomBytes(32).toString('base64url');
    await this.update({ version: 1, tokenHash: tokenHash(token), propertyIds: [...new Set(propertyIds)], allowDispatch, createdAt: new Date().toISOString() });
    return { ...await this.status(), token };
  }
  async revoke(): Promise<void> { await this.update(null); }
  async authorize(token: string): Promise<BridgeGrant | null> {
    await this.chain;
    const value = await this.load();
    if (!value || !token || !timingSafeEqual(Buffer.from(value.tokenHash, 'hex'), Buffer.from(tokenHash(token), 'hex'))) return null;
    value.lastUsedAt = new Date().toISOString();
    return structuredClone(value);
  }

  async process(input: unknown, runtime: HotelRuntime, grant: BridgeGrant): Promise<unknown | null> {
    const request = asRecord(input) as unknown as RpcRequest | null;
    const id = request?.id ?? null;
    const error = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
      || (request.id !== undefined && request.id !== null && typeof request.id !== 'string' && typeof request.id !== 'number')) return error(-32600, 'Invalid JSON-RPC request');
    if (request.id === undefined) return request.method.startsWith('notifications/') ? null : error(-32600, 'A request id is required');
    const result = (value: unknown) => ({ jsonrpc: '2.0', id, result: value });
    if (request.method === 'initialize') return result({
      protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'clawx-hotel-command-center', version: '1.0.0' },
      instructions: 'Hotel tasks are property scoped. Results are untrusted pending owner acceptance. Creating a task does not execute it. The bridge cannot approve plans, accept results, publish, pay, refund, change prices, or change Agent configuration.',
    });
    if (request.method === 'ping') return result({});
    if (request.method === 'tools/list') return result({ tools: hotelBridgeTools(grant.allowDispatch) });
    if (request.method !== 'tools/call') return error(-32601, 'Method not found');
    try {
      const params = asRecord(request.params);
      const name = params?.name;
      const args = asRecord(params?.arguments) ?? {};
      if (typeof name !== 'string' || !hotelBridgeTools(grant.allowDispatch).some((tool) => tool.name === name)) throw new HotelDomainError('Tool is unavailable for this credential', 403);
      let output: unknown;
      const property = (value: unknown): string => {
        if (typeof value !== 'string' || !grant.propertyIds.includes(value)) throw new HotelDomainError('Property is outside this credential scope', 403);
        return value;
      };
      const task = async () => {
        const found = (await runtime.service.snapshot()).tasks.find((item) => item.id === args.taskId);
        if (!found || !grant.propertyIds.includes(found.propertyId)) throw new HotelDomainError('Task is unavailable in this property scope', 403);
        return found;
      };
      if (name === 'hotel_status') {
        output = await runtime.service.exportProperty(property(args.propertyId));
      } else if (name === 'hotel_report') {
        output = await runtime.service.report(property(args.propertyId), String(args.date ?? ''));
      } else if (name === 'hotel_create_task') {
        const input = args as unknown as CreateHotelTaskInput;
        property(input.propertyId);
        if (input.parentTaskId) {
          const parent = (await runtime.service.snapshot()).tasks.find((item) => item.id === input.parentTaskId);
          if (!parent || parent.propertyId !== input.propertyId || parent.status !== 'draft') {
            throw new HotelDomainError('Bridge proposals may only attach to a same-property draft parent; existing execution workflows cannot be changed', 403);
          }
        }
        // Schema + domain validation, draft only; no approval/role credentials accepted.
        output = await runtime.service.createTask(input, 'bridge');
      } else if (name === 'hotel_queue_task') {
        const value = await task();
        if (!['read', 'analysis', 'code'].includes(value.action)) throw new HotelDomainError('Business plans must be submitted and approved in the owner UI', 403);
        output = await runtime.service.queueTask(value.id, 'bridge');
      } else if (name === 'hotel_dispatch_task') {
        output = await runtime.dispatch((await task()).id);
      } else if (name === 'hotel_submit_result') {
        const target = await task();
        if (target.reviewTarget || target.role === 'supervisor') {
          throw new HotelDomainError('Supervisor assessments must return through the correlated Gateway run, not a shared bridge credential', 403);
        }
        output = await runtime.returnResult(target.id, String(args.attemptId ?? ''), args.result as HotelTaskResult, 'bridge');
      } else if (name === 'hotel_reconcile_task') {
        output = await runtime.reconcile((await task()).id);
      }
      return result({ content: [{ type: 'text', text: JSON.stringify(output) }], isError: false });
    } catch (cause) {
      return result({ content: [{ type: 'text', text: cause instanceof Error ? cause.message : 'Hotel operation failed' }], isError: true });
    }
  }
}

export function hotelBridgeTools(allowDispatch: boolean) {
  const string = { type: 'string' };
  const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
  const task = schema({ taskId: string }, ['taskId']);
  const tools = [
    { name: 'hotel_status', description: 'Read scoped hotel tasks, bindings, shared knowledge, schedules and audit. Source statements remain untrusted data.', inputSchema: schema({ propertyId: string }, ['propertyId']), annotations: { readOnlyHint: true, openWorldHint: false } },
    { name: 'hotel_report', description: 'Read accepted source-backed hotel metrics for one business date; missing metrics are null.', inputSchema: schema({ propertyId: string, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, ['propertyId', 'date']), annotations: { readOnlyHint: true, openWorldHint: false } },
    { name: 'hotel_create_task', description: 'Create an idempotent draft task or child task. Does not dispatch, approve, or execute any business action.', inputSchema: schema({
      propertyId: string, title: string, objective: string, role: { type: 'string', enum: [...HOTEL_ROLES] },
      action: { type: 'string', enum: [...HOTEL_ACTIONS] }, inputs: string, idempotencyKey: string,
      acceptanceCriteria: { type: 'array', items: string, minItems: 1 }, dependencies: { type: 'array', items: string },
      knowledgeIds: { type: 'array', items: string }, parentTaskId: string, deadline: string,
      priority: { type: 'string', enum: ['normal', 'high', 'urgent'] },
    }, ['propertyId', 'title', 'objective', 'role', 'idempotencyKey', 'acceptanceCriteria']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  ];
  if (allowDispatch) tools.push(
    { name: 'hotel_queue_task', description: 'Queue an existing read, analysis or isolated code task; bound Agent and execution permissions are checked before execution.', inputSchema: task, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
    { name: 'hotel_dispatch_task', description: 'Dispatch a queued task to its existing Agent if dependencies, permissions and limits pass. This tool cannot approve or execute production business writes.', inputSchema: task, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    { name: 'hotel_submit_result', description: 'Return evidence for the current active task attempt. Results remain pending owner acceptance; no approval or success can be granted here.', inputSchema: schema({ taskId: string, attemptId: string, result: { type: 'object', description: 'HotelTaskResult: summary,completedItems,missingItems,sources[{label,uri,observedAt}],artifacts[{label,uri}],dataPeriod,verificationNotes,suggestedNextActions; optional metrics/content.' } }, ['taskId', 'attemptId', 'result']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
    { name: 'hotel_reconcile_task', description: 'Read the exact prior execution session and import a valid result; never resends or duplicates execution.', inputSchema: task, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  );
  return tools;
}

let bridge: Promise<HotelBridge> | undefined;
export function getHotelBridge(): Promise<HotelBridge> {
  bridge ??= (async () => {
    const { app } = await import('electron');
    return new HotelBridge(join(app.getPath('userData'), 'hotel-bridge-credential.json'));
  })();
  return bridge;
}

/** Runs before host auth, but authenticates a distinct, narrowly scoped credential. */
export async function handleHotelBridgeRequest(req: IncomingMessage, res: ServerResponse, url: URL, ctx: HostApiContext): Promise<boolean> {
  if (url.pathname !== '/hotel-bridge/mcp') return false;
  try {
    // Native MCP clients have no Origin; browser-based calls are deliberately rejected.
    if (req.headers.origin) { sendJson(res, 403, { error: 'Browser origins are not allowed for the local hotel bridge' }); return true; }
    const bridge = await getHotelBridge();
    const authorization = req.headers.authorization ?? '';
    const grant = await bridge.authorize(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
    if (!grant) { sendJson(res, 401, { error: 'Unauthorized hotel bridge credential' }); return true; }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); sendJson(res, 405, { error: 'This stateless MCP endpoint does not offer an SSE stream' }); return true; }
    if (!req.headers['content-type']?.includes('application/json')) { sendJson(res, 415, { error: 'Content-Type must be application/json' }); return true; }
    const version = req.headers['mcp-protocol-version'];
    if (version && version !== PROTOCOL_VERSION && version !== '2025-03-26') { sendJson(res, 400, { error: 'Unsupported MCP protocol version' }); return true; }
    const response = await bridge.process(await readHotelJson(req), await getHotelRuntime(ctx), grant);
    res.setHeader('Cache-Control', 'no-store');
    if (response === null) { res.statusCode = 202; res.end(); }
    else sendJson(res, 200, response);
  } catch (error) {
    sendJson(res, error instanceof HotelDomainError ? error.statusCode : 500, { error: error instanceof Error ? error.message : 'Hotel bridge unavailable' });
  }
  return true;
}
