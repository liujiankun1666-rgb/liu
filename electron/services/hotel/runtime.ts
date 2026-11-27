import type { GatewayManager } from '../../gateway/manager';
import type { HostApiContext } from '../../api/context';
import { listAgentsSnapshot } from '../../utils/agent-config';
import { logger } from '../../utils/logger';
import type { HotelTask, HotelTaskResult, HotelSnapshotResponse, HotelCapability } from '../../../shared/hotel';
import { HotelDomainError, HOTEL_TASK_TEMPLATES, type HotelService } from './domain';
import { getHotelService } from './store';
import { asRecord, assistantText, buildHotelBrief, parseHotelResult } from './gateway-payload';
import { inspectHotelExecutionPolicy } from './execution-policy';
import { CODEX_TECHNICAL_ID, CodexCliExecutor, type CodexTechnicalExecutor } from './codex-cli';

type Gateway = Pick<GatewayManager, 'rpc' | 'getStatus' | 'on' | 'off'>;
export interface HotelRuntimeOptions {
  agents?: typeof listAgentsSnapshot;
  policy?: typeof inspectHotelExecutionPolicy;
  onChange?: () => void;
  autoStart?: boolean;
  codex?: CodexTechnicalExecutor;
}

const SAFE_ACTIONS = new Set(['read', 'analysis', 'code']);
const MAX_CONCURRENT = 2;

/** Main-owned dispatcher. A persisted attempt is reserved before any RPC is sent. */
export class HotelRuntime {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private disposed = false;
  private dispatchChain: Promise<unknown> = Promise.resolve();
  private eventChain: Promise<unknown> = Promise.resolve();
  private readonly agents;
  private readonly policy;
  private readonly onChange;
  private readonly ready: Promise<void>;
  private readonly codex?: CodexTechnicalExecutor;

  constructor(readonly service: HotelService, readonly gateway: Gateway, options: HotelRuntimeOptions = {}) {
    this.codex = options.codex;
    this.agents = options.agents ?? listAgentsSnapshot;
    this.policy = options.policy ?? inspectHotelExecutionPolicy;
    this.onChange = options.onChange ?? (() => {});
    this.ready = this.service.recoverInterruptedTasks().then(() => undefined);
    this.gateway.on('chat:message', this.onChat);
    if (options.autoStart !== false) {
      this.timer = setInterval(() => { void this.tick().catch(this.logError); }, 15000);
      this.timer.unref?.();
      void this.ready.then(() => this.tick()).catch(this.logError);
    }
  }

  private logError = (error: unknown) => logger.warn('Hotel task runtime:', error instanceof Error ? error.message : String(error));

  async snapshot(): Promise<HotelSnapshotResponse> {
    await this.ready;
    let agents: Awaited<ReturnType<typeof listAgentsSnapshot>>['agents'] = [];
    let discoveryDetail = '从本机 OpenClaw 配置读取 Agent；绑定不会创建或覆盖 Agent。';
    try { agents = (await this.agents()).agents; }
    catch { discoveryDetail = '读取本机 Agent 配置失败，请检查本机 OpenClaw 配置；没有假定已有 Agent 可用。'; }
    const configuredNative = await this.codex?.describe();
    const collision = agents.some((agent) => agent.id === CODEX_TECHNICAL_ID);
    const native = collision ? null : configuredNative;
    if (native) { agents.push(native); discoveryDetail += ' 另列独立原生Codex技术执行端，不属于OpenClaw Agent。'; }
    if (collision) discoveryDetail += ' 保留ID与OpenClaw Agent冲突，原生技术派单已阻塞。';
    const capabilities: HotelCapability[] = [
      { id: 'task-center', label: '任务、验收与审批', status: 'implemented', detail: '持久任务、父子依赖、回传、版本审批、审计与重启恢复。' },
      { id: 'agent-discovery', label: '现有 Agent 复用', status: agents.length ? 'implemented' : 'needs_connection', detail: discoveryDetail },
      { id: 'gateway', label: '本机 Agent 调度', status: this.gateway.getStatus().state === 'running' ? 'implemented' : 'needs_connection', detail: '通过 Gateway 派发独立任务会话；还需绑定岗位并通过执行权限检查。' },
      { id: 'chatgpt', label: 'ChatGPT 对话桥接', status: 'needs_connection', detail: '提供受限 MCP 接口和本机 stdio 客户端；当前聊天未自动获得本机连接，远程 HTTPS 接入须另行联调。' },
      { id: 'codex', label: 'Codex 技术工单', status: native ? 'implemented' : 'needs_connection', detail: native ? '独立原生Codex技术端已配置；每次派单前实测权限，结果先待验收。模型可用性以真实回执为准。' : '技术工单已提供，独立Codex技术执行端尚未配置；不把模型配置当执行器。' },
      { id: 'pms', label: '别样红业务数据', status: 'needs_connection', detail: '需要在运行 ClawX 的电脑上验证账号、读取范围与来源；历史登录反馈不当作当前可用证据。' },
      { id: 'ctrip', label: '携程业务数据', status: 'needs_connection', detail: '复用运营 Agent；曝光、转化、订单、评价须有实际访问与来源证据。' },
      { id: 'douyin', label: '抖音创作与审核', status: 'implemented', detail: '提供完整创作任务与分项评分验证，低于80分不能记录已发布；不自动发布。' },
      { id: 'writes', label: '调价、支付、退款、对客发送', status: 'unavailable', detail: '可提交具体方案并审批；尚未接入受控执行适配器，批准后仍不会自动写入生产后台。' },
    ];
    return { success: true, snapshot: await this.service.snapshot(), agents, gateway: this.gateway.getStatus(), capabilities, templates: HOTEL_TASK_TEMPLATES };
  }

