// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HotelService, hotelPlanHash, scheduleSlot } from '../../electron/services/hotel/domain';
import { FileHotelStore, MemoryHotelStore, type HotelSnapshotStore } from '../../electron/services/hotel/store';
import type { CreateHotelTaskInput, HotelContent, HotelPlannedTask, HotelSchedule, HotelSnapshot, HotelTask, HotelTaskResult } from '../../shared/hotel';

const PROPERTY = 'xingcheng-aigong';
let counter = 0;
let clock: Date;
let store: MemoryHotelStore;
let service: HotelService;
const taskInput = (overrides: Partial<CreateHotelTaskInput> = {}): CreateHotelTaskInput => ({
  propertyId: PROPERTY, title: '经营日检查', objective: '读取已授权测试数据，形成有证据的报告', role: 'pms', action: 'read',
  acceptanceCriteria: ['真实来源', '统一经营日'], idempotencyKey: `request-${++counter}`, ...overrides,
});
const resultInput = (overrides: Partial<HotelTaskResult> = {}): HotelTaskResult => ({
  summary: '读取成功，数据等待验收', completedItems: ['读取指定测试报告'], missingItems: [],
  sources: [{ label: '测试 PMS 报表', uri: 'https://example.test/report', observedAt: '2026-11-27T01:00:00Z' }], artifacts: [],
  dataPeriod: '2026-11-27 Asia/Shanghai', verificationNotes: '已核对来源及经营日', suggestedNextActions: [], ...overrides,
});
const contentInput = (score = 80): HotelContent => ({
  topic: 'hotel', title: `选题-${++counter}`, hook: '为什么电竞房的网络很重要？', script: '先展示测试，再解释三个检查步骤。',
  storyboard: '镜头一环境，镜头二网络测试，镜头三服务介绍。', subtitles: '先测延迟，再看体验。', coverPlan: '酒店实景与清晰短标题',
  caption: '体验前先了解房间配置与服务。', durationSeconds: 45, aspectRatio: '9:16',
  scores: [{ criterion: '准确与完整', score: 40, maximum: 50, reason: '素材来源清晰，仍可增加实拍' }, { criterion: '表现与节奏', score: score - 40, maximum: 50, reason: '结构完整，节奏需要实拍验证' }],
  improvements: ['增加现场网络测试实拍'],
});
const plan = { target: '测试门店/测试房型/2026-12-01', before: '299', after: '319', reason: '待验证需求变化', rollback: '恢复原方案，核验订单影响' };

async function enable(role: HotelTask['role'] = 'pms', propertyId = PROPERTY): Promise<void> {
  await service.setBinding({ propertyId, role, agentId: `${role}-existing`, enabled: true, notes: '测试运行环境已隔离；不代表生产权限' });
}
async function start(input = taskInput()): Promise<HotelTask> {
  const task = await service.createTask(input); await enable(input.role, input.propertyId); await service.queueTask(task.id);
  return await service.claimTask(task.id, { availableAgentIds: [`${input.role}-existing`], leaseMs: 5000 });
}
async function complete(task: HotelTask, result = resultInput()): Promise<HotelTask> {
  await service.submitResult(task.id, task.attempts.at(-1)!.id, result);
  return await service.reviewTask(task.id, { actor: 'owner', decision: 'accept', note: '按任务标准核对通过' });
}

beforeEach(() => {
  counter = 0; clock = new Date('2026-11-27T01:05:00Z'); store = new MemoryHotelStore();
  service = new HotelService(store, { now: () => clock, id: () => `id-${++counter}` });
});

