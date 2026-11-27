import type { HotelTask } from '../../../shared/hotel';
import { HOTEL_TASK_TEMPLATES, HotelDomainError, type HotelService } from './domain';

const WORKFLOWS = {
  daily_operations: { title: '酒店经营联合日报', children: ['pms-daily', 'competitors', 'ctrip-review', 'douyin-draft', 'finance-check', 'service-review'] },
  pricing_review: { title: '入住率与定价联合调查', children: ['pms-daily', 'competitors', 'ctrip-review', 'finance-check'] },
  content_review: { title: '抖音选题与制作审核', children: ['service-review', 'douyin-draft'] },
} as const;

type WorkflowInput = {
  propertyId: string; kind: keyof typeof WORKFLOWS; idempotencyKey: string;
};
const pendingWorkflows = new WeakMap<HotelService, Map<string, { fingerprint: string; promise: Promise<HotelTask[]> }>>();

/** Coalesce concurrent retries; durable keys also cover process restarts. */
export function createHotelWorkflow(service: HotelService, input: WorkflowInput): Promise<HotelTask[]> {
  let pending = pendingWorkflows.get(service);
  if (!pending) { pending = new Map(); pendingWorkflows.set(service, pending); }
  const key = JSON.stringify([input.propertyId, input.idempotencyKey]);
  const fingerprint = JSON.stringify([input.propertyId, input.kind, input.idempotencyKey]);
  const active = pending.get(key);
  if (active) {
    if (active.fingerprint !== fingerprint) return Promise.reject(new HotelDomainError('同一个请求标识不能创建不同工作流', 409));
    return active.promise;
  }
  const promise = createWorkflow(service, input).finally(() => pending!.delete(key));
  pending.set(key, { fingerprint, promise });
  return promise;
}

/** Deterministic request keys let an interrupted workflow creation resume without duplicates. */
async function createWorkflow(service: HotelService, input: WorkflowInput): Promise<HotelTask[]> {
  if (!Object.hasOwn(WORKFLOWS, input.kind)) throw new HotelDomainError('未知工作流');
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 180) throw new HotelDomainError('工作流需要有效的 idempotencyKey');
  const workflow = WORKFLOWS[input.kind];
  const parentTemplate = HOTEL_TASK_TEMPLATES.find((item) => item.id === 'daily-review')!;
  const parent = await service.createTask({
    propertyId: input.propertyId, title: workflow.title, role: 'supervisor', action: 'analysis',
    objective: parentTemplate.objective, acceptanceCriteria: parentTemplate.acceptanceCriteria,
    idempotencyKey: `workflow:${input.idempotencyKey}:parent`,
  });
  const existing = (await service.snapshot()).tasks.filter((item) => item.parentTaskId === parent.id);
  // Completed/active workflows remain unchanged on request redelivery.
  if (existing.length === workflow.children.length && parent.status !== 'draft') return [parent, ...existing];
  const children: HotelTask[] = [];
  for (const templateId of workflow.children) {
    const template = HOTEL_TASK_TEMPLATES.find((item) => item.id === templateId)!;
    children.push(await service.createTask({
      propertyId: input.propertyId, title: template.title, role: template.role, action: template.action,
      objective: template.objective, acceptanceCriteria: template.acceptanceCriteria,
      parentTaskId: parent.id, idempotencyKey: `workflow:${input.idempotencyKey}:${template.id}`,
    }));
  }
  // Only the supervisor depends on all returned and accepted child results.
  const linked = await service.updateTask(parent.id, { dependencies: children.map((item) => item.id) });
  const queued: HotelTask[] = [];
  for (const child of children) queued.push(child.status === 'draft' ? await service.queueTask(child.id) : child);
  return [linked.status === 'draft' ? await service.queueTask(linked.id) : linked, ...queued];
}