  async inspectExecutionPolicy(agentId: string, action: 'read' | 'analysis' | 'code', propertyId?: string) {
    if (agentId !== CODEX_TECHNICAL_ID) return { backend: 'gateway', ...await this.policy(agentId, action) };
    if (action !== 'code' || !propertyId || !(await this.service.snapshot()).properties.some((property) => property.id === propertyId)) throw new HotelDomainError('原生Codex预检要求有效propertyId及action=code');
    if (!this.codex || (await this.agents()).agents.some((agent) => agent.id === CODEX_TECHNICAL_ID)) return { backend: 'codex-cli', allowed: false, reason: '原生技术执行端未配置或ID与OpenClaw冲突', verifiedTools: [] };
    return { backend: 'codex-cli', ...await this.codex.inspect(propertyId) };
  }

  /** Serializes reservations, not model work, so the concurrency bound is real. */
  dispatch(taskId: string): Promise<HotelTask> {
    const operation = this.dispatchChain.then(() => this.dispatchOne(taskId));
    this.dispatchChain = operation.catch(() => {});
    return operation;
  }

  private async dispatchOne(taskId: string): Promise<HotelTask> {
    await this.ready;
    if (this.disposed) throw new Error('酒店调度器已停止');
    const snapshot = await this.service.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error('任务不存在');
    if (task.status === 'running') return task;
    // Business mutation actions are rejected by the domain even after approval.
    if (!SAFE_ACTIONS.has(task.action)) {
      return this.service.claimTask(taskId, { availableAgentIds: [] });
    }
    if (task.status !== 'queued') throw new Error('请先将任务加入执行队列');
    if (snapshot.tasks.filter((item) => item.status === 'running').length >= MAX_CONCURRENT) {
      await this.service.markWaiting(taskId, '已有2项任务执行中，等待可用执行位置');
      throw new Error('已有2项任务执行中，本任务继续等待队列');
    }
    const binding = snapshot.bindings.find((item) => item.propertyId === task.propertyId && item.role === task.role);
    if (!binding?.agentId || !binding.enabled) {
      await this.service.markWaiting(taskId, '请先绑定并启用此门店的现有 Agent 岗位', true);
      throw new Error('请先绑定并启用此门店的现有 Agent 岗位');
    }
    if (binding.agentId === CODEX_TECHNICAL_ID) {
      if (task.role !== 'codex' || task.action !== 'code' || !this.codex || task.reviewTarget) {
        await this.service.markWaiting(taskId, '原生Codex仅接受独立技术code任务，不执行经营岗位或验收任务', true);
        throw new Error('原生Codex仅接受独立技术code任务');
      }
      const policy = await this.inspectExecutionPolicy(CODEX_TECHNICAL_ID, 'code', task.propertyId);
      if (!policy.allowed) {
        await this.service.markWaiting(taskId, `原生执行权限待核验：${policy.reason}`, true);
        throw new Error(policy.reason);
      }
      const claimed = await this.service.claimTask(taskId, { availableAgentIds: [CODEX_TECHNICAL_ID], expectedAgentId: CODEX_TECHNICAL_ID, expectedPlanVersion: task.planVersion, executor: 'codex-cli' });
      const attempt = claimed.attempts.at(-1)!;
      this.onChange();
      void this.codex.execute(claimed, buildHotelBrief(claimed, await this.service.snapshot())).then(async (receipt) => {
        const current = (await this.service.snapshot()).tasks.find((item) => item.id === taskId)!;
        if ((current.status === 'running' || current.status === 'blocked') && current.attempts.at(-1)?.id === attempt.id) await this.consumeResult(current, receipt.text, receipt.runId, 'codex-cli');
      }).catch(async (error) => {
        const current = (await this.service.snapshot()).tasks.find((item) => item.id === taskId);
        if (current?.status === 'running' && current.attempts.at(-1)?.id === attempt.id) await this.service.failTask(taskId, attempt.id, error instanceof Error ? error.message : 'Native Codex execution failed', true);
        this.onChange();
      }).catch(this.logError);
      return claimed;
    }
    if (this.gateway.getStatus().state !== 'running') {
      await this.service.markWaiting(taskId, 'Gateway 尚未连接，任务已保留，未发送');
      throw new Error('Gateway 尚未连接，任务已保留，未发送');
    }
    const policy = await this.policy(binding.agentId, task.action as 'read' | 'analysis' | 'code');
    if (!policy.allowed) {
      await this.service.markWaiting(taskId, `执行权限待核验：${policy.reason}`, true);
      throw new Error(`执行权限待核验：${policy.reason}`);
    }
    const agents = await this.agents();
    if (!agents.agents.some((agent) => agent.id === binding.agentId)) {
      await this.service.markWaiting(taskId, '绑定的 Agent 已不在本机配置中，请重新核对岗位', true);
      throw new Error('绑定的 Agent 已不在本机配置中');
    }
    const claimed = await this.service.claimTask(taskId, {
      availableAgentIds: agents.agents.map((item) => item.id),
      expectedAgentId: binding.agentId, expectedPlanVersion: task.planVersion,
    });
    if (claimed.status !== 'running') return claimed;
    const attempt = claimed.attempts.at(-1)!;
    const message = buildHotelBrief(claimed, await this.service.snapshot());
    this.onChange();
    // Do not tie the task's lifetime to a renderer request or HTTP connection.
    void this.gateway.rpc<{ runId?: string }>('chat.send', {
      sessionKey: attempt.sessionKey, message, deliver: false, idempotencyKey: attempt.dispatchKey,
    }, 120000).then(async (ack) => {
      await this.service.markDispatched(taskId, attempt.id, ack?.runId);
      this.onChange();
    }).catch(async (error) => {
      // A send timeout may mean the Gateway accepted the work. Never blindly resend.
      const current = (await this.service.snapshot()).tasks.find((item) => item.id === taskId);
      if (current?.status === 'running' && current.attempts.at(-1)?.id === attempt.id) {
        await this.service.failTask(taskId, attempt.id, `派发回执不确定：${error instanceof Error ? error.message : String(error)}。请先核对会话。`, true);
        this.onChange();
      }
    }).catch(this.logError);
    return claimed;
  }

