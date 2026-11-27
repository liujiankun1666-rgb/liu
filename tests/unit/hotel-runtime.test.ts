// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HotelService } from '../../electron/services/hotel/domain';
import { MemoryHotelStore } from '../../electron/services/hotel/store';
import { HotelRuntime } from '../../electron/services/hotel/runtime';
import { assistantText, parseHotelResult } from '../../electron/services/hotel/gateway-payload';
import { createHotelWorkflow } from '../../electron/services/hotel/workflows';
import type { HotelTask, HotelTaskResult } from '../../shared/hotel';

vi.mock('../../electron/utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../electron/utils/agent-config', () => ({ listAgentsSnapshot: vi.fn() }));
vi.mock('../../electron/services/hotel/execution-policy', () => ({ inspectHotelExecutionPolicy: vi.fn() }));

const evidence: HotelTaskResult = {
  summary: '测试报告：来源可核对', completedItems: ['核对测试输入'], missingItems: [],
  sources: [{ label: '测试报表', uri: 'fixture://daily-report', observedAt: '2026-11-27T00:00:00Z' }],
  artifacts: [], dataPeriod: '2026-11-27', verificationNotes: '仅为测试数据', suggestedNextActions: [],
};
const runtimes: HotelRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

async function harness(options: { deny?: boolean; store?: MemoryHotelStore; rpc?: ReturnType<typeof vi.fn> } = {}) {
  const store = options.store ?? new MemoryHotelStore();
  const service = new HotelService(store);
  const gateway = Object.assign(new EventEmitter(), {
    rpc: options.rpc ?? vi.fn().mockResolvedValue({ runId: 'run-1' }),
    getStatus: () => ({ state: 'running', port: 18789 }),
  });
  const runtime = new HotelRuntime(service, gateway as never, {
    agents: async () => ({ agents: [{ id: 'worker', name: '已有运营 Agent' }, { id: 'boss', name: '已有总管 Agent' }], defaultAgentId: 'worker' }) as never,
    policy: async () => ({ allowed: !options.deny, reason: options.deny ? '工具权限未核验' : 'test', verifiedTools: ['read'] }),
    autoStart: false,
  });
  runtimes.push(runtime);
  await runtime.snapshot();
  await service.setBinding({ propertyId: 'xingcheng-aigong', role: 'pms', agentId: 'worker', enabled: true, notes: '测试绑定' });
  return { store, service, gateway, runtime };
}
async function queued(service: HotelService, key = 'one') {
  const task = await service.createTask({ propertyId: 'xingcheng-aigong', title: '读取经营报表', objective: '只读测试报表', role: 'pms', action: 'read', acceptanceCriteria: ['来源清楚'], idempotencyKey: key });
  return service.queueTask(task.id);
}
function finalEvent(task: HotelTask, result = evidence, runId = 'run-1') {
  const attempt = task.attempts.at(-1)!;
  return { sessionKey: attempt.sessionKey, runId, state: 'final', message: { role: 'assistant', content: JSON.stringify({ taskId: task.id, attemptId: attempt.id, outcome: 'completed', result }) } };
}