describe('hotel task ownership, persistence and acceptance', () => {
  it('starts with eight unbound roles and no fabricated metrics or existing Agent ids', async () => {
    const snapshot = await service.snapshot();
    expect(snapshot.properties[0]).toMatchObject({ id: PROPERTY, city: '兴城市', timezone: 'Asia/Shanghai' });
    expect(snapshot.bindings).toHaveLength(8); expect(snapshot.bindings.every((b) => !b.agentId && !b.enabled)).toBe(true);
    const report = await service.report(PROPERTY, '2026-11-27');
    expect(Object.values(report.metrics)).toEqual([null, null, null, null, null, null]); expect(report.occupancyRate).toBeNull();
  });

  it('coalesces identical idempotent submissions but rejects changed content under the same key', async () => {
    const input = taskInput(); const [first, second] = await Promise.all([service.createTask(input), service.createTask(input)]);
    expect(first.id).toBe(second.id); expect((await service.snapshot()).tasks).toHaveLength(1);
    await expect(service.createTask({ ...input, objective: 'different' })).rejects.toThrow('Idempotency');
  });

  it('does not reserve attempts when binding or current agent inventory is missing', async () => {
    const task = await service.createTask(taskInput()); await service.queueTask(task.id);
    await expect(service.claimTask(task.id, { availableAgentIds: ['pms-existing'] })).rejects.toThrow('bound');
    await enable(); await expect(service.claimTask(task.id, { availableAgentIds: [] })).rejects.toThrow('available');
    expect((await service.snapshot()).tasks[0].attempts).toHaveLength(0);
  });

  it('atomically rejects bindings or task revisions changed after an execution policy preflight', async () => {
    const task = await service.createTask(taskInput()); await enable(); await service.queueTask(task.id);
    await service.setBinding({ propertyId: PROPERTY, role: 'pms', agentId: 'new-worker', enabled: true, notes: 'Preflight raced with an owner edit' });
    await expect(service.claimTask(task.id, { availableAgentIds: ['pms-existing', 'new-worker'], expectedAgentId: 'pms-existing', expectedPlanVersion: 1 })).rejects.toThrow('binding changed');
    await service.updateTask(task.id, { objective: 'Revised objective' }); await service.queueTask(task.id);
    await expect(service.claimTask(task.id, { availableAgentIds: ['new-worker'], expectedAgentId: 'new-worker', expectedPlanVersion: 1 })).rejects.toThrow('Task changed');
    expect((await service.snapshot()).tasks[0].attempts).toHaveLength(0);
  });

  it('persists a unique independent attempt before dispatch and requires separate owner acceptance', async () => {
    const task = await start(); const attempt = task.attempts[0];
    expect(attempt.sessionKey).toBe(`agent:pms-existing:hotel:${task.id}:${attempt.id}`);
    await service.markDispatched(task.id, attempt.id, 'run-123');
    const returned = await service.submitResult(task.id, attempt.id, resultInput());
    expect(returned.status).toBe('needs_review');
    expect((await new HotelService(store).snapshot()).tasks[0].status).toBe('needs_review');
    await expect(service.reviewTask(task.id, { actor: 'worker' as 'owner', decision: 'accept', note: '自己通过' })).rejects.toThrow('owner');
    const accepted = await service.reviewTask(task.id, { actor: 'owner', decision: 'accept', note: '证据与验收标准一致' });
    expect(accepted.status).toBe('succeeded');
    await expect(service.submitResult(task.id, attempt.id, resultInput())).rejects.toThrow('inactive');
  });

  it('rejects evidence-free returns and prevents accepting incomplete reports', async () => {
    const task = await start(); const attempt = task.attempts[0];
    await expect(service.submitResult(task.id, attempt.id, resultInput({ sources: [] }))).rejects.toThrow('evidence');
    await service.submitResult(task.id, attempt.id, resultInput({ missingItems: ['渠道数据未授权'] }));
    await expect(service.reviewTask(task.id, { actor: 'owner', decision: 'accept', note: '忽略缺失' })).rejects.toThrow('Incomplete');
    const returned = await service.reviewTask(task.id, { actor: 'owner', decision: 'return', note: '补齐渠道数据' });
    expect(returned.status).toBe('draft'); expect(returned.planVersion).toBe(2); expect(returned.inputs).toContain('补齐渠道数据');
  });

  it('requires all child tasks and explicit dependencies to succeed before the parent runs', async () => {
    const parent = await service.createTask(taskInput({ role: 'supervisor' }));
    const child = await service.createTask(taskInput({ parentTaskId: parent.id }));
    await service.updateTask(parent.id, { dependencies: [child.id] }); await enable('supervisor'); await enable();
    await service.queueTask(parent.id); await service.queueTask(child.id);
    await expect(service.claimTask(parent.id, { availableAgentIds: ['supervisor-existing'] })).rejects.toThrow('dependencies');
    const runningChild = await service.claimTask(child.id, { availableAgentIds: ['pms-existing'] }); await complete(runningChild);
    expect((await service.claimTask(parent.id, { availableAgentIds: ['supervisor-existing'] })).status).toBe('running');
  });

  it('rejects explicit and implicit parent-child dependency cycles', async () => {
    const a = await service.createTask(taskInput()); const b = await service.createTask(taskInput({ dependencies: [a.id] }));
    await expect(service.updateTask(a.id, { dependencies: [b.id] })).rejects.toThrow('cycle');
    const parent = await service.createTask(taskInput());
    await expect(service.createTask(taskInput({ parentTaskId: parent.id, dependencies: [parent.id] }))).rejects.toThrow('cycle');
  });

  it('keeps another property out of dependencies, parent links, knowledge and exports', async () => {
    await service.saveProperty({ id: 'second', name: '测试第二店', city: '测试城市', timezone: 'Asia/Shanghai' });
    const foreign = await service.createTask(taskInput({ propertyId: 'second' }));
    const knowledge = await service.saveKnowledge({ propertyId: 'second', title: '二店制度', category: 'policy', content: '二店专属', source: '测试制度' });
    await expect(service.createTask(taskInput({ dependencies: [foreign.id] }))).rejects.toThrow('Cross-property');
    await expect(service.createTask(taskInput({ parentTaskId: foreign.id }))).rejects.toThrow('another property');
    await expect(service.createTask(taskInput({ knowledgeIds: [knowledge.id] }))).rejects.toThrow('Knowledge');
    const exported = await service.exportProperty(PROPERTY); expect(exported.properties).toHaveLength(1); expect(exported.tasks).toHaveLength(0); expect(exported.knowledge).toHaveLength(0);
  });

  it('checks bridge parent state atomically so draft-only proposals cannot change queued workflows', async () => {
    const parent = await service.createTask(taskInput({ role: 'supervisor' }));
    await service.queueTask(parent.id);
    await expect(service.createTask(taskInput({ parentTaskId: parent.id }), 'bridge')).rejects.toThrow('unexpanded draft');
    expect((await service.snapshot()).tasks).toHaveLength(1);
    const draft = await service.createTask(taskInput({ role: 'supervisor' }));
    expect((await service.createTask(taskInput({ parentTaskId: draft.id }), 'bridge')).status).toBe('draft');
  });

  it('marks restart and timeout as uncertain and requires explicit reconciliation acknowledgement before retry', async () => {
    const task = await start(); const id = task.id; const previousAttempt = task.attempts[0].id;
    service = new HotelService(store, { now: () => clock, id: () => `id-${++counter}` });
    const recovered = await service.recoverInterruptedTasks(); expect(recovered).toHaveLength(1); expect(recovered[0].status).toBe('blocked');
    await expect(service.queueTask(id)).rejects.toThrow('uncertain'); await expect(service.retryTask(id)).rejects.toThrow('uncertain');
    await service.retryTask(id, { acknowledgeUncertain: true }); const next = await service.claimTask(id, { availableAgentIds: ['pms-existing'], leaseMs: 1000 });
    expect(next.attempts[1].id).not.toBe(previousAttempt);
    await expect(service.submitResult(id, previousAttempt, resultInput())).rejects.toThrow('Stale');
    clock = new Date(clock.getTime() + 1001); expect((await service.expireLeases())[0].status).toBe('blocked');
  });

  it('reconciles the original uncertain attempt without adding another dispatch or attempt', async () => {
    const task = await start(); const attempt = task.attempts[0];
    await service.failTask(task.id, attempt.id, 'Gateway acknowledged too late', true);
    const resumed = await service.resumeForReconciliation(task.id, attempt.id); expect(resumed.attempts).toHaveLength(1);
    expect((await service.submitResult(task.id, attempt.id, resultInput())).status).toBe('needs_review');
  });

  it('enforces finite retry limits and rejects late results after cancellation', async () => {
    const task = await start(taskInput({ maxAttempts: 1 })); await service.failTask(task.id, task.attempts[0].id, 'Explicit failure');
    await expect(service.retryTask(task.id)).rejects.toThrow('limit');
    const another = await start(); await service.cancelTask(another.id);
    await expect(service.submitResult(another.id, another.attempts[0].id, resultInput())).rejects.toThrow('inactive');
  });
});

