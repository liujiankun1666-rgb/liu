import { createHash, randomUUID } from 'node:crypto';
import {
  HOTEL_ACTIONS, HOTEL_ROLES,
  type CreateHotelTaskInput, type HotelAction, type HotelApproval, type HotelArtifact,
  type HotelAttempt, type HotelBinding, type HotelContent, type HotelKnowledge, type HotelMetric,
  type HotelMetricKey, type HotelPlan, type HotelPlannedTask, type HotelProperty, type HotelReport, type HotelReview,
  type HotelSchedule, type HotelSnapshot, type HotelSource, type HotelTask,
  type HotelTaskResult, type HotelTaskTemplate, type SaveHotelKnowledgeInput,
  type SaveHotelScheduleInput, type UpdateHotelTaskInput,
} from '../../../shared/hotel';
import type { HotelSnapshotStore } from './store';

export class HotelDomainError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); this.name = 'HotelDomainError'; }
}
export const SENSITIVE_HOTEL_ACTIONS = new Set<HotelAction>(['price_change', 'publish', 'payment', 'refund', 'message', 'config_change']);
const CLOSED = new Set(['succeeded', 'cancelled']);
const METRIC_KEYS: HotelMetricKey[] = ['availableRooms', 'occupiedRooms', 'roomRevenue', 'orders', 'refunds', 'costs'];
const CONTENT_TOPICS = ['hotel', 'games', 'hardware', 'service'];
const MAX_TASKS = 20000;
const MAX_PLAN_REVISIONS = 500;