describe('hotel Gateway orchestration', () => {
  it('reserves durable attempts before sending and never duplicates concurrent dispatches', async () => {
    const h = await harness();
    const task = await queued(h.service);
    h.gateway.rpc.mockImplementation(async (_method: string, params: Record<string, unknown>) => {
      const persisted = (await h.service.snapshot()).tasks.find((item) => item.id === task.id)!;
      expect(persisted.status).toBe('running');
      expect(persisted.attempts[0].sessionKey).toBe(params.sessionKey);
      expect(params.deliver).toBe(false);
      expect(params.idempotencyKey).toBe(persisted.attempts[0].dispatchKey);
      return { runId: 'run-1' };
    });
    const [first, second] = await Promise.all([h.runtime.dispatch(task.id), h.runtime.dispatch(task.id)]);
    expect(first.attempts).toHaveLength(1);
    expect(second.attempts).toHaveLength(1);
    expect(h.gateway.rpc).toHaveBeenCalledTimes(1);
  });

  it('does not contact Gateway when the execution policy fails', async () => {
    const h = await harness({ deny: true });
    const task = await queued(h.service);
    await expect(h.runtime.dispatch(task.id)).rejects.toThrow('权限');
    expect(h.gateway.rpc).not.toHaveBeenCalled();
    expect((await h.service.snapshot()).tasks[0].attempts).toHaveLength(0);
  });

  it('rejects mismatched session/run identities, deduplicates finals, and waits for acceptance', async () => {
    const h = await harness();
    const task = await h.runtime.dispatch((await queued(h.service)).id);
    await vi.waitFor(async () => expect((await h.service.snapshot()).tasks[0].attempts[0].runId).toBe('run-1'));
    await h.runtime.handleChat({ ...finalEvent(task), sessionKey: 'agent:worker:other' });
    await h.runtime.handleChat(finalEvent(task, evidence, 'wrong-run'));
    expect((await h.service.snapshot()).tasks[0].status).toBe('running');
    await h.runtime.handleChat(finalEvent(task));
    await h.runtime.handleChat(finalEvent(task));
    const returned = (await h.service.snapshot()).tasks[0];
    expect(returned.status).toBe('needs_review');
    expect(returned.result?.summary).toBe(evidence.summary);
    expect((await h.service.snapshot()).audit.filter((item) => item.action === 'result.returned')).toHaveLength(1);
  });

  it('does not treat tool text or a plain assistant success claim as an accepted result', async () => {
    const h = await harness();
    const task = await h.runtime.dispatch((await queued(h.service)).id);
    await h.runtime.handleChat({ ...finalEvent(task), message: { role: 'toolresult', content: 'all done' } });
    expect((await h.service.snapshot()).tasks[0].status).toBe('running');
    await h.runtime.handleChat({ ...finalEvent(task), message: { role: 'assistant', content: '工作全部完成' } });
    expect((await h.service.snapshot()).tasks[0].status).toBe('failed');
  });

  it('leaves an uncertain acknowledgement blocked and reconciles exact history without redispatch', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('RPC timeout'));
    const h = await harness({ rpc });
    const task = await h.runtime.dispatch((await queued(h.service)).id);
    await vi.waitFor(async () => expect((await h.service.snapshot()).tasks[0].status).toBe('blocked'));
    await h.runtime.tick();
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValue({ messages: [finalEvent(task).message] });
    const restored = await h.runtime.reconcile(task.id);
    expect(restored.status).toBe('needs_review');
    expect(rpc.mock.calls.filter((call) => call[0] === 'chat.send')).toHaveLength(1);
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('chat.history');
  });

  it('recovers a restart without silently sending queued duplicate work', async () => {
    const first = await harness();
    const task = await first.runtime.dispatch((await queued(first.service)).id);
    await vi.waitFor(async () => expect((await first.service.snapshot()).tasks[0].attempts[0].runId).toBe('run-1'));
    first.runtime.dispose();
    const second = await harness({ store: first.store });
    const recovered = (await second.service.snapshot()).tasks.find((item) => item.id === task.id)!;
    expect(recovered.status).toBe('blocked');
    expect(recovered.attempts[0].outcome).toBe('uncertain');
    await second.runtime.tick();
    expect(second.gateway.rpc).not.toHaveBeenCalled();
  });

  it('requires abort confirmation even for an uncertain active run', async () => {
    const h = await harness({ rpc: vi.fn().mockRejectedValue(new Error('timeout')) });
    const task = await h.runtime.dispatch((await queued(h.service)).id);
    await vi.waitFor(async () => expect((await h.service.snapshot()).tasks[0].status).toBe('blocked'));
    h.gateway.rpc.mockResolvedValue({ aborted: false });
    await expect(h.runtime.cancel(task.id)).rejects.toThrow('未确认取消');
    expect((await h.service.snapshot()).tasks[0].status).toBe('blocked');
    h.gateway.rpc.mockResolvedValue({ aborted: true });
    expect((await h.runtime.cancel(task.id)).status).toBe('cancelled');
  });

  it('serializes cancellation with dispatch so a queued-to-running race still aborts the run', async () => {
    const h = await harness();
    h.gateway.rpc.mockImplementation(async (method: string) => method === 'chat.abort' ? { aborted: true } : { runId: 'run-1' });
    const task = await queued(h.service);
    const [started, cancelled] = await Promise.all([h.runtime.dispatch(task.id), h.runtime.cancel(task.id)]);
    expect(started.status).toBe('running');
    expect(cancelled.status).toBe('cancelled');
    expect(h.gateway.rpc.mock.calls.map((call) => call[0])).toEqual(['chat.send', 'chat.abort']);
  });

  it('caps concurrent reservations at two', async () => {
    const h = await harness();
    const tasks = await Promise.all(['a', 'b', 'c'].map((key) => queued(h.service, key)));
    const results = await Promise.allSettled(tasks.map((task) => h.runtime.dispatch(task.id)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(h.gateway.rpc).toHaveBeenCalledTimes(2);
  });

  it('queues a distinct supervisor assessment and applies it only to the original evidence', async () => {
    const h = await harness();
    await h.service.setBinding({ propertyId: 'xingcheng-aigong', role: 'supervisor', agentId: 'boss', enabled: true, notes: '独立验收' });
    const worker = await h.runtime.dispatch((await queued(h.service)).id);
    await h.runtime.handleChat(finalEvent(worker));
    const review = (await h.service.snapshot()).tasks.find((task) => task.reviewTarget?.taskId === worker.id)!;
    expect(review.status).toBe('queued');
    const claimed = await h.runtime.dispatch(review.id);
    await h.runtime.handleChat(finalEvent(claimed, { ...evidence, assessment: { decision: 'accept', note: '已核对来源、时间和全部验收项' } }));
    const snapshot = await h.service.snapshot();
    expect(snapshot.tasks.find((task) => task.id === worker.id)?.status).toBe('succeeded');
    expect(snapshot.tasks.find((task) => task.id === worker.id)?.review?.actor).toBe('supervisor');
    expect(snapshot.tasks.find((task) => task.id === review.id)?.status).toBe('succeeded');
    expect(snapshot.tasks).toHaveLength(2);
  });

  it('repairs a crash between result persistence and supervisor review creation idempotently', async () => {
    const h = await harness();
    await h.service.setBinding({ propertyId: 'xingcheng-aigong', role: 'supervisor', agentId: 'boss', enabled: true, notes: '独立验收' });
    const worker = await h.runtime.dispatch((await queued(h.service)).id);
    await h.service.submitResult(worker.id, worker.attempts[0].id, evidence);
    expect((await h.service.snapshot()).tasks).toHaveLength(1);
    await h.runtime.repairPendingReviews();
    await h.runtime.repairPendingReviews();
    const snapshot = await h.service.snapshot();
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.tasks.find((task) => task.reviewTarget)?.status).toBe('queued');
  });

  it('creates an idempotent, complete multi-agent workflow with real dependencies', async () => {
    const h = await harness();
    const input = { propertyId: 'xingcheng-aigong', kind: 'daily_operations' as const, idempotencyKey: 'daily-test' };
    const [first, second] = await Promise.all([createHotelWorkflow(h.service, input), createHotelWorkflow(h.service, input)]);
    expect(first).toHaveLength(7);
    expect(second.map((task) => task.id)).toEqual(first.map((task) => task.id));
    expect((await h.service.snapshot()).tasks).toHaveLength(7);
    expect(first[0].dependencies).toHaveLength(6);
    expect(first.slice(1).every((task) => task.parentTaskId === first[0].id)).toBe(true);
    expect((await createHotelWorkflow(h.service, input)).map((task) => task.id)).toEqual(first.map((task) => task.id));
    await expect(h.runtime.dispatch(first[0].id)).rejects.toThrow();
  });
});