describe('concrete plan approval and external write boundaries', () => {
  it('never dispatches business writes even after owner approval and binds approvals to plan revision and hash', async () => {
    const task = await service.createTask(taskInput({ action: 'price_change', role: 'revenue', plan }));
    const queued = await service.queueTask(task.id); expect(queued.status).toBe('awaiting_approval');
    await expect(service.approveTask(task.id, { actor: 'owner', decision: 'approve', planVersion: 2, note: '过期版本' })).rejects.toThrow('changed');
    await expect(service.approveTask(task.id, { actor: 'owner', decision: 'approve', planVersion: 1, planHash: 'wrong', note: '错误摘要' })).rejects.toThrow('changed');
    const approved = await service.approveTask(task.id, { actor: 'owner', decision: 'approve', planVersion: 1, planHash: hotelPlanHash(task), note: '批准该具体测试方案' });
    expect(approved.status).toBe('blocked'); expect(approved.approval?.planHash).toBe(hotelPlanHash(task)); expect(approved.blockedReason).toContain('No external action');
    await enable('revenue'); await expect(service.claimTask(task.id, { availableAgentIds: ['revenue-existing'] })).rejects.toThrow();
    const revised = await service.updateTask(task.id, { plan: { ...plan, after: '399' } });
    expect(revised.planVersion).toBe(2); expect(revised.approval).toBeUndefined();
    expect(revised.planHistory?.[0]).toMatchObject({ planVersion: 1, plan: { after: '319' }, approval: { decision: 'approve', planHash: hotelPlanHash(task) } });
    expect((await service.queueTask(task.id)).status).toBe('awaiting_approval');
  });

  it('does not approve absent plans or redispatch rejected plans', async () => {
    const noPlan = await service.createTask(taskInput({ action: 'refund' }));
    expect((await service.queueTask(noPlan.id)).status).toBe('blocked');
    const task = await service.createTask(taskInput({ action: 'refund', plan })); await service.queueTask(task.id);
    await service.approveTask(task.id, { actor: 'owner', decision: 'reject', planVersion: 1, note: '证据不足' });
    expect((await service.queueTask(task.id)).blockedReason).toContain('rejected');
  });

  it('creates one technical escalation for a failed business task, without recursive delegation', async () => {
    const task = await start(); await service.failTask(task.id, task.attempts[0].id, 'Read adapter failed');
    const technical = await service.createTechnicalTask(task.id); expect(technical.role).toBe('codex'); expect(technical.status).toBe('draft');
    expect((await service.createTechnicalTask(task.id)).id).toBe(technical.id);
    await enable('codex'); await service.queueTask(technical.id);
    const run = await service.claimTask(technical.id, { availableAgentIds: ['codex-existing'] }); await service.failTask(run.id, run.attempts[0].id, 'Technical failure');
    await expect(service.createTechnicalTask(run.id)).rejects.toThrow('recursively');
  });
});

