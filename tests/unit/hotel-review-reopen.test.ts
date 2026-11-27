// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HotelService } from '../../electron/services/hotel/domain';
import { buildHotelBrief } from '../../electron/services/hotel/gateway-payload';
import { MemoryHotelStore } from '../../electron/services/hotel/store';
import type { HotelTask, HotelTaskResult } from '../../shared/hotel';

const propertyId = 'xingcheng-aigong';
const request = { actor: 'owner' as const, propertyId, reason: 'Protocol guidance repaired; preserve prior failures' };
const evidence: HotelTaskResult = { summary: 'Synthetic source checked', completedItems: ['Read fixture'], missingItems: ['Required field is absent'], sources: [{ label: 'Fixture', uri: 'fixture://source', observedAt: '2026-11-27T10:00:00Z' }], artifacts: [], dataPeriod: 'Synthetic period', verificationNotes: 'No business facts', suggestedNextActions: [] };
async function harness(failures = 3) {
  const store = new MemoryHotelStore();
  const service = new HotelService(store);
  await service.setBinding({ propertyId, role: 'pms', agentId: 'worker', enabled: true, notes: '' });
  await service.setBinding({ propertyId, role: 'supervisor', agentId: 'reviewer', enabled: true, notes: '' });
  const target = await service.createTask({ propertyId, role: 'pms', action: 'read', title: 'Synthetic', objective: 'Read fixture', acceptanceCriteria: ['Required field'], idempotencyKey: 'target' });
  await service.queueTask(target.id);
  const worker = await service.claimTask(target.id, { availableAgentIds: ['worker'] });
  await service.submitResult(target.id, worker.attempts[0].id, evidence);
  const review = await service.createSupervisorReview(target.id);
  for (let i = 0; i < failures; i++) {
    if (i) await service.retryTask(review.id); else await service.queueTask(review.id);
    const running = await service.claimTask(review.id, { availableAgentIds: ['reviewer'] });
    await service.failTask(review.id, running.attempts.at(-1)!.id, 'Invalid acceptance of missing evidence');
  }
  return { store, service, target, review: (await service.snapshot()).tasks.find((task) => task.id === review.id)! };
}
async function startReview(service: HotelService, review: HotelTask) {
  await service.queueTask(review.id);
  return service.claimTask(review.id, { availableAgentIds: ['reviewer'] });
}