describe('structured result protocol', () => {
  it('requires task and attempt binding', () => {
    expect(() => parseHotelResult('{"taskId":"a","attemptId":"b","outcome":"completed","result":{}}', 'a', 'c')).toThrow('不匹配');
    expect(parseHotelResult('```json\n{"taskId":"a","attemptId":"b","outcome":"failed","error":"missing login"}\n```', 'a', 'b').outcome).toBe('failed');
  });
  it('does not consume assistant tool-call turns', () => {
    expect(assistantText({ role: 'assistant', content: [{ type: 'text', text: 'maybe complete' }, { type: 'toolCall', name: 'read' }] })).toBe('');
  });
});

describe('separate native technical executor', () => {
  it('runs without Gateway, isolates identity and prevents shared-bridge completion', async () => {
    const h = await harness(); h.runtime.dispose();
    h.gateway.getStatus = () => ({ state: 'stopped', port: 18789 });
    let finish: (value: { text: string; runId: string; threadId: string; workspace: string }) => void = () => {};
    const execute = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const native = { describe: async () => ({ id: 'codex-cli-technical', name: 'native', executionBackend: 'codex-cli' as const }), inspect: async () => ({ allowed: true, reason: 'unit test fixture', verifiedTools: [] }), execute, reconcile: vi.fn(), cancel: vi.fn() };
    const runtime = new HotelRuntime(h.service, h.gateway as never, { agents: async () => ({ agents: [], defaultAgentId: '' }) as never, codex: native, autoStart: false }); runtimes.push(runtime);
    await runtime.snapshot();
    await h.service.setBinding({ propertyId: 'xingcheng-aigong', role: 'codex', agentId: 'codex-cli-technical', enabled: true, notes: 'test fixture' });
    const draft = await h.service.createTask({ propertyId: 'xingcheng-aigong', role: 'codex', action: 'code', title: 'native fixture', objective: 'test', acceptanceCriteria: ['real tools in integration test'], idempotencyKey: 'native-fixture' });
    await h.service.queueTask(draft.id);
    const [task, duplicate] = await Promise.all([runtime.dispatch(draft.id), runtime.dispatch(draft.id)]);
    const attempt = task.attempts.at(-1)!;
    expect(attempt.executor).toBe('codex-cli'); expect(attempt.sessionKey).toMatch(/^codex-cli:/);
    expect(duplicate.attempts).toHaveLength(1); expect(execute).toHaveBeenCalledTimes(1); expect(h.gateway.rpc).not.toHaveBeenCalled();
    for (const origin of ['bridge', 'owner', 'gateway'] as const) await expect(runtime.returnResult(task.id, attempt.id, evidence, origin)).rejects.toThrow('only accept');
    await runtime.handleChat({ ...finalEvent(task), runId: 'fake-gateway' });
    expect((await h.service.snapshot()).tasks[0].status).toBe('running');
    finish({ text: JSON.stringify({ taskId: task.id, attemptId: attempt.id, outcome: 'completed', result: evidence }), runId: 'codex-cli:thread:attempt', threadId: 'thread', workspace: '/unit-fixture' });
    await vi.waitFor(async () => expect((await h.service.snapshot()).tasks[0].status).toBe('needs_review'));
    expect((await h.service.snapshot()).tasks[0].resultOrigin).toBe('codex-cli');
    expect((await h.service.snapshot()).tasks[0].review).toBeUndefined();
  });
});

it('rejects reserved native identity collisions instead of switching an OpenClaw binding', async () => {
  const h = await harness(); h.runtime.dispose();
  const inspect = vi.fn().mockResolvedValue({ allowed: true, reason: 'fixture', verifiedTools: [] });
  const runtime = new HotelRuntime(h.service, h.gateway as never, { agents: async () => ({ agents: [{ id: 'codex-cli-technical', name: 'existing OpenClaw identity' }], defaultAgentId: 'codex-cli-technical' }) as never, codex: { describe: async () => ({ id: 'codex-cli-technical', name: 'native' }), inspect, execute: vi.fn(), reconcile: vi.fn(), cancel: vi.fn() }, autoStart: false });
  runtimes.push(runtime); await runtime.snapshot();
  expect((await runtime.inspectExecutionPolicy('codex-cli-technical', 'code', 'xingcheng-aigong')).allowed).toBe(false);
  expect(inspect).not.toHaveBeenCalled();
  await expect(runtime.inspectExecutionPolicy('codex-cli-technical', 'analysis', 'xingcheng-aigong')).rejects.toThrow('action=code');
});