describe('independent supervisor acceptance and owner-confirmed delegation', () => {
  async function returnedWorker(result = resultInput()): Promise<HotelTask> {
    const task = await start(); await service.submitResult(task.id, task.attempts[0].id, result); await enable('supervisor'); return task;
  }
  async function runningReview(target: HotelTask): Promise<HotelTask> {
    const review = await service.createSupervisorReview(target.id); await service.queueTask(review.id);
    return service.claimTask(review.id, { availableAgentIds: ['supervisor-existing'] });
  }
  it('lets an independent bound supervisor accept immutable returned evidence without approving business writes', async () => {
    const target = await returnedWorker(); const review = await service.createSupervisorReview(target.id);
    expect((await service.createSupervisorReview(target.id)).id).toBe(review.id);
    await service.queueTask(review.id); const running = await service.claimTask(review.id, { availableAgentIds: ['supervisor-existing'] });
    const finished = await service.submitResult(review.id, running.attempts[0].id, resultInput({ assessment: { decision: 'accept', note: '逐项核对原任务来源和口径，一致' } }));
    expect(finished.status).toBe('succeeded');
    const accepted = (await service.snapshot()).tasks.find((t) => t.id === target.id)!;
    expect(accepted.status).toBe('succeeded'); expect(accepted.review).toMatchObject({ actor: 'supervisor', reviewerTaskId: review.id, decision: 'accept' });
    const sensitive = await service.createTask(taskInput({ action: 'price_change', plan })); await service.queueTask(sensitive.id);
    await expect(service.approveTask(sensitive.id, { actor: 'supervisor' as 'owner', decision: 'approve', planVersion: 1, note: '越权批准' })).rejects.toThrow('owner');
  });

  it('refuses self-review, forged assessments, changed reviewer bindings and edits to review briefs', async () => {
    const target = await returnedWorker();
    await service.setBinding({ propertyId: PROPERTY, role: 'supervisor', agentId: 'pms-existing', enabled: true, notes: '相同执行人' });
    await expect(service.createSupervisorReview(target.id)).rejects.toThrow('own work');
    await enable('supervisor'); const review = await runningReview(target);
    await expect(service.updateTask(review.id, { objective: '改变审核目标' })).rejects.toThrow();
    await service.setBinding({ propertyId: PROPERTY, role: 'supervisor', agentId: 'other-supervisor', enabled: true, notes: '切换总管' });
    await expect(service.submitResult(review.id, review.attempts[0].id, resultInput({ assessment: { decision: 'accept', note: '旧总管提交' } }))).rejects.toThrow('binding changed');
    const worker = await start();
    await expect(service.submitResult(worker.id, worker.attempts[0].id, resultInput({ assessment: { decision: 'accept', note: '伪造自审' } }))).rejects.toThrow('reserved');
  });

  it.each(['owner', 'bridge'] as const)('does not accept an independent supervisor verdict submitted through %s origin', async (origin) => {
    const target = await returnedWorker(); const review = await runningReview(target);
    await expect(service.submitResult(review.id, review.attempts[0].id, resultInput({ assessment: { decision: 'accept', note: '非Gateway伪装总管结论' } }), origin)).rejects.toThrow('correlated Gateway');
    expect((await service.snapshot()).tasks.find((t) => t.id === target.id)!.status).toBe('needs_review');
  });

  it('records externally supplied evidence with its actual origin', async () => {
    const task = await start();
    const result = await service.submitResult(task.id, task.attempts[0].id, resultInput(), 'bridge');
    expect(result.resultOrigin).toBe('bridge'); expect(result.status).toBe('needs_review');
    expect((await service.snapshot()).audit.at(-1)?.actor).toBe('bridge');
  });

  it('retains prior manually returned results and review decisions through editing and another execution', async () => {
    const task = await start();
    await service.submitResult(task.id, task.attempts[0].id, resultInput({ summary: 'First bridge result with original evidence' }), 'bridge');
    await service.reviewTask(task.id, { actor: 'owner', decision: 'return', note: '需要补充明细' });
    await service.updateTask(task.id, { objective: '补充明细并重新核对' });
    await service.queueTask(task.id);
    const rerun = await service.claimTask(task.id, { availableAgentIds: ['pms-existing'] });
    await service.submitResult(task.id, rerun.attempts[1].id, resultInput({ summary: 'Second owner supplied result' }), 'owner');
    await service.reviewTask(task.id, { actor: 'owner', decision: 'accept', note: '补充后通过' });
    const exported = (await service.exportProperty(PROPERTY)).tasks.find((t) => t.id === task.id)!;
    expect(exported.result?.summary).toBe('Second owner supplied result');
    expect(exported.resultHistory).toHaveLength(2);
    expect(exported.resultHistory?.[0]).toMatchObject({ attemptId: task.attempts[0].id, origin: 'bridge', result: { summary: 'First bridge result with original evidence' }, review: { decision: 'return', note: '需要补充明细' } });
    expect(exported.resultHistory?.[1]).toMatchObject({ origin: 'owner', review: { decision: 'accept' } });
    expect(exported.planHistory?.map((entry) => entry.planVersion)).toEqual([1, 2]);
  });

  it('rejects an assessment against a changed result hash and keeps the original target pending', async () => {
    const target = await returnedWorker(); const review = await runningReview(target);
    const snapshot = await service.snapshot(); snapshot.tasks.find((t) => t.id === target.id)!.result!.summary = 'Changed evidence'; await store.save(snapshot);
    service = new HotelService(store, { now: () => clock, id: () => `id-${++counter}` });
    await expect(service.submitResult(review.id, review.attempts[0].id, resultInput({ assessment: { decision: 'accept', note: '按旧版通过' } }))).rejects.toThrow('stale');
    expect((await service.snapshot()).tasks.find((t) => t.id === target.id)!.status).toBe('needs_review');
  });

  it('requires reviewers to return incomplete work and prevents injecting new operating metrics', async () => {
    const target = await returnedWorker(resultInput({ missingItems: ['缺少渠道订单'] })); const review = await runningReview(target);
    await expect(service.submitResult(review.id, review.attempts[0].id, resultInput({ assessment: { decision: 'accept', note: '忽略遗漏' } }))).rejects.toThrow('incomplete target');
    await expect(service.submitResult(review.id, review.attempts[0].id, resultInput({ assessment: { decision: 'return', note: '退回' }, metrics: [{ key: 'orders', value: 100, periodStart: '2026-11-26T16:00:00Z', periodEnd: '2026-11-27T16:00:00Z', basis: '伪造补齐', source: resultInput().sources[0] }] }))).rejects.toThrow('introduce');
    await service.submitResult(review.id, review.attempts[0].id, resultInput({ assessment: { decision: 'return', note: '补齐可验证的渠道订单后重提' } }));
    const returned = (await service.snapshot()).tasks.find((t) => t.id === target.id)!; expect(returned.status).toBe('draft'); expect(returned.inputs).toContain('补齐可验证');
  });

  const planned = (): HotelPlannedTask[] => [
    { title: '汇总渠道观察', objective: '结合数据形成建议', role: 'revenue', action: 'analysis', inputs: '兴城市', acceptanceCriteria: ['有来源'], dependsOn: [1] },
    { title: '读取运营报表', objective: '读取允许范围的数据', role: 'pms', action: 'read', inputs: '指定经营日', acceptanceCriteria: ['有经营日和口径'], dependsOn: [] },
  ];

  it('atomically expands an owner-confirmed discussion into same-property queued children and preserves its evidence', async () => {
    const parent = await start(taskInput({ role: 'supervisor', action: 'analysis', maxAttempts: 1 }));
    await service.submitResult(parent.id, parent.attempts[0].id, resultInput({ plannedTasks: planned() }));
    const children = await service.expandDelegation(parent.id); expect(children).toHaveLength(2); expect(children[0].dependencies).toEqual([children[1].id]);
    expect(children.every((t) => t.propertyId === PROPERTY && t.parentTaskId === parent.id && t.status === 'queued')).toBe(true);
    expect((await service.expandDelegation(parent.id)).map((t) => t.id)).toEqual(children.map((t) => t.id));
    const after = (await service.snapshot()).tasks.find((t) => t.id === parent.id)!;
    expect(after.status).toBe('queued'); expect(after.result).toBeUndefined(); expect(after.delegation?.result.plannedTasks).toHaveLength(2); expect(after.maxAttempts).toBe(2);
    await expect(service.claimTask(parent.id, { availableAgentIds: ['supervisor-existing'] })).rejects.toThrow('dependencies');
    await expect(service.updateTask(parent.id, { objective: '悄悄换目标' })).rejects.toThrow('immutable');
  });

  it('rejects workers proposing plans, unsafe actions, cyclic plans and invalid dependency references', async () => {
    const worker = await start();
    await expect(service.submitResult(worker.id, worker.attempts[0].id, resultInput({ plannedTasks: planned() }))).rejects.toThrow('Only ordinary supervisor');
    const supervisor = await start(taskInput({ role: 'supervisor', action: 'analysis' })); const id = supervisor.id; const attemptId = supervisor.attempts[0].id;
    await expect(service.submitResult(id, attemptId, resultInput({ plannedTasks: [{ ...planned()[0], action: 'payment' as 'read', dependsOn: [] }] }))).rejects.toThrow('only');
    await expect(service.submitResult(id, attemptId, resultInput({ plannedTasks: [{ ...planned()[0], dependsOn: [1] }, { ...planned()[1], dependsOn: [0] }] }))).rejects.toThrow('cycle');
    await expect(service.submitResult(id, attemptId, resultInput({ plannedTasks: [{ ...planned()[0], dependsOn: [8] }] }))).rejects.toThrow('index');
    expect((await service.snapshot()).tasks).toHaveLength(2);
  });
});