function required(value: unknown, label: string, maximum = 10000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new HotelDomainError(`${label} is required (max ${maximum} characters)`);
  return value.trim();
}
function optional(value: unknown, label: string, maximum = 20000): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maximum) throw new HotelDomainError(`Invalid ${label}`);
  return value.trim();
}
function strings(value: unknown, label: string, mandatory = false): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new HotelDomainError(`Invalid ${label}`);
  const out = value.map((item) => required(item, label, 5000));
  if (mandatory && !out.length) throw new HotelDomainError(`${label} must not be empty`);
  return out;
}
function timestamp(value: unknown, label: string): string {
  const text = required(value, label, 100);
  if (!Number.isFinite(Date.parse(text))) throw new HotelDomainError(`Invalid ${label}`);
  return new Date(text).toISOString();
}
function timezone(value: unknown): string {
  const text = required(value, 'timezone', 100);
  try { new Intl.DateTimeFormat('en', { timeZone: text }).format(); }
  catch { throw new HotelDomainError('Invalid timezone'); }
  return text;
}
function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new HotelDomainError(`Invalid ${label}`);
  return value;
}
function validUri(value: unknown): string {
  const text = required(value, 'source or artifact URI', 4000);
  if (/^(javascript|data|vbscript):/i.test(text)) throw new HotelDomainError('Unsafe source or artifact URI');
  return text;
}
function source(value: HotelSource): HotelSource {
  if (!value || typeof value !== 'object') throw new HotelDomainError('Invalid source');
  return { label: required(value.label, 'source label', 500), uri: validUri(value.uri), observedAt: timestamp(value.observedAt, 'source observedAt') };
}
function artifact(value: HotelArtifact): HotelArtifact {
  if (!value || typeof value !== 'object') throw new HotelDomainError('Invalid artifact');
  return { label: required(value.label, 'artifact label', 500), uri: validUri(value.uri) };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export function hotelPlanHash(task: Pick<HotelTask, 'propertyId' | 'action' | 'planVersion' | 'plan' | 'objective'>): string {
  return createHash('sha256').update(JSON.stringify(canonical({ propertyId: task.propertyId, action: task.action, planVersion: task.planVersion, plan: task.plan, objective: task.objective }))).digest('hex');
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export function hotelResultHash(result: HotelTaskResult): string { return hash(result); }
function validatePlan(value?: HotelPlan): HotelPlan | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new HotelDomainError('Invalid execution plan');
  return {
    target: required(value.target, 'plan target'), before: required(value.before, 'plan before'),
    after: required(value.after, 'plan after'), reason: required(value.reason, 'plan reason'), rollback: required(value.rollback, 'plan rollback'),
  };
}
function requireOwner(actor: unknown): void {
  if (actor !== 'owner') throw new HotelDomainError('Only the owner may approve or review a task', 403);
}

export const HOTEL_TASK_TEMPLATES: HotelTaskTemplate[] = [
  { id: 'daily-review', title: '每日经营复盘', role: 'supervisor', action: 'analysis', objective: '汇总已验收的酒店运营、渠道、竞对、营销、财务与客服结果，讨论原因、替代方案和下一步；明确缺失数据，不把推测当事实。', acceptanceCriteria: ['注明门店、北京时间经营日期、统计口径及来源', '列出真实指标、待核实异常、待审批事项与负责人', '对子任务缺失或失败明确说明，不编造数据'] },
  { id: 'pms-daily', title: '别样红房态与营收', role: 'pms', action: 'read', objective: '只读检查别样红当前登录和允许读取的数据，汇总指定经营日的可售房、已售房、房费收入及订单；遇验证码、授权不足或登录失效立即报告。', acceptanceCriteria: ['每项数据附来源、采集时间、经营日和口径', '入住率、ADR、RevPAR 仅在分子分母口径一致时计算', '不修改房态、订单、价格或账户配置'] },
  { id: 'competitors', title: '本店城市竞对与定价建议', role: 'revenue', action: 'read', objective: '按本任务门店资料指定的城市研究电竞酒店竞对；默认门店兴城爱攻位于辽宁省兴城市。仅排除本任务门店自身，比较相同入住日、房型、人数、退改条件的可订价并提出有依据的定价方案。', acceptanceCriteria: ['记录城市、酒店、平台、入住日、房型、人数、退改条件、含税价格和采集时间', '候选酒店与已验证可订价分开标明', '只提供方案，调价另走具体计划审批'] },
  { id: 'ctrip-review', title: '携程流量与转化分析', role: 'ctrip', action: 'read', objective: '只读核查携程已有权限内的曝光、访问、订单、转化及评价，分析真实变化并给出可验证建议。', acceptanceCriteria: ['说明指标定义、时间范围、可比基期和来源', '权限不足与缺失数据明确标注', '不改价、不回复客人、不改活动或投放'] },
  { id: 'douyin-draft', title: '抖音短视频制作方案', role: 'douyin', action: 'analysis', objective: '轮换酒店经营、游戏、电脑配置外设、酒店服务四类主题；参考已用选题避免重复，复用已验收模板，生成供审核的 30–60 秒、9:16 视频方案。', acceptanceCriteria: ['提交标题、开场钩子、脚本、分镜、字幕、封面方案和发布文案', '给出总分 100 的分项质量评分、理由及优化建议', '低于 80 分须优化，不得标记已发布；本流程不自动发布'] },
  { id: 'finance-check', title: '营收与差异核对', role: 'finance', action: 'read', objective: '核对指定经营日的 PMS、渠道结算与前台日报，列明到账、应收、退款、费用与差异；保留未确认事项，不推定损失。', acceptanceCriteria: ['经营收入、现金流、结算与利润口径分开', '每条差异附来源与核查路径', '不付款、不退款、不修改账单'] },
  { id: 'service-review', title: '评价投诉与服务改进', role: 'service', action: 'read', objective: '整理有权限读取的评价、投诉及服务事项，标记紧急程度、负责人、处理状态，起草回复供审核。', acceptanceCriteria: ['说明来源、日期、事实和待确认部分，避免记录无必要的客人隐私', '回复作为草稿，正式发送另行审批', '提出可跟踪的处理步骤和复盘标准'] },
  { id: 'technical-fix', title: '技术排障与自动化维护', role: 'codex', action: 'code', objective: '在隔离开发分支或测试环境定位问题并修复；复用现有代码和 Agent，返回修改位置、验证命令及剩余限制，不部署到生产。', acceptanceCriteria: ['说明复现条件、根因、修改范围、代码位置', '提供针对风险的验证证据及失败项', '不包含密钥或客资，不改生产系统，合并与部署单独审批'] },
];

export function createInitialHotelSnapshot(now = new Date().toISOString()): HotelSnapshot {
  return {
    schemaVersion: 1, revision: 0,
    properties: [{ id: 'xingcheng-aigong', name: '兴城爱攻电竞酒店', city: '兴城市', timezone: 'Asia/Shanghai', createdAt: now }],
    bindings: HOTEL_ROLES.map((role) => ({ propertyId: 'xingcheng-aigong', role, agentId: null, enabled: false, notes: '', updatedAt: now })),
    tasks: [], knowledge: [], schedules: [], audit: [],
  };
}

export class HotelService {
  private chain: Promise<unknown> = Promise.resolve();
  private value: HotelSnapshot | undefined;
  private readonly now: () => Date;
  private readonly id: () => string;
  constructor(private readonly store: HotelSnapshotStore, options: { now?: () => Date; id?: () => string } = {}) {
    this.now = options.now ?? (() => new Date()); this.id = options.id ?? randomUUID;
  }
  private stamp(): string { return this.now().toISOString(); }
  private async load(): Promise<HotelSnapshot> {
    if (!this.value) {
      this.value = (await this.store.load()) ?? createInitialHotelSnapshot(this.stamp());
    }
    return this.value;
  }
  private transaction<T>(run: (state: HotelSnapshot) => T): Promise<T> {
    const next = this.chain.then(async () => {
      const current = await this.load();
      const state = structuredClone(current);
      const result = run(state);
      // Timer ticks and duplicate requests should not rewrite the full ledger.
      if (JSON.stringify(state) === JSON.stringify(current)) return structuredClone(result);
      state.revision += 1;
      await this.store.save(state);
      this.value = state;
      return structuredClone(result);
    });
    this.chain = next.catch(() => undefined);
    return next;
  }
  async snapshot(): Promise<HotelSnapshot> { await this.chain; return structuredClone(await this.load()); }
  private property(state: HotelSnapshot, id: string): HotelProperty {
    const found = state.properties.find((p) => p.id === id);
    if (!found) throw new HotelDomainError('Unknown hotel property', 404);
    return found;
  }
  private task(state: HotelSnapshot, id: string): HotelTask {
    const found = state.tasks.find((t) => t.id === id);
    if (!found) throw new HotelDomainError('Unknown hotel task', 404);
    return found;
  }
  private audit(state: HotelSnapshot, propertyId: string, action: string, detail: string, taskId?: string, actor = 'owner'): void {
    state.audit.push({ id: this.id(), propertyId, taskId, action, detail, actor, at: this.stamp() });
  }
  private touch(task: HotelTask): void { task.updatedAt = this.stamp(); }
  private archivePlan(task: HotelTask): void {
    this.preserveCurrentResult(task);
    const history = task.planHistory ??= [];
    if (history.length >= MAX_PLAN_REVISIONS) throw new HotelDomainError('Plan history capacity reached; create a follow-up task. Existing history has not been deleted', 409);
    history.push(structuredClone({
      planVersion: task.planVersion, recordedAt: this.stamp(), title: task.title, objective: task.objective,
      role: task.role, action: task.action, inputs: task.inputs, acceptanceCriteria: task.acceptanceCriteria,
      dependencies: task.dependencies, knowledgeIds: task.knowledgeIds, plan: task.plan, approval: task.approval,
    }));
  }
  private archiveResult(task: HotelTask, attemptId: string): void {
    if (!task.result) return;
    (task.resultHistory ??= []).push({ attemptId, recordedAt: this.stamp(), origin: task.resultOrigin ?? 'gateway', result: structuredClone(task.result), review: task.review ? structuredClone(task.review) : undefined });
  }
  private preserveCurrentResult(task: HotelTask): void {
    const attemptId = task.attempts.at(-1)?.id;
    if (task.result && attemptId && !task.resultHistory?.some((item) => item.attemptId === attemptId)) this.archiveResult(task, attemptId);
  }
  private archiveReview(task: HotelTask): void {
    const attemptId = task.attempts.at(-1)?.id;
    const entry = [...(task.resultHistory ?? [])].reverse().find((item) => item.attemptId === attemptId);
    if (entry && task.review) entry.review = structuredClone(task.review);
  }
  private dependencies(state: HotelSnapshot, task: HotelTask): void {
    const visit = (id: string, seen: Set<string>): void => {
      if (id === task.id) throw new HotelDomainError('Task dependency cycle is not allowed');
      if (seen.has(id)) return;
      seen.add(id);
      const dependency = this.task(state, id);
      if (dependency.propertyId !== task.propertyId) throw new HotelDomainError('Cross-property dependencies are not allowed');
      // A parent also waits on every child, even without explicit dependency ids.
      const implicitChildren = state.tasks.filter((t) => t.parentTaskId === id).map((t) => t.id);
      if (task.parentTaskId === id) implicitChildren.push(task.id);
      for (const next of [...dependency.dependencies, ...implicitChildren]) visit(next, seen);
    };
    for (const id of task.dependencies) visit(id, new Set());
    for (const id of task.knowledgeIds) {
      const entry = state.knowledge.find((k) => k.id === id);
      if (!entry || entry.propertyId !== task.propertyId) throw new HotelDomainError('Knowledge must belong to this property');
    }
  }
  private incomplete(state: HotelSnapshot, task: HotelTask): string[] {
    const ids = new Set([...task.dependencies, ...state.tasks.filter((t) => t.parentTaskId === task.id).map((t) => t.id)]);
    return [...ids].filter((id) => this.task(state, id).status !== 'succeeded');
  }
  private activeAttempt(task: HotelTask, attemptId: string): HotelAttempt {
    const attempt = task.attempts.at(-1);
    if (!attempt || attempt.id !== attemptId || task.status !== 'running') throw new HotelDomainError('Stale or inactive task attempt', 409);
    return attempt;
  }
  private reviewTarget(state: HotelSnapshot, review: HotelTask, reviewerAgentId: string): HotelTask {
    const reference = review.reviewTarget;
    if (!reference || review.role !== 'supervisor' || review.action !== 'analysis') throw new HotelDomainError('Not a supervisor review task', 409);
    const target = this.task(state, reference.taskId);
    const binding = state.bindings.find((b) => b.propertyId === review.propertyId && b.role === 'supervisor');
    if (!binding?.enabled || binding.agentId !== reviewerAgentId || reference.reviewerAgentId !== reviewerAgentId) throw new HotelDomainError('Supervisor binding changed; create a new review for the current supervisor', 409);
    if (target.propertyId !== review.propertyId || target.reviewTarget || target.assignedAgentId === reviewerAgentId) throw new HotelDomainError('Supervisor cannot review its own work or another review task', 409);
    if (target.status !== 'needs_review' || !target.result || target.attempts.at(-1)?.id !== reference.attemptId || hash(target.result) !== reference.resultHash) throw new HotelDomainError('The target result changed or was already reviewed; this assessment is stale', 409);
    return target;
  }

  saveProperty(input: { id?: string; name: string; city: string; timezone: string }): Promise<HotelProperty> {
    return this.transaction((state) => {
      const id = input.id ?? this.id();
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(id)) throw new HotelDomainError('Invalid property id');
      const existing = state.properties.find((p) => p.id === id);
      const value: HotelProperty = { id, name: required(input.name, 'property name', 200), city: required(input.city, 'city', 200), timezone: timezone(input.timezone), createdAt: existing?.createdAt ?? this.stamp() };
      if (existing) Object.assign(existing, value);
      else {
        state.properties.push(value);
        state.bindings.push(...HOTEL_ROLES.map((role) => ({ propertyId: id, role, agentId: null, enabled: false, notes: '', updatedAt: this.stamp() })));
      }
      this.audit(state, id, 'property.saved', 'Property settings saved');
      return value;
    });
  }
  setBinding(input: Omit<HotelBinding, 'updatedAt'>): Promise<HotelBinding> {
    return this.transaction((state) => {
      this.property(state, input.propertyId);
      if (!HOTEL_ROLES.includes(input.role)) throw new HotelDomainError('Invalid role');
      if (typeof input.enabled !== 'boolean') throw new HotelDomainError('Invalid binding enabled flag');
      const agentId = input.agentId === null ? null : required(input.agentId, 'agentId', 200);
      if (agentId !== null && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(agentId)) throw new HotelDomainError('Invalid agentId');
      if (input.enabled && !agentId) throw new HotelDomainError('Bind an existing Agent before enabling the role');
      const binding: HotelBinding = { propertyId: input.propertyId, role: input.role, agentId, enabled: input.enabled, notes: optional(input.notes, 'binding notes'), updatedAt: this.stamp() };
      const index = state.bindings.findIndex((b) => b.propertyId === binding.propertyId && b.role === binding.role);
      if (index < 0) state.bindings.push(binding); else state.bindings[index] = binding;
      this.audit(state, binding.propertyId, 'binding.saved', `${binding.role}: ${binding.agentId ?? 'unbound'}; enabled=${binding.enabled}`);
      return binding;
    });
  }
  private newTask(state: HotelSnapshot, input: CreateHotelTaskInput, actor = 'owner'): HotelTask {
    this.property(state, input.propertyId);
    const key = required(input.idempotencyKey, 'idempotencyKey', 300);
    const requestHash = hash(input);
    const existing = state.tasks.find((t) => t.propertyId === input.propertyId && t.idempotencyKey === key);
    if (existing) {
      if (existing.requestHash !== requestHash) throw new HotelDomainError('Idempotency key was already used for different task content', 409);
      return existing;
    }
    if (state.tasks.length >= MAX_TASKS) throw new HotelDomainError('Task capacity reached; export and archive before adding tasks', 409);
    if (!HOTEL_ROLES.includes(input.role)) throw new HotelDomainError('Invalid role');
    const action = input.action ?? 'analysis';
    if (!HOTEL_ACTIONS.includes(action)) throw new HotelDomainError('Invalid task action');
    if (action === 'code' && input.role !== 'codex') throw new HotelDomainError('Code tasks must be assigned to the Codex role');
    const priority = input.priority ?? 'normal';
    if (!['normal', 'high', 'urgent'].includes(priority)) throw new HotelDomainError('Invalid priority');
    const parentTaskId = input.parentTaskId || undefined;
    if (parentTaskId) {
      let parent = this.task(state, parentTaskId);
      if (parent.propertyId !== input.propertyId) throw new HotelDomainError('Parent task belongs to another property');
      if (parent.reviewTarget) throw new HotelDomainError('Immutable supervisor review tasks cannot receive child tasks', 409);
      if (actor === 'bridge' && (parent.status !== 'draft' || parent.delegation)) throw new HotelDomainError('Bridge proposals may only attach to an unexpanded draft parent', 403);
      if (CLOSED.has(parent.status) || ['running', 'needs_review'].includes(parent.status)) throw new HotelDomainError('Cannot add children to a closed, running or returned parent', 409);
      if (state.tasks.filter((t) => t.parentTaskId === parentTaskId).length >= 64) throw new HotelDomainError('Parent task has too many children');
      let depth = 1;
      while (parent.parentTaskId) { parent = this.task(state, parent.parentTaskId); if (++depth >= 8) throw new HotelDomainError('Maximum delegation depth exceeded'); }
    }
    const now = this.stamp();
    const task: HotelTask = {
      id: this.id(), propertyId: input.propertyId, title: required(input.title, 'title', 300), objective: required(input.objective, 'objective', 30000), role: input.role, action, priority,
      status: 'draft', parentTaskId, dependencies: [...new Set(strings(input.dependencies ?? [], 'dependencies'))],
      inputs: optional(input.inputs, 'inputs', 60000), acceptanceCriteria: strings(input.acceptanceCriteria, 'acceptance criteria', true),
      knowledgeIds: [...new Set(strings(input.knowledgeIds ?? [], 'knowledge ids'))], idempotencyKey: key, requestHash,
      planVersion: 1, plan: validatePlan(input.plan), attempts: [], maxAttempts: integer(input.maxAttempts ?? 3, 'maxAttempts', 1, 5),
      deadline: input.deadline ? timestamp(input.deadline, 'deadline') : undefined, createdAt: now, updatedAt: now,
    };
    this.dependencies(state, task);
    state.tasks.push(task); this.audit(state, task.propertyId, 'task.created', task.title, task.id, actor);
    return task;
  }
  createTask(input: CreateHotelTaskInput, actor = 'owner'): Promise<HotelTask> { return this.transaction((state) => this.newTask(state, input, actor)); }
  updateTask(id: string, input: UpdateHotelTaskInput): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id);
      if (CLOSED.has(task.status) || task.status === 'running') throw new HotelDomainError('Cannot edit a closed or running task', 409);
      if (task.reviewTarget) throw new HotelDomainError('Supervisor review briefs are immutable; create a fresh review if the target changes', 409);
      if (task.delegation) throw new HotelDomainError('An expanded delegation is immutable; create a follow-up task to change its scope', 409);
      this.archivePlan(task);
      if (input.title !== undefined) task.title = required(input.title, 'title', 300);
      if (input.objective !== undefined) task.objective = required(input.objective, 'objective', 30000);
      if (input.role !== undefined) { if (!HOTEL_ROLES.includes(input.role)) throw new HotelDomainError('Invalid role'); task.role = input.role; }
      if (input.action !== undefined) { if (!HOTEL_ACTIONS.includes(input.action)) throw new HotelDomainError('Invalid action'); task.action = input.action; }
      if (task.action === 'code' && task.role !== 'codex') throw new HotelDomainError('Code tasks require Codex role');
      if (input.priority !== undefined) { if (!['normal', 'high', 'urgent'].includes(input.priority)) throw new HotelDomainError('Invalid priority'); task.priority = input.priority; }
      if (input.inputs !== undefined) task.inputs = optional(input.inputs, 'inputs', 60000);
      if (input.acceptanceCriteria !== undefined) task.acceptanceCriteria = strings(input.acceptanceCriteria, 'acceptance criteria', true);
      if (input.dependencies !== undefined) task.dependencies = [...new Set(strings(input.dependencies, 'dependencies'))];
      if (input.knowledgeIds !== undefined) task.knowledgeIds = [...new Set(strings(input.knowledgeIds, 'knowledge ids'))];
      if (input.deadline !== undefined) task.deadline = input.deadline ? timestamp(input.deadline, 'deadline') : undefined;
      if (input.plan !== undefined) task.plan = validatePlan(input.plan);
      this.dependencies(state, task);
      task.planVersion += 1; task.status = 'draft'; delete task.approval; delete task.review; delete task.result; delete task.resultOrigin; delete task.blockedReason;
      this.touch(task); this.audit(state, task.propertyId, 'task.revised', `Plan version ${task.planVersion}; previous approval and result invalidated`, id);
      return task;
    });
  }
  queueTask(id: string, actor: 'owner' | 'bridge' | 'system' = 'owner'): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id);
      if (!['draft', 'queued', 'blocked', 'awaiting_approval'].includes(task.status)) throw new HotelDomainError('Task cannot be queued in its current state', 409);
      if (task.attempts.at(-1)?.outcome === 'uncertain' && !task.attempts.at(-1)?.retryAcknowledgedAt) throw new HotelDomainError('Reconcile the previous uncertain run before retrying', 409);
      if (SENSITIVE_HOTEL_ACTIONS.has(task.action)) {
        if (!task.plan) { task.status = 'blocked'; task.blockedReason = 'Provide a concrete before/after execution plan before requesting approval'; }
        else if (task.approval?.decision === 'reject') { task.status = 'blocked'; task.blockedReason = 'The owner rejected this plan. Revise it before resubmitting'; }
        else if (task.approval?.decision === 'approve' && task.approval.planHash === hotelPlanHash(task)) {
          task.status = 'blocked'; task.blockedReason = 'Approved plan is recorded; the production execution adapter is not connected. No external action was performed';
        } else { task.status = 'awaiting_approval'; delete task.blockedReason; }
      } else { task.status = 'queued'; delete task.blockedReason; }
      this.touch(task); this.audit(state, task.propertyId, 'task.queued', task.status, id, actor);
      return task;
    });
  }
  claimTask(id: string, options: { availableAgentIds: string[]; leaseMs?: number; expectedAgentId?: string; expectedPlanVersion?: number; executor?: 'gateway' | 'codex-cli' }): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id);
      if (task.status !== 'queued') throw new HotelDomainError('Only queued tasks can start', 409);
      if (options.expectedPlanVersion !== undefined && options.expectedPlanVersion !== task.planVersion) throw new HotelDomainError('Task changed after execution policy inspection; inspect the revised task before dispatch', 409);
      if (SENSITIVE_HOTEL_ACTIONS.has(task.action)) throw new HotelDomainError('Production execution adapter is unavailable; approval alone cannot execute business writes', 409);
      if (task.deadline && Date.parse(task.deadline) <= this.now().getTime()) throw new HotelDomainError('Task deadline has passed', 409);
      if (task.attempts.length >= task.maxAttempts) throw new HotelDomainError('Task retry limit reached', 409);
      const pending = this.incomplete(state, task);
      if (pending.length) throw new HotelDomainError(`Waiting for accepted dependencies or child tasks: ${pending.join(', ')}`, 409);
      const binding = state.bindings.find((b) => b.propertyId === task.propertyId && b.role === task.role);
      if (!binding?.enabled || !binding.agentId || !options.availableAgentIds.includes(binding.agentId)) throw new HotelDomainError('Role is not enabled and bound to an available existing Agent', 409);
      if (options.expectedAgentId !== undefined && options.expectedAgentId !== binding.agentId) throw new HotelDomainError('Agent binding changed after execution policy inspection; inspect the new Agent before dispatch', 409);
      if (task.reviewTarget) this.reviewTarget(state, task, binding.agentId);
      if (options.executor === 'codex-cli' && (task.role !== 'codex' || task.action !== 'code' || task.reviewTarget)) throw new HotelDomainError('Native Codex only executes technical code tasks');
      const leaseMs = integer(options.leaseMs ?? 15 * 60 * 1000, 'leaseMs', 1000, 24 * 60 * 60 * 1000);
      this.preserveCurrentResult(task);
      const attemptId = this.id();
      task.attempts.push({ id: attemptId, number: task.attempts.length + 1, executor: options.executor ?? 'gateway', sessionKey: `${options.executor === 'codex-cli' ? 'codex-cli' : 'agent'}:${binding.agentId}:hotel:${task.id}:${attemptId}`, dispatchKey: `hotel:${task.id}:${attemptId}`, startedAt: this.stamp(), leaseExpiresAt: new Date(this.now().getTime() + leaseMs).toISOString() });
      task.assignedAgentId = binding.agentId; task.status = 'running'; delete task.blockedReason; delete task.review; delete task.result; delete task.resultOrigin;
      this.touch(task); this.audit(state, task.propertyId, 'attempt.reserved', `Attempt ${attemptId} persisted before sending`, id, options.executor ?? 'gateway');
      return task;
    });
  }
  markDispatched(id: string, attemptId: string, runId?: string): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id); const attempt = this.activeAttempt(task, attemptId);
      if (runId) {
        if (attempt.runId && attempt.runId !== runId) throw new HotelDomainError('Gateway run id mismatch', 409);
        attempt.runId = required(runId, 'runId', 300);
      }
      this.touch(task); this.audit(state, task.propertyId, 'attempt.acknowledged', attempt.runId ?? 'Executor acknowledged the dispatch', id, attempt.executor ?? 'gateway');
      return task;
    });
  }
  submitResult(id: string, attemptId: string, result: HotelTaskResult, origin: 'gateway' | 'owner' | 'bridge' | 'codex-cli' = 'gateway'): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id); const attempt = this.activeAttempt(task, attemptId);
      if (!['gateway', 'owner', 'bridge', 'codex-cli'].includes(origin)) throw new HotelDomainError('Invalid result origin');
      if (attempt.executor === 'codex-cli' && origin !== 'codex-cli') throw new HotelDomainError('Native technical results only accept the correlated Codex executor receipt', 403);
      if (origin === 'codex-cli' && (attempt.executor !== 'codex-cli' || task.role !== 'codex' || task.action !== 'code')) throw new HotelDomainError('Native result does not match the active technical executor');
      if (task.reviewTarget && origin !== 'gateway') throw new HotelDomainError('Supervisor assessments must originate from the correlated Gateway execution', 403);
      task.result = validateHotelResult(result);
      task.resultOrigin = origin;
      if (task.result.plannedTasks && (task.role !== 'supervisor' || task.reviewTarget)) throw new HotelDomainError('Only ordinary supervisor tasks may propose delegation plans');
      if (task.result.plannedTasks && task.delegation) throw new HotelDomainError('This discussion was already delegated; return the final synthesis instead of another plan');
      if (task.reviewTarget) {
        const target = this.reviewTarget(state, task, task.assignedAgentId!);
        const assessment = task.result.assessment;
        if (!assessment) throw new HotelDomainError('Supervisor review results require an explicit assessment');
        if (task.result.content || task.result.metrics?.length) throw new HotelDomainError('Assessment tasks cannot introduce new operating metrics or content');
        if (task.result.missingItems.length) throw new HotelDomainError('The supervisor review itself is incomplete');
        if (assessment.decision === 'accept') {
          if (target.result!.missingItems.length) throw new HotelDomainError('Supervisor cannot accept an incomplete target result', 409);
          if (this.incomplete(state, target).length) throw new HotelDomainError('Supervisor cannot accept a target with unaccepted dependencies or children', 409);
        }
        target.review = { decision: assessment.decision, actor: 'supervisor', note: assessment.note, reviewedAt: this.stamp(), reviewerTaskId: task.id };
        this.preserveCurrentResult(target);
        this.archiveReview(target);
        target.status = assessment.decision === 'accept' ? 'succeeded' : 'draft';
        if (assessment.decision === 'return') {
          this.archivePlan(target);
          target.inputs = `${target.inputs}\n\n总管验收退回：${assessment.note}`.trim(); target.planVersion += 1; delete target.approval;
        }
        this.touch(target); this.audit(state, target.propertyId, 'task.supervisor_reviewed', `${assessment.decision}: ${assessment.note}`, target.id, task.assignedAgentId);
        this.archiveResult(task, attemptId);
        attempt.endedAt = this.stamp(); attempt.outcome = 'returned'; task.status = 'succeeded'; this.touch(task);
        this.audit(state, task.propertyId, 'review.completed', `Immutable target ${target.id}; hash=${task.reviewTarget.resultHash}`, task.id, 'system');
        return task;
      }
      if (task.result.assessment) throw new HotelDomainError('Assessment is reserved for a server-created supervisor review task');
      if (task.result.content) {
        const normalizedTitle = task.result.content.title.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
        if (state.tasks.some((other) => other.id !== id && other.propertyId === task.propertyId
          && other.result?.content && other.status !== 'cancelled'
          && other.result.content.title.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase() === normalizedTitle)) {
          throw new HotelDomainError('This content title was already used for this property. Choose a new topic or explain a revised title', 409);
        }
      }
      this.archiveResult(task, attemptId);
      attempt.endedAt = this.stamp(); attempt.outcome = 'returned';
      task.status = 'needs_review'; this.touch(task);
      this.audit(state, task.propertyId, 'result.returned', 'Evidence recorded; independent acceptance is still required', id, origin);
      return task;
    });
  }
  failTask(id: string, attemptId: string, error: string, uncertain = false): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id); const attempt = this.activeAttempt(task, attemptId);
      attempt.error = required(error, 'error', 10000); attempt.outcome = uncertain ? 'uncertain' : 'failed'; attempt.endedAt = this.stamp();
      task.status = uncertain ? 'blocked' : 'failed'; task.blockedReason = attempt.error;
      this.touch(task); this.audit(state, task.propertyId, uncertain ? 'attempt.uncertain' : 'attempt.failed', attempt.error, id, attempt.executor ?? 'gateway');
      return task;
    });
  }
  retryTask(id: string, options: { acknowledgeUncertain?: boolean } = {}): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id);
      if (!['failed', 'blocked'].includes(task.status)) throw new HotelDomainError('Only failed or blocked tasks may retry', 409);
      if (SENSITIVE_HOTEL_ACTIONS.has(task.action)) throw new HotelDomainError('Production writes cannot be retried through the Gateway', 409);
      if (task.attempts.length >= task.maxAttempts) throw new HotelDomainError('Task retry limit reached', 409);
      if (task.attempts.at(-1)?.outcome === 'uncertain') {
        if (options.acknowledgeUncertain !== true) throw new HotelDomainError('An uncertain run may still be active. Reconcile it and explicitly acknowledge before retrying', 409);
        task.attempts.at(-1)!.retryAcknowledgedAt = this.stamp();
      }
      task.status = 'queued'; delete task.blockedReason; this.touch(task);
      this.audit(state, task.propertyId, 'task.retry_requested', options.acknowledgeUncertain ? 'Owner acknowledged prior uncertain execution after reconciliation' : 'Explicit retry requested', id);
      return task;
    });
  }
  setWaitingReason(id: string, reason: string): Promise<HotelTask> {
    return this.markWaiting(id, reason);
  }
  markWaiting(id: string, reason: string, blocked = false): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id);
      if (task.status !== 'queued') return task;
      const next = optional(reason, 'waiting reason', 5000);
      if (!blocked && (task.blockedReason === next || (!task.blockedReason && !next))) return task;
      if (next) task.blockedReason = next; else delete task.blockedReason;
      if (blocked) task.status = 'blocked';
      this.touch(task);
      if (blocked) this.audit(state, task.propertyId, 'task.blocked', next, id, 'system');
      // Keep repeated scheduler attempts quiet; transitions retain their usual audit events.
      return task;
    });
  }
  createSupervisorReview(targetTaskId: string): Promise<HotelTask> {
    return this.transaction((state) => {
      const target = this.task(state, targetTaskId);
      if (target.status !== 'needs_review' || !target.result || target.reviewTarget) throw new HotelDomainError('Only a returned business result can receive a supervisor review', 409);
      const attempt = target.attempts.at(-1);
      if (!attempt || attempt.outcome !== 'returned' || !target.assignedAgentId) throw new HotelDomainError('The target has no verifiable completed attempt', 409);
      const binding = state.bindings.find((b) => b.propertyId === target.propertyId && b.role === 'supervisor');
      if (!binding?.enabled || !binding.agentId) throw new HotelDomainError('Enable an existing supervisor Agent before automatic acceptance', 409);
      if (binding.agentId === target.assignedAgentId) throw new HotelDomainError('Supervisor cannot review its own work; use owner acceptance', 409);
      const resultHash = hash(target.result);
      const task = this.newTask(state, {
        propertyId: target.propertyId, role: 'supervisor', action: 'analysis', title: `总管验收：${target.title}`.slice(0, 300), priority: target.priority,
        objective: '独立核查指定任务的结果、来源、统计口径与验收标准。提出明确 accept 或 return 结论和理由；此任务只做质量验收，不批准任何生产写操作。',
        inputs: JSON.stringify({ taskId: target.id, attemptId: attempt.id, resultHash, resultOrigin: target.resultOrigin ?? 'gateway', assignedAgentId: target.assignedAgentId, objective: target.objective, acceptanceCriteria: target.acceptanceCriteria, result: target.result }, null, 2),
        acceptanceCriteria: ['核对每条原任务验收标准与证据，未知或缺失不得判定通过', '返回 assessment: { decision: "accept" 或 "return", note: "具体理由" }，同时提供完整结果证据', '不能自审、修改目标、批准调价、付款、退款、发布或对客发送'],
        idempotencyKey: `supervisor-review:${target.id}:${attempt.id}:${hash({ resultHash, agentId: binding.agentId })}`,
      }, 'system');
      task.reviewTarget = { taskId: target.id, attemptId: attempt.id, resultHash, reviewerAgentId: binding.agentId };
      return task;
    });
  }
  /** Explicit local owner action only. Automatic review repair never calls this method. */
  reopenSupervisorReview(id: string, input: { actor: 'owner'; propertyId: string; reason: string }): Promise<HotelTask> {
    return this.transaction((state) => {
      requireOwner(input.actor);
      const reason = required(input.reason, 'reopen reason', 4000);
      const previous = this.task(state, id);
      if (previous.propertyId !== input.propertyId) throw new HotelDomainError('Review belongs to another property', 403);
      if (!previous.reviewTarget || previous.role !== 'supervisor' || previous.action !== 'analysis') throw new HotelDomainError('Only a supervisor assessment can be reopened', 409);
      if (previous.reopenedReview) throw new HotelDomainError('A reopened review cannot be reopened again', 409);
      if (previous.status !== 'failed' || previous.attempts.length < previous.maxAttempts
        || previous.attempts.some((attempt) => attempt.outcome !== 'failed' || !attempt.endedAt)) {
        throw new HotelDomainError('Only an exhausted review with confirmed failed attempts can be reopened', 409);
      }
      const existing = state.tasks.find((task) => task.reopenedReview?.reviewTaskId === id);
      if (existing) {
        if (existing.reopenedReview?.reason !== reason || existing.propertyId !== previous.propertyId
          || hash(existing.reviewTarget) !== hash(previous.reviewTarget)) throw new HotelDomainError('Idempotency conflict for reopened review', 409);
        return existing;
      }
      const idempotencyKey = `supervisor-review-reopen:${previous.id}`;
      if (state.tasks.some((task) => task.propertyId === previous.propertyId && task.idempotencyKey === idempotencyKey)) {
        throw new HotelDomainError('Reopened review idempotency key is already occupied without its immutable association', 409);
      }
      this.reviewTarget(state, previous, previous.reviewTarget.reviewerAgentId);
      const task = this.newTask(state, {
        propertyId: previous.propertyId, role: 'supervisor', action: 'analysis', priority: previous.priority,
        title: `重开验收：${previous.title}`.slice(0, 300), objective: previous.objective,
        inputs: previous.inputs, acceptanceCriteria: [...previous.acceptanceCriteria],
        idempotencyKey, maxAttempts: 1,
      }, 'owner');
      task.reviewTarget = structuredClone(previous.reviewTarget);
      task.reopenedReview = { reviewTaskId: previous.id, reason, requestedAt: this.stamp() };
      this.audit(state, previous.propertyId, 'review.reopened', `Explicit owner Host request; previous=${id}; frozenResult=${previous.reviewTarget.resultHash}; reason=${reason}`, task.id, 'owner');
      return task;
    });
  }
  expandDelegation(id: string): Promise<HotelTask[]> {
    return this.transaction((state) => {
      const task = this.task(state, id);
      // One expansion per discussion task; repeat clicks and requests return the same group.
      if (task.delegation) return task.delegation.childTaskIds.map((childId) => this.task(state, childId));
      if (task.status !== 'needs_review' || task.role !== 'supervisor' || task.reviewTarget || !task.result?.plannedTasks) throw new HotelDomainError('A returned supervisor discussion with a delegation plan is required', 409);
      if (task.result.missingItems.length) throw new HotelDomainError('Resolve the missing discussion inputs before delegating', 409);
      const attempt = task.attempts.at(-1);
      if (!attempt || attempt.outcome !== 'returned') throw new HotelDomainError('No verified planning attempt to expand', 409);
      if (task.attempts.length >= 5) throw new HotelDomainError('No attempt capacity remains for the final supervisor summary', 409);
      const planned = validateDelegationPlan(task.result.plannedTasks);
      const result = structuredClone(task.result); const resultHash = hash(result);
      this.archivePlan(task);
      task.status = 'draft';
      const children = planned.map((item, index) => this.newTask(state, {
        propertyId: task.propertyId, title: item.title, objective: item.objective, role: item.role, action: item.action,
        inputs: item.inputs, acceptanceCriteria: item.acceptanceCriteria, priority: task.priority, parentTaskId: task.id,
        knowledgeIds: task.knowledgeIds, idempotencyKey: `delegation:${task.id}:${attempt.id}:${index}`,
      }));
      for (let index = 0; index < children.length; index += 1) {
        children[index].dependencies = planned[index].dependsOn.map((position) => children[position].id);
        this.dependencies(state, children[index]); children[index].status = 'queued';
      }
      task.dependencies = [...new Set([...task.dependencies, ...children.map((child) => child.id)])];
      this.dependencies(state, task);
      task.delegation = { attemptId: attempt.id, resultHash, childTaskIds: children.map((child) => child.id), expandedAt: this.stamp(), result };
      task.inputs = `${task.inputs}\n\n老板已确认讨论方案并分派 ${children.length} 项子任务。待这些结果全部验收后，按原目标形成最终汇总；不要再次拆分此任务。原讨论与依据保存在本任务 delegation.result。`.trim();
      task.maxAttempts = Math.max(task.maxAttempts, task.attempts.length + 1);
      task.planVersion += 1; task.status = 'queued'; delete task.result; delete task.resultOrigin; delete task.review; delete task.approval; delete task.blockedReason;
      this.touch(task); this.audit(state, task.propertyId, 'delegation.expanded', `Owner confirmed ${children.length} tasks; planning attempt=${attempt.id}; hash=${resultHash}`, task.id);
      return children;
    });
  }
  reviewTask(id: string, input: Pick<HotelReview, 'decision' | 'actor' | 'note'>): Promise<HotelTask> {
    return this.transaction((state) => {
      requireOwner(input.actor); const task = this.task(state, id);
      if (task.reviewTarget) throw new HotelDomainError('Supervisor assessment tasks close only through their validated result', 409);
      if (task.status !== 'needs_review' || !task.result) throw new HotelDomainError('Task has no returned result to review', 409);
      if (!['accept', 'return'].includes(input.decision)) throw new HotelDomainError('Invalid review decision');
      if (input.decision === 'accept') {
        if (task.result.missingItems.length) throw new HotelDomainError('Incomplete results cannot be accepted; return them for completion', 409);
        if (this.incomplete(state, task).length) throw new HotelDomainError('All dependencies and child tasks must pass acceptance first', 409);
      }
      task.review = { decision: input.decision, actor: 'owner', note: required(input.note, 'review note', 10000), reviewedAt: this.stamp() };
      this.preserveCurrentResult(task);
      this.archiveReview(task);
      task.status = input.decision === 'accept' ? 'succeeded' : 'draft';
      if (input.decision === 'return') { this.archivePlan(task); task.inputs = `${task.inputs}\n\n验收退回：${input.note}`.trim(); task.planVersion += 1; delete task.approval; }
      this.touch(task); this.audit(state, task.propertyId, 'task.reviewed', `${input.decision}: ${input.note}`, id);
      return task;
    });
  }
  approveTask(id: string, input: { decision: HotelApproval['decision']; planVersion: number; planHash?: string; note: string; actor: 'owner' }): Promise<HotelTask> {
    return this.transaction((state) => {
      requireOwner(input.actor); const task = this.task(state, id);
      if (task.status !== 'awaiting_approval' || !SENSITIVE_HOTEL_ACTIONS.has(task.action) || !task.plan) throw new HotelDomainError('No concrete plan is awaiting approval', 409);
      const planHash = hotelPlanHash(task);
      if (input.planVersion !== task.planVersion || (input.planHash && input.planHash !== planHash)) throw new HotelDomainError('Plan changed; review and approve the current version', 409);
      if (!['approve', 'reject'].includes(input.decision)) throw new HotelDomainError('Invalid approval decision');
      task.approval = { decision: input.decision, actor: 'owner', planVersion: task.planVersion, planHash, note: required(input.note, 'approval note', 10000), decidedAt: this.stamp() };
      task.status = 'blocked'; task.blockedReason = input.decision === 'approve'
        ? 'Approved plan is recorded; the production execution adapter is not connected. No external action was performed'
        : 'The owner rejected this plan. Revise it before resubmitting';
      this.touch(task); this.audit(state, task.propertyId, 'plan.decided', `${input.decision}; version=${task.planVersion}; hash=${planHash}`, id);
      return task;
    });
  }
  cancelTask(id: string): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id);
      if (CLOSED.has(task.status)) throw new HotelDomainError('Task is already closed', 409);
      const attempt = task.attempts.at(-1);
      if (attempt && (task.status === 'running' || (task.status === 'blocked' && attempt.outcome === 'uncertain'))) { attempt.outcome = 'cancelled'; attempt.endedAt = this.stamp(); }
      task.status = 'cancelled'; this.touch(task);
      this.audit(state, task.propertyId, 'task.cancelled', 'Task tracking cancelled; runtime abortion must also be attempted by the dispatcher', id);
      return task;
    });
  }
  recoverInterruptedTasks(): Promise<HotelTask[]> {
    return this.transaction((state) => this.markUncertain(state, (task) => task.status === 'running', 'Application restarted during execution. Reconcile the existing Gateway session before retrying'));
  }
  expireLeases(): Promise<HotelTask[]> {
    return this.transaction((state) => this.markUncertain(state, (task) => task.status === 'running' && Date.parse(task.attempts.at(-1)?.leaseExpiresAt ?? '') <= this.now().getTime(), 'Execution lease expired. Inspect the existing Gateway session before retrying'));
  }
  private markUncertain(state: HotelSnapshot, predicate: (task: HotelTask) => boolean, reason: string): HotelTask[] {
    const changed: HotelTask[] = [];
    for (const task of state.tasks.filter(predicate)) {
      const attempt = task.attempts.at(-1);
      if (attempt) { attempt.outcome = 'uncertain'; attempt.error = reason; attempt.endedAt = this.stamp(); }
      task.status = 'blocked'; task.blockedReason = reason; this.touch(task); changed.push(task);
      this.audit(state, task.propertyId, 'attempt.uncertain', reason, task.id, 'system');
    }
    return changed;
  }
  /** Reopen exactly the uncertain attempt for history reconciliation, never dispatch again. */
  resumeForReconciliation(id: string, attemptId: string): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id); const attempt = task.attempts.at(-1);
      if (task.status !== 'blocked' || !attempt || attempt.id !== attemptId || attempt.outcome !== 'uncertain') throw new HotelDomainError('No uncertain attempt to reconcile', 409);
      task.status = 'running'; delete task.blockedReason; delete attempt.outcome; delete attempt.endedAt;
      attempt.leaseExpiresAt = new Date(this.now().getTime() + 60_000).toISOString(); this.touch(task);
      this.audit(state, task.propertyId, 'attempt.reconciling', 'Checking existing session only; no redispatch', id, 'gateway'); return task;
    });
  }
  saveKnowledge(input: SaveHotelKnowledgeInput): Promise<HotelKnowledge> {
    return this.transaction((state) => {
      this.property(state, input.propertyId);
      if (!['property', 'rooms', 'policy', 'metrics', 'decision', 'experience'].includes(input.category)) throw new HotelDomainError('Invalid knowledge category');
      const existing = input.id ? state.knowledge.find((k) => k.id === input.id) : undefined;
      if (input.id && !existing) throw new HotelDomainError('Unknown knowledge entry', 404);
      if (existing && existing.propertyId !== input.propertyId) throw new HotelDomainError('Knowledge belongs to another property');
      const entry: HotelKnowledge = existing ?? { id: this.id(), propertyId: input.propertyId, title: '', category: input.category, revisions: [] };
      entry.title = required(input.title, 'knowledge title', 300); entry.category = input.category;
      entry.revisions.push({ version: entry.revisions.length + 1, content: required(input.content, 'knowledge content', 100000), source: required(input.source, 'knowledge source', 4000), updatedAt: this.stamp() });
      if (!existing) state.knowledge.push(entry);
      this.audit(state, input.propertyId, 'knowledge.saved', `${entry.title}; version=${entry.revisions.length}`);
      return entry;
    });
  }
  saveSchedule(input: SaveHotelScheduleInput): Promise<HotelSchedule> {
    return this.transaction((state) => {
      this.property(state, input.propertyId);
      const previous = input.id ? state.schedules.find((s) => s.id === input.id) : undefined;
      if (input.id && !previous) throw new HotelDomainError('Unknown schedule', 404);
      if (previous && previous.propertyId !== input.propertyId) throw new HotelDomainError('Schedule belongs to another property');
      if (!['daily', 'weekly', 'interval'].includes(input.frequency)) throw new HotelDomainError('Invalid schedule frequency');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new HotelDomainError('Schedule time must be HH:mm');
      const days = [...new Set(input.weekdays ?? [])].map((d) => integer(d, 'weekday', 0, 6));
      if (input.frequency === 'weekly' && !days.length) throw new HotelDomainError('Weekly schedules need at least one weekday');
      const intervalMinutes = integer(input.intervalMinutes ?? 60, 'intervalMinutes', 5, 7 * 24 * 60);
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new HotelDomainError('Invalid schedule enabled flag');
      if (!input.template || typeof input.template !== 'object') throw new HotelDomainError('Missing schedule task template');
      if (SENSITIVE_HOTEL_ACTIONS.has(input.template.action ?? 'analysis')) throw new HotelDomainError('Production writes must not be scheduled automatically');
      // Validate using a throwaway copy; no task or audit is added to the real state.
      this.newTask(structuredClone(state), { ...input.template, propertyId: input.propertyId, idempotencyKey: `schedule-validation:${this.id()}` }, 'scheduler');
      const value: HotelSchedule = {
        id: previous?.id ?? this.id(), propertyId: input.propertyId, name: required(input.name, 'schedule name', 300), enabled: input.enabled ?? previous?.enabled ?? false,
        frequency: input.frequency, time: input.time, timezone: timezone(input.timezone), weekdays: days, intervalMinutes,
        template: structuredClone(input.template), lastSlot: previous?.lastSlot, lastTaskId: previous?.lastTaskId, updatedAt: this.stamp(),
      };
      const index = state.schedules.findIndex((s) => s.id === value.id);
      if (index < 0) state.schedules.push(value); else state.schedules[index] = value;
      this.audit(state, input.propertyId, 'schedule.saved', `${value.name}; enabled=${value.enabled}`);
      return value;
    });
  }
  tickSchedules(): Promise<HotelTask[]> {
    return this.transaction((state) => {
      const created: HotelTask[] = [];
      for (const schedule of state.schedules.filter((s) => s.enabled)) {
        const slot = scheduleSlot(schedule, this.now());
        if (!slot || slot === schedule.lastSlot) continue;
        try {
          const task = this.newTask(state, { ...schedule.template, propertyId: schedule.propertyId, idempotencyKey: `schedule:${schedule.id}:${slot}` }, 'scheduler');
          task.scheduleId = schedule.id; task.scheduleSlot = slot; task.status = 'queued';
          schedule.lastSlot = slot; schedule.lastTaskId = task.id; delete schedule.lastError; schedule.updatedAt = this.stamp(); created.push(task);
        } catch (error) {
          schedule.lastError = String(error); schedule.updatedAt = this.stamp();
          this.audit(state, schedule.propertyId, 'schedule.failed', `${schedule.name}: ${String(error)}`, undefined, 'scheduler');
        }
      }
      return created;
    });
  }
  createTechnicalTask(id: string): Promise<HotelTask> {
    return this.transaction((state) => {
      const sourceTask = this.task(state, id);
      if (!['failed', 'blocked'].includes(sourceTask.status)) throw new HotelDomainError('Technical escalation requires a failed or blocked task', 409);
      if (sourceTask.role === 'codex') throw new HotelDomainError('Technical tasks cannot recursively escalate to themselves');
      if (sourceTask.technicalTaskId) return this.task(state, sourceTask.technicalTaskId);
      const template = HOTEL_TASK_TEMPLATES.find((t) => t.id === 'technical-fix')!;
      const task = this.newTask(state, {
        propertyId: sourceTask.propertyId, title: `排障：${sourceTask.title}`.slice(0, 300), role: 'codex', action: 'code', objective: template.objective,
        inputs: `原任务 ${sourceTask.id}\n问题：${sourceTask.blockedReason ?? '执行失败'}\n只在隔离开发环境诊断；不得修改生产账号或配置。`,
        acceptanceCriteria: template.acceptanceCriteria, idempotencyKey: `technical:${sourceTask.id}`,
      });
      sourceTask.technicalTaskId = task.id; this.touch(sourceTask);
      return task;
    });
  }
  recordPublication(id: string, url: string): Promise<HotelTask> {
    return this.transaction((state) => {
      const task = this.task(state, id);
      if (task.role !== 'douyin' || task.status !== 'succeeded' || !task.result?.content) throw new HotelDomainError('Only an accepted complete Douyin draft can have a manual publication record', 409);
      if (hotelContentScore(task.result.content) < 80) throw new HotelDomainError('Content below 80 points cannot be marked as published', 409);
      if (!/^https:\/\//.test(url)) throw new HotelDomainError('Provide the HTTPS publication URL as evidence');
      this.preserveCurrentResult(task);
      task.result.content.publication = { url: validUri(url), recordedAt: this.stamp(), recordedBy: 'owner' };
      this.touch(task); this.audit(state, task.propertyId, 'content.publication_recorded', `Owner recorded an existing publication at ${url}; this system did not publish it`, id);
      return task;
    });
  }
  async exportProperty(propertyId: string): Promise<HotelSnapshot> {
    const state = await this.snapshot(); this.property(state, propertyId);
    return { schemaVersion: 1, revision: state.revision, properties: state.properties.filter((p) => p.id === propertyId), bindings: state.bindings.filter((b) => b.propertyId === propertyId), tasks: state.tasks.filter((t) => t.propertyId === propertyId), knowledge: state.knowledge.filter((k) => k.propertyId === propertyId), schedules: state.schedules.filter((s) => s.propertyId === propertyId), audit: state.audit.filter((a) => a.propertyId === propertyId) };
  }
  async report(propertyId: string, date: string): Promise<HotelReport> {
    const state = await this.snapshot(); const property = this.property(state, propertyId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new HotelDomainError('Report date must be a valid YYYY-MM-DD');
    const metrics = Object.fromEntries(METRIC_KEYS.map((key) => [key, null])) as HotelReport['metrics'];
    const warnings: string[] = [];
    const tasks = state.tasks.filter((t) => t.propertyId === propertyId);
    const completedTasks = tasks.filter((t) => t.status === 'succeeded');
    for (const task of [...completedTasks].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
      for (const metric of task.result?.metrics ?? []) {
        if (localDate(new Date(metric.periodStart), property.timezone) !== date || localDate(new Date(Date.parse(metric.periodEnd) - 1), property.timezone) !== date) continue;
        if (!isLocalMidnight(new Date(metric.periodStart), property.timezone) || !isLocalMidnight(new Date(metric.periodEnd), property.timezone)) {
          warnings.push(`${metric.key} 只覆盖当日部分时段，未作为整日经营指标展示`);
          continue;
        }
        if (metrics[metric.key] && metrics[metric.key]?.value !== metric.value) warnings.push(`同日 ${metric.key} 有多份不同结果，展示最近验收值，请核对来源与统计口径`);
        metrics[metric.key] = metric;
      }
    }
    for (const key of METRIC_KEYS) if (!metrics[key]) warnings.push(`${key} 尚无本日已验收数据`);
    const available = metrics.availableRooms; const occupied = metrics.occupiedRooms; const revenue = metrics.roomRevenue;
    const compatible = (...items: Array<HotelMetric | null>): boolean => items.every(Boolean)
      && items.every((m) => m!.periodStart === items[0]!.periodStart && m!.periodEnd === items[0]!.periodEnd && m!.basis === items[0]!.basis);
    const occupancyRate = compatible(available, occupied) && available!.value > 0 && occupied!.value <= available!.value ? occupied!.value / available!.value : null;
    const averageDailyRate = compatible(revenue, occupied) && occupied!.value > 0 ? revenue!.value / occupied!.value : null;
    const revenuePerAvailableRoom = compatible(revenue, available) && available!.value > 0 ? revenue!.value / available!.value : null;
    if (available && occupied && occupied.value > available.value) warnings.push('已售房数大于可售房数，请检查口径或重复统计');
    if ((available && occupied && !compatible(available, occupied)) || (revenue && occupied && !compatible(revenue, occupied))) warnings.push('指标时间范围或口径不同，已停止计算相关比率');
    return { propertyId, date, timezone: property.timezone, metrics, occupancyRate, averageDailyRate, revenuePerAvailableRoom, warnings, pendingApprovals: tasks.filter((t) => t.status === 'awaiting_approval'), blockedTasks: tasks.filter((t) => ['failed', 'blocked'].includes(t.status)), completedTasks: completedTasks.filter((t) => localDate(new Date(t.updatedAt), property.timezone) === date) };
  }
}

export function hotelContentScore(content: HotelContent): number { return content.scores.reduce((sum, item) => sum + item.score, 0); }
export function validateHotelContent(value: HotelContent): HotelContent {
  if (!value || typeof value !== 'object' || !CONTENT_TOPICS.includes(value.topic)) throw new HotelDomainError('Invalid content topic');
  if (value.aspectRatio !== '9:16') throw new HotelDomainError('Douyin drafts require a 9:16 cover plan');
  if (!Array.isArray(value.scores) || value.scores.length < 2 || value.scores.length > 20) throw new HotelDomainError('Provide criterion-level scores and reasons');
  const scores = value.scores.map((item) => ({ criterion: required(item.criterion, 'score criterion', 300), score: integer(item.score, 'score', 0, 100), maximum: integer(item.maximum, 'maximum score', 1, 100), reason: required(item.reason, 'score reason', 3000) }));
  if (scores.reduce((sum, item) => sum + item.maximum, 0) !== 100 || scores.some((item) => item.score > item.maximum)) throw new HotelDomainError('Score maxima must sum to 100 and each score must be within its maximum');
  const content: HotelContent = {
    topic: value.topic, title: required(value.title, 'content title', 300), hook: required(value.hook, 'hook', 3000), script: required(value.script, 'script', 30000), storyboard: required(value.storyboard, 'storyboard', 30000), subtitles: required(value.subtitles, 'subtitles', 30000), coverPlan: required(value.coverPlan, 'cover plan', 10000), caption: required(value.caption, 'caption', 10000), durationSeconds: integer(value.durationSeconds, 'durationSeconds', 30, 60), aspectRatio: '9:16', scores, improvements: strings(value.improvements ?? [], 'improvements'),
    templateId: value.templateId ? required(value.templateId, 'templateId', 200) : undefined,
    inputRevision: value.inputRevision === undefined ? undefined : integer(value.inputRevision, 'inputRevision', 1, 100000),
  };
  if (hotelContentScore(content) < 80 && !content.improvements.length) throw new HotelDomainError('Content below 80 requires specific improvement suggestions');
  if (value.publication) throw new HotelDomainError('Workers cannot mark content published; the owner records publication separately');
  return content;
}
export function validateHotelResult(value: HotelTaskResult): HotelTaskResult {
  if (!value || typeof value !== 'object') throw new HotelDomainError('Invalid task result');
  if (!Array.isArray(value.sources) || value.sources.length > 100 || !Array.isArray(value.artifacts) || value.artifacts.length > 100) throw new HotelDomainError('Invalid evidence arrays');
  const sources = value.sources.map(source); const artifacts = value.artifacts.map(artifact);
  if (!sources.length && !artifacts.length) throw new HotelDomainError('A result needs source or artifact evidence before review');
  if (value.metrics !== undefined && (!Array.isArray(value.metrics) || value.metrics.length > METRIC_KEYS.length)) throw new HotelDomainError('Invalid metrics array');
  const metrics = value.metrics?.map((metric) => {
    if (!metric || !METRIC_KEYS.includes(metric.key) || typeof metric.value !== 'number' || !Number.isFinite(metric.value) || metric.value < 0) throw new HotelDomainError('Invalid hotel metric');
    if (['availableRooms', 'occupiedRooms', 'orders'].includes(metric.key) && !Number.isInteger(metric.value)) throw new HotelDomainError('Room and order counts must be integers');
    const periodStart = timestamp(metric.periodStart, 'metric periodStart'); const periodEnd = timestamp(metric.periodEnd, 'metric periodEnd');
    if (Date.parse(periodEnd) <= Date.parse(periodStart)) throw new HotelDomainError('Metric periodEnd must follow periodStart');
    return { key: metric.key, value: metric.value, periodStart, periodEnd, basis: required(metric.basis, 'metric basis', 3000), source: source(metric.source) };
  });
  if (metrics && new Set(metrics.map((m) => m.key)).size !== metrics.length) throw new HotelDomainError('Duplicate metric keys in one result');
  let assessment: HotelTaskResult['assessment'];
  if (value.assessment !== undefined) {
    if (!value.assessment || !['accept', 'return'].includes(value.assessment.decision)) throw new HotelDomainError('Invalid supervisor assessment');
    assessment = { decision: value.assessment.decision, note: required(value.assessment.note, 'assessment note', 10000) };
  }
  return {
    summary: required(value.summary, 'result summary', 30000), completedItems: strings(value.completedItems, 'completed items', true), missingItems: strings(value.missingItems, 'missing items'), sources, artifacts,
    dataPeriod: required(value.dataPeriod, 'data period', 1000), verificationNotes: required(value.verificationNotes, 'verification notes', 10000), suggestedNextActions: strings(value.suggestedNextActions ?? [], 'suggested next actions'), metrics, content: value.content ? validateHotelContent(value.content) : undefined, assessment,
    plannedTasks: value.plannedTasks === undefined ? undefined : validateDelegationPlan(value.plannedTasks),
  };
}
export function validateDelegationPlan(value: HotelPlannedTask[]): HotelPlannedTask[] {
  if (!Array.isArray(value) || !value.length || value.length > 16) throw new HotelDomainError('Delegation plans must contain 1–16 tasks');
  const planned = value.map((item, index) => {
    if (!item || !HOTEL_ROLES.includes(item.role) || !['read', 'analysis', 'code'].includes(item.action)) throw new HotelDomainError('Delegation supports known roles and read/analysis/code actions only');
    if (item.action === 'code' && item.role !== 'codex') throw new HotelDomainError('Delegated code tasks must use the Codex role');
    if (!Array.isArray(item.dependsOn) || item.dependsOn.length > 16) throw new HotelDomainError('Invalid planned task dependency indices');
    const dependsOn = [...new Set(item.dependsOn.map((dependency) => integer(dependency, 'dependency index', 0, value.length - 1)))];
    if (dependsOn.includes(index)) throw new HotelDomainError('A planned task cannot depend on itself');
    return { title: required(item.title, 'planned title', 300), objective: required(item.objective, 'planned objective', 30000), role: item.role, action: item.action, inputs: optional(item.inputs, 'planned inputs', 30000), acceptanceCriteria: strings(item.acceptanceCriteria, 'planned acceptance criteria', true), dependsOn };
  });
  const done = new Set<number>(); const visiting = new Set<number>();
  const visit = (index: number): void => {
    if (visiting.has(index)) throw new HotelDomainError('Planned task dependency cycle is not allowed');
    if (done.has(index)) return;
    visiting.add(index); for (const dependency of planned[index].dependsOn) visit(dependency); visiting.delete(index); done.add(index);
  };
  planned.forEach((_task, index) => visit(index));
  return planned;
}
function localDate(now: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function isLocalMidnight(now: Date, zone: string): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return parts.filter((p) => ['hour', 'minute', 'second'].includes(p.type)).every((p) => p.value === '00') && now.getUTCMilliseconds() === 0;
}
export function scheduleSlot(schedule: HotelSchedule, now: Date): string | null {
  if (schedule.frequency === 'interval') return `interval:${Math.floor(now.getTime() / (schedule.intervalMinutes * 60000))}`;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: schedule.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  if (`${get('hour')}:${get('minute')}` < schedule.time) return null;
  if (schedule.frequency === 'weekly' && !schedule.weekdays.includes(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')))) return null;
  // Only today's slot is caught up; offline days are never silently replayed.
  return `${localDate(now, schedule.timezone)}:${schedule.time}`;
}