  async runReady(propertyId?: string): Promise<{ dispatched: string[]; waiting: Array<{ taskId: string; reason: string }> }> {
    await this.ready;
    const snapshot = await this.service.snapshot();
    const order = { urgent: 0, high: 1, normal: 2 };
    const queued = snapshot.tasks.filter((task) => task.status === 'queued' && (!propertyId || task.propertyId === propertyId))
      .sort((a, b) => order[a.priority] - order[b.priority] || a.createdAt.localeCompare(b.createdAt));
    const dispatched: string[] = [];
    const waiting: Array<{ taskId: string; reason: string }> = [];
    for (const task of queued) {
      const missing = task.dependencies.filter((id) => !snapshot.tasks.some((item) => item.id === id && item.status === 'succeeded'));
      if (missing.length) {
        await this.service.markWaiting(task.id, '等待前置任务验收通过');
        waiting.push({ taskId: task.id, reason: '等待前置任务验收通过' }); continue;
      }
      try {
        const claimed = await this.dispatch(task.id);
        if (claimed.status === 'running') dispatched.push(task.id);
        else waiting.push({ taskId: task.id, reason: claimed.blockedReason ?? '任务暂未满足执行条件' });
      } catch (error) {
        waiting.push({ taskId: task.id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { dispatched, waiting };
  }

  private onChat = (payload: { message: unknown }) => {
    this.eventChain = this.eventChain.then(() => this.handleChat(payload.message)).catch(this.logError);
  };

  async handleChat(payload: unknown): Promise<void> {
    await this.ready;
    const event = asRecord(payload);
    if (!event || typeof event.sessionKey !== 'string' || typeof event.runId !== 'string') return;
    if (!['final', 'error', 'aborted'].includes(String(event.state))) return;
    const snapshot = await this.service.snapshot();
    const task = snapshot.tasks.find((item) => {
      const attempt = item.attempts.at(-1);
      if (!attempt || attempt.executor === 'codex-cli') return false;
      return (item.status === 'running' || (item.status === 'blocked' && attempt?.outcome === 'uncertain'))
        && attempt.sessionKey === event.sessionKey && (!attempt.runId || attempt.runId === event.runId);
    });
    if (!task) return;
    const attempt = task.attempts.at(-1)!;
    if (event.state === 'error' || event.state === 'aborted') {
      if (task.status === 'blocked') await this.service.resumeForReconciliation(task.id, attempt.id);
      await this.service.failTask(task.id, attempt.id,
        typeof event.errorMessage === 'string' ? event.errorMessage : `Gateway ${event.state}`, false);
      this.onChange();
      return;
    }
    const text = assistantText(event.message);
    if (!text) return;
    await this.consumeResult(task, text, event.runId);
  }

  private async consumeResult(task: HotelTask, text: string, runId?: string, origin: 'gateway' | 'codex-cli' = 'gateway'): Promise<void> {
    const attempt = task.attempts.at(-1)!;
    try {
      const envelope = parseHotelResult(text, task.id, attempt.id);
      if (task.status === 'blocked' && attempt.outcome === 'uncertain') {
        await this.service.resumeForReconciliation(task.id, attempt.id);
      }
      if (runId) await this.service.markDispatched(task.id, attempt.id, runId);
      if (envelope.outcome === 'completed' && envelope.result) {
        await this.returnResult(task.id, attempt.id, envelope.result, origin);
      } else {
        await this.service.failTask(task.id, attempt.id, envelope.error ?? 'Agent 未完成任务', false);
      }
    } catch (error) {
      await this.service.failTask(task.id, attempt.id,
        `回传格式或证据未通过校验：${error instanceof Error ? error.message : String(error)}。原文保留在任务会话中，可补充结构化结果。`, false);
    }
    this.onChange();
  }

  async returnResult(taskId: string, attemptId: string, result: HotelTaskResult, origin: 'gateway' | 'owner' | 'bridge' | 'codex-cli' = 'gateway'): Promise<HotelTask> {
    const returned = await this.service.submitResult(taskId, attemptId, result, origin);
    await this.ensureSupervisorReview(returned);
    this.onChange();
    return returned;
  }

  private async ensureSupervisorReview(returned: HotelTask): Promise<void> {
    // A distinct supervisor may validate worker results. It can never approve business writes.
    if (!returned.reviewTarget && returned.role !== 'supervisor' && returned.status === 'needs_review') {
      const snapshot = await this.service.snapshot();
      const supervisor = snapshot.bindings.find((item) => item.propertyId === returned.propertyId && item.role === 'supervisor');
      if (supervisor?.enabled && supervisor.agentId && supervisor.agentId !== returned.assignedAgentId) {
        try {
          const review = await this.service.createSupervisorReview(returned.id);
          if (review.status === 'draft') await this.service.queueTask(review.id, 'system');
        } catch (error) {
          // The owner's manual review remains available; never discard a valid worker result.
          this.logError(error);
        }
      }
    }
  }

  async repairPendingReviews(): Promise<void> {
    const pending = (await this.service.snapshot()).tasks.filter((task) => task.status === 'needs_review' && task.role !== 'supervisor' && !task.reviewTarget);
    for (const task of pending) await this.ensureSupervisorReview(task);
  }

  /** Reconciliation reads the exact attempt's session and never submits chat.send. */
  async reconcile(taskId: string): Promise<HotelTask> {
    await this.ready;
    const task = (await this.service.snapshot()).tasks.find((item) => item.id === taskId);
    if (!task) throw new Error('任务不存在');
    if (task.status === 'succeeded' || task.status === 'cancelled' || task.status === 'needs_review') return task;
    if (task.status !== 'running' && !(task.status === 'blocked' && task.attempts.at(-1)?.outcome === 'uncertain')) {
      throw new Error('仅执行中或回执不确定的任务可核对原会话；已失败任务请查看会话、修正后重试');
    }
    const attempt = task.attempts.at(-1);
    if (!attempt) throw new Error('任务尚未派发，无会话可核对');
    if (attempt.executor === 'codex-cli') {
      if (!this.codex) throw new Error('Native executor unavailable; do not redispatch');
      const receipt = await this.codex.reconcile(task);
      await this.consumeResult(task, receipt.text, receipt.runId, 'codex-cli');
      return (await this.service.snapshot()).tasks.find((item) => item.id === taskId)!;
    }
    const history = await this.gateway.rpc<{ messages?: unknown[] }>('chat.history', { sessionKey: attempt.sessionKey, limit: 50 }, 20000);
    const entries = Array.isArray(history?.messages) ? history.messages : [];
    for (const entry of [...entries].reverse()) {
      const text = assistantText(entry);
      if (!text) continue;
      try { parseHotelResult(text, task.id, attempt.id); } catch { continue; }
      await this.consumeResult(task, text, attempt.runId);
      return (await this.service.snapshot()).tasks.find((item) => item.id === taskId)!;
    }
    throw new Error('尚未找到本次执行的有效结构化回传；未重新派单，请继续检查原会话');
  }

  cancel(taskId: string): Promise<HotelTask> {
    const operation = this.dispatchChain.then(() => this.cancelOne(taskId));
    this.dispatchChain = operation.catch(() => {});
    return operation;
  }

  private async cancelOne(taskId: string): Promise<HotelTask> {
    const task = (await this.service.snapshot()).tasks.find((item) => item.id === taskId);
    if (!task) throw new Error('任务不存在');
    const attempt = task.attempts.at(-1);
    if ((task.status === 'running' || (task.status === 'blocked' && attempt?.outcome === 'uncertain')) && attempt) {
      if (attempt.executor === 'codex-cli') {
        if (!this.codex || !await this.codex.cancel(task)) throw new Error('Native process cancellation unconfirmed; reconcile its receipt first');
        const current = (await this.service.snapshot()).tasks.find((item) => item.id === taskId)!;
        if (current.status === 'needs_review' || current.status === 'succeeded') return current;
        const cancelled = await this.service.cancelTask(taskId); this.onChange(); return cancelled;
      }
      // A cancellation is only confirmed after Gateway acknowledges it.
      const result = await this.gateway.rpc<{ aborted?: boolean; runIds?: string[] }>('chat.abort', {
        sessionKey: attempt.sessionKey, ...(attempt.runId ? { runId: attempt.runId } : {}),
      }, 20000);
      if (result?.aborted !== true && !(Array.isArray(result?.runIds) && result.runIds.length)) {
        throw new Error('Gateway 未确认取消；任务仍保留原状态，请先核对会话');
      }
      const afterAbort = (await this.service.snapshot()).tasks.find((item) => item.id === taskId)!;
      if (afterAbort.status === 'needs_review' || afterAbort.status === 'succeeded') return afterAbort;
    }
    const updated = await this.service.cancelTask(taskId);
    this.onChange();
    return updated;
  }

  async tick(): Promise<void> {
    await this.ready;
    if (this.ticking || this.disposed) return;
    this.ticking = true;
    try {
      await this.service.expireLeases();
      await this.service.tickSchedules();
      await this.repairPendingReviews();
      await this.runReady();
      this.onChange();
    } finally { this.ticking = false; }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.gateway.off('chat:message', this.onChat);
  }
}

const runtimes = new WeakMap<GatewayManager, Promise<HotelRuntime>>();
export function getHotelRuntime(ctx: HostApiContext): Promise<HotelRuntime> {
  let runtime = runtimes.get(ctx.gatewayManager);
  if (!runtime) {
    runtime = getHotelService().then(async (service) => {
      const { app } = await import('electron');
      const { join } = await import('node:path');
      return new HotelRuntime(service, ctx.gatewayManager, {
      codex: new CodexCliExecutor(join(app.getPath('userData'), 'hotel-codex-executor.json')),
      onChange: () => ctx.eventBus.emit('hotel:changed', { at: new Date().toISOString() }),
    });
    });
    runtimes.set(ctx.gatewayManager, runtime);
  }
  return runtime;
}