describe('Douyin quality, daily evidence and schedules', () => {
  it('blocks 79-point publication records, requires complete scored drafts, and never allows worker publication flags', async () => {
    const task = await start(taskInput({ role: 'douyin', action: 'analysis' }));
    const content = contentInput(79);
    await expect(service.submitResult(task.id, task.attempts[0].id, resultInput({ content: { ...content, hook: '' } }))).rejects.toThrow('hook');
    await expect(service.submitResult(task.id, task.attempts[0].id, resultInput({ content: { ...content, publication: { url: 'https://example.test/post', recordedAt: clock.toISOString(), recordedBy: 'owner' } } }))).rejects.toThrow('Workers');
    await complete(task, resultInput({ content }));
    await expect(service.recordPublication(task.id, 'https://example.test/post')).rejects.toThrow('80');
    const good = await start(taskInput({ role: 'douyin', action: 'analysis' })); await complete(good, resultInput({ content: contentInput(80) }));
    const recorded = await service.recordPublication(good.id, 'https://example.test/post');
    expect(recorded.result?.content?.publication?.recordedBy).toBe('owner'); expect(recorded.status).toBe('succeeded');
  });

  it('rejects inconsistent score scales and duplicate content titles within a property', async () => {
    const task = await start(taskInput({ role: 'douyin', action: 'analysis' })); const content = contentInput();
    const wrongScores = content.scores.map((s) => ({ ...s, maximum: 100 }));
    await expect(service.submitResult(task.id, task.attempts[0].id, resultInput({ content: { ...content, scores: wrongScores } }))).rejects.toThrow('sum to 100');
    await complete(task, resultInput({ content }));
    const duplicate = await start(taskInput({ role: 'douyin', action: 'analysis' }));
    await expect(service.submitResult(duplicate.id, duplicate.attempts[0].id, resultInput({ content: { ...content, title: ` ${content.title}！` } }))).rejects.toThrow('already used');
  });

  it('calculates ratios only from accepted same-period same-basis metrics and leaves missing values unknown', async () => {
    const task = await start(); const common = { periodStart: '2026-11-26T16:00:00Z', periodEnd: '2026-11-27T16:00:00Z', basis: '北京时间经营日，按间夜、不含退款', source: resultInput().sources[0] };
    const result = resultInput({ metrics: [{ ...common, key: 'availableRooms', value: 20 }, { ...common, key: 'occupiedRooms', value: 10 }, { ...common, key: 'roomRevenue', value: 3000 }] });
    await service.submitResult(task.id, task.attempts[0].id, result);
    expect((await service.report(PROPERTY, '2026-11-27')).occupancyRate).toBeNull();
    await service.reviewTask(task.id, { actor: 'owner', decision: 'accept', note: '口径和来源已核对' });
    const report = await service.report(PROPERTY, '2026-11-27'); expect(report.occupancyRate).toBe(0.5); expect(report.averageDailyRate).toBe(300); expect(report.revenuePerAvailableRoom).toBe(150); expect(report.metrics.orders).toBeNull();
    expect((await service.report(PROPERTY, '2026-11-26')).metrics.roomRevenue).toBeNull();
  });

  it('retains immutable knowledge revisions and validates references', async () => {
    const first = await service.saveKnowledge({ propertyId: PROPERTY, title: '服务制度', category: 'policy', content: '第一版', source: '老板确认' });
    const second = await service.saveKnowledge({ id: first.id, propertyId: PROPERTY, title: '服务制度', category: 'policy', content: '第二版', source: '老板更新' });
    expect(second.revisions.map((r) => r.content)).toEqual(['第一版', '第二版']);
    expect((await service.createTask(taskInput({ knowledgeIds: [first.id] }))).knowledgeIds).toEqual([first.id]);
  });

  it('does not label partial-day observations as full-day operating metrics', async () => {
    const task = await start();
    await complete(task, resultInput({ metrics: [{ key: 'orders', value: 4, periodStart: '2026-11-27T01:00:00Z', periodEnd: '2026-11-27T02:00:00Z', basis: '一小时订单', source: resultInput().sources[0] }] }));
    const report = await service.report(PROPERTY, '2026-11-27'); expect(report.metrics.orders).toBeNull(); expect(report.warnings.join('\n')).toContain('部分时段');
    await expect(service.report(PROPERTY, '2026-02-30')).rejects.toThrow('valid');
  });

  it('keeps schedules disabled by default, uses local-day slots and deduplicates across restart', async () => {
    const template = { title: '只读日报', objective: '读取允许的数据并报告', role: 'pms' as const, action: 'read' as const, acceptanceCriteria: ['来源和时间'] };
    const schedule = await service.saveSchedule({ propertyId: PROPERTY, name: '每日九点', frequency: 'daily', time: '09:00', timezone: 'Asia/Shanghai', weekdays: [], intervalMinutes: 60, template });
    expect(schedule.enabled).toBe(false); expect(await service.tickSchedules()).toHaveLength(0);
    await service.saveSchedule({ ...schedule, enabled: true });
    expect(await service.tickSchedules()).toHaveLength(1); expect(await service.tickSchedules()).toHaveLength(0);
    service = new HotelService(store, { now: () => clock, id: () => `id-${++counter}` }); expect(await service.tickSchedules()).toHaveLength(0);
    clock = new Date('2026-11-29T01:05:00Z'); const caughtUp = await service.tickSchedules();
    expect(caughtUp).toHaveLength(1); expect(caughtUp[0].scheduleSlot).toBe('2026-11-29:09:00');
    expect((await service.snapshot()).tasks).toHaveLength(2);
    await expect(service.saveSchedule({ ...schedule, template: { ...template, action: 'payment' } })).rejects.toThrow('Production writes');
  });

  it('honors weekly day selection and interval buckets', () => {
    const schedule = { frequency: 'weekly', time: '09:00', timezone: 'Asia/Shanghai', weekdays: [5], intervalMinutes: 30 } as HotelSchedule;
    expect(scheduleSlot(schedule, new Date('2026-11-27T00:59:00Z'))).toBeNull();
    expect(scheduleSlot(schedule, new Date('2026-11-27T01:01:00Z'))).toBe('2026-11-27:09:00');
    expect(scheduleSlot(schedule, new Date('2026-11-28T01:01:00Z'))).toBeNull();
    expect(scheduleSlot({ ...schedule, frequency: 'interval' }, new Date(60 * 60000))).toBe('interval:2');
  });
});