describe('explicit bounded reopening of exhausted supervisor reviews', () => {
  it('coalesces concurrent owner requests, preserves every old byte and leaves automatic review on the old key', async () => {
    const h = await harness(); const before = JSON.stringify(h.review);
    const [one, two] = await Promise.all([h.service.reopenSupervisorReview(h.review.id, request), h.service.reopenSupervisorReview(h.review.id, request)]);
    expect(one.id).toBe(two.id); expect(one.id).not.toBe(h.review.id);
    expect(one).toMatchObject({ status: 'draft', maxAttempts: 1, reviewTarget: h.review.reviewTarget, inputs: h.review.inputs, reopenedReview: { reviewTaskId: h.review.id, reason: request.reason } });
    const state = await h.service.snapshot();
    expect(JSON.stringify(state.tasks.find((task) => task.id === h.review.id))).toBe(before);
    expect(state.audit.filter((entry) => entry.action === 'review.reopened')).toHaveLength(1);
    expect((await h.service.createSupervisorReview(h.target.id)).id).toBe(h.review.id);
    expect((await new HotelService(h.store).reopenSupervisorReview(h.review.id, request)).id).toBe(one.id);
    await expect(h.service.reopenSupervisorReview(h.review.id, { ...request, reason: 'changed request' })).rejects.toThrow('Idempotency');
  });
  it.each(['worker', 'bridge', 'system'])('rejects %s even when the review is exhausted', async (actor) => {
    const h = await harness();
    await expect(h.service.reopenSupervisorReview(h.review.id, { ...request, actor: actor as 'owner' })).rejects.toThrow('owner');
  });
  it('rejects wrong property, missing reason and non-review tasks', async () => {
    const h = await harness();
    await expect(h.service.reopenSupervisorReview(h.review.id, { ...request, propertyId: 'other' })).rejects.toThrow('another property');
    await expect(h.service.reopenSupervisorReview(h.review.id, { ...request, reason: '' })).rejects.toThrow('reason');
    await expect(h.service.reopenSupervisorReview(h.target.id, request)).rejects.toThrow('supervisor assessment');
  });
  it.each([0, 1, 2])('does not reopen a review after only %s failures', async (failures) => {
    const h = await harness(failures);
    await expect(h.service.reopenSupervisorReview(h.review.id, request)).rejects.toThrow('exhausted');
  });
  it('rejects stale results and changed supervisor bindings', async () => {
    const h = await harness();
    await h.service.setBinding({ propertyId, role: 'supervisor', agentId: 'worker', enabled: true, notes: '' });
    await expect(h.service.reopenSupervisorReview(h.review.id, request)).rejects.toThrow('binding changed');
    await h.service.setBinding({ propertyId, role: 'supervisor', agentId: 'reviewer', enabled: true, notes: '' });
    const state = await h.service.snapshot(); state.tasks.find((task) => task.id === h.target.id)!.result!.summary = 'Changed';
    await h.store.save(state);
    await expect(new HotelService(h.store).reopenSupervisorReview(h.review.id, request)).rejects.toThrow('stale');
  });
  it('allows only one new attempt and never recursively reopens a replacement', async () => {
    const h = await harness(); const reopened = await h.service.reopenSupervisorReview(h.review.id, request);
    const running = await startReview(h.service, reopened);
    await h.service.failTask(reopened.id, running.attempts[0].id, 'Still invalid');
    await expect(h.service.retryTask(reopened.id)).rejects.toThrow('limit');
    await expect(h.service.reopenSupervisorReview(reopened.id, request)).rejects.toThrow('again');
    expect((await h.service.reopenSupervisorReview(h.review.id, request)).id).toBe(reopened.id);
  });
  it('rejects a preoccupied public idempotency key without promoting the ordinary task into a review', async () => {
    const h = await harness();
    const ordinary = await h.service.createTask({ propertyId, role: 'supervisor', action: 'analysis', title: `重开验收：${h.review.title}`, objective: h.review.objective, inputs: h.review.inputs, acceptanceCriteria: h.review.acceptanceCriteria, idempotencyKey: `supervisor-review-reopen:${h.review.id}`, maxAttempts: 1 });
    const before = await h.service.snapshot();
    await expect(h.service.reopenSupervisorReview(h.review.id, request)).rejects.toThrow('already occupied');
    expect(await h.service.snapshot()).toEqual(before);
    expect(before.tasks.find((task) => task.id === ordinary.id)?.reviewTarget).toBeUndefined();
  });
  it('retains Gateway-only verdict validation and the frozen missing-items gate', async () => {
    const h = await harness(); const running = await startReview(h.service, await h.service.reopenSupervisorReview(h.review.id, request));
    const result = { ...evidence, missingItems: [], assessment: { decision: 'accept' as const, note: 'Wrongly recategorized the target gap' } };
    await expect(h.service.submitResult(running.id, running.attempts[0].id, result, 'owner')).rejects.toThrow('correlated Gateway');
    await expect(h.service.submitResult(running.id, running.attempts[0].id, result)).rejects.toThrow('incomplete target');
    await h.service.submitResult(running.id, running.attempts[0].id, { ...result, assessment: { decision: 'return', note: 'Required field absent in the actual fixture; worker must resubmit' } });
    expect((await h.service.snapshot()).tasks.find((task) => task.id === h.target.id)?.review).toMatchObject({ actor: 'supervisor', decision: 'return', reviewerTaskId: running.id });
    expect((await h.service.reopenSupervisorReview(h.review.id, request)).id).toBe(running.id);
  });
  it('places target-specific immutable constraints after the example without fabricating an assessment', async () => {
    const h = await harness(); const running = await startReview(h.service, await h.service.reopenSupervisorReview(h.review.id, request));
    const snapshot = await h.service.snapshot(); const brief = buildHotelBrief(running, snapshot);
    expect(brief.indexOf('"targetMissingItemsCount": 1')).toBeGreaterThan(brief.indexOf('最后只输出一个JSON对象'));
    expect(brief).toContain('"allowedAssessmentDecisions": [\n    "return"\n  ]');
    expect(brief).toContain('Required field is absent'); expect(brief).toContain('仍返回 blocked');
    expect(brief).toContain('不存在某个旧文件不能证明过去没有读取它');
    snapshot.tasks.find((task) => task.id === h.target.id)!.result!.missingItems = [];
    expect(() => buildHotelBrief(running, snapshot)).toThrow('固定验收目标');
  });
});