describe('snapshot storage failure safety', () => {
  it('does not publish a mutation whose durable write failed and serializes concurrent changes', async () => {
    let writes = 0; const backing = new MemoryHotelStore();
    const flaky: HotelSnapshotStore = { load: () => backing.load(), save: async (snapshot: HotelSnapshot) => { if (++writes === 1) throw new Error('disk full'); await backing.save(snapshot); } };
    const instance = new HotelService(flaky);
    await expect(instance.createTask(taskInput())).rejects.toThrow('disk full'); expect((await instance.snapshot()).tasks).toHaveLength(0);
    await Promise.all([instance.createTask(taskInput()), instance.createTask(taskInput())]);
    expect((await instance.snapshot()).tasks).toHaveLength(2); expect((await backing.load())?.tasks).toHaveLength(2);
  });

  it('writes a complete recoverable file and refuses to silently reset corrupt data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hotel-store-test-')); const file = join(directory, 'state.json');
    try {
      const fileStore = new FileHotelStore(file); const instance = new HotelService(fileStore);
      await instance.createTask(taskInput()); const text = await readFile(file, 'utf8'); expect(JSON.parse(text).tasks).toHaveLength(1);
      expect((await new HotelService(new FileHotelStore(file)).snapshot()).tasks).toHaveLength(1);
      await writeFile(file, '{truncated', 'utf8'); await expect(new HotelService(new FileHotelStore(file)).snapshot()).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe('{truncated');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
