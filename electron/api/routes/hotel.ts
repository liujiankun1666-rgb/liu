import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import type { CreateHotelTaskInput, HotelBinding, HotelTaskResult, SaveHotelKnowledgeInput, SaveHotelScheduleInput, UpdateHotelTaskInput } from '../../../shared/hotel';
import { HotelDomainError } from '../../services/hotel/domain';
import { getHotelRuntime } from '../../services/hotel/runtime';
import { readHotelJson } from '../../services/hotel/http-body';
import { createHotelWorkflow } from '../../services/hotel/workflows';
import { getHotelBridge } from '../../services/hotel/bridge';

export async function handleHotelRoutes(req: IncomingMessage, res: ServerResponse, url: URL, ctx: HostApiContext): Promise<boolean> {
  if (!url.pathname.startsWith('/api/hotel/')) return false;
  try {
    const runtime = await getHotelRuntime(ctx);
    const service = runtime.service;
    if (url.pathname === '/api/hotel/snapshot' && req.method === 'GET') {
      sendJson(res, 200, await runtime.snapshot()); return true;
    }
    if (url.pathname === '/api/hotel/report' && req.method === 'GET') {
      sendJson(res, 200, { success: true, report: await service.report(url.searchParams.get('propertyId') ?? '', url.searchParams.get('date') ?? '') }); return true;
    }
    if (url.pathname === '/api/hotel/export' && req.method === 'GET') {
      sendJson(res, 200, { success: true, snapshot: await service.exportProperty(url.searchParams.get('propertyId') ?? '') }); return true;
    }
    if (url.pathname === '/api/hotel/execution-policy' && req.method === 'GET') {
      const action = url.searchParams.get('action') ?? 'analysis';
      if (!['read', 'analysis', 'code'].includes(action)) throw new HotelDomainError('无效执行类型');
      sendJson(res, 200, { success: true, ...await runtime.inspectExecutionPolicy(url.searchParams.get('agentId') ?? '', action as 'read' | 'analysis' | 'code', url.searchParams.get('propertyId') ?? undefined) }); return true;
    }
    if (url.pathname === '/api/hotel/bridge') {
      const bridge = await getHotelBridge();
      if (req.method === 'GET') { sendJson(res, 200, { success: true, ...await bridge.status() }); return true; }
      if (req.method === 'DELETE') { await bridge.revoke(); sendJson(res, 200, { success: true, ...await bridge.status() }); return true; }
      if (req.method === 'POST') {
        const body = await readHotelJson<{ propertyIds: string[]; allowDispatch: boolean }>(req);
        const snapshot = await service.snapshot();
        if (!Array.isArray(body.propertyIds) || !body.propertyIds.length || body.propertyIds.some((id) => !snapshot.properties.some((property) => property.id === id))) throw new HotelDomainError('桥接授权必须选择已有门店');
        if (typeof body.allowDispatch !== 'boolean') throw new HotelDomainError('需要明确桥接是否允许派单');
        sendJson(res, 200, { success: true, ...await bridge.rotate(body.propertyIds, body.allowDispatch) }); return true;
      }
    }
    if (url.pathname === '/api/hotel/tasks' && req.method === 'POST') {
      sendJson(res, 201, { success: true, task: await service.createTask(await readHotelJson<CreateHotelTaskInput>(req)) }); return true;
    }
    if (url.pathname === '/api/hotel/bindings' && req.method === 'PUT') {
      const body = await readHotelJson<Omit<HotelBinding, 'updatedAt'>>(req);
      const snapshot = await runtime.snapshot();
      if (body.agentId !== null && !snapshot.agents.some((agent) => agent.id === body.agentId)) throw new HotelDomainError('只能绑定本机已存在的 Agent');
      sendJson(res, 200, { success: true, binding: await service.setBinding(body) }); return true;
    }
    if (url.pathname === '/api/hotel/knowledge' && req.method === 'POST') {
      sendJson(res, 200, { success: true, knowledge: await service.saveKnowledge(await readHotelJson<SaveHotelKnowledgeInput>(req)) }); return true;
    }
    if (url.pathname === '/api/hotel/schedules' && req.method === 'POST') {
      sendJson(res, 200, { success: true, schedule: await service.saveSchedule(await readHotelJson<SaveHotelScheduleInput>(req)) }); return true;
    }
    if (url.pathname === '/api/hotel/properties' && req.method === 'POST') {
      sendJson(res, 200, { success: true, property: await service.saveProperty(await readHotelJson<{ id?: string; name: string; city: string; timezone: string }>(req)) }); return true;
    }
    if (url.pathname === '/api/hotel/workflows' && req.method === 'POST') {
      sendJson(res, 201, { success: true, tasks: await createHotelWorkflow(service, await readHotelJson<Parameters<typeof createHotelWorkflow>[1]>(req)) }); return true;
    }
    if (url.pathname === '/api/hotel/run-ready' && req.method === 'POST') {
      const body = await readHotelJson<{ propertyId: string }>(req);
      if (!(await service.snapshot()).properties.some((item) => item.id === body.propertyId)) throw new HotelDomainError('门店不存在');
      sendJson(res, 200, { success: true, ...await runtime.runReady(body.propertyId) }); return true;
    }
    const taskRoute = /^\/api\/hotel\/tasks\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
    if (taskRoute) {
      const id = decodeURIComponent(taskRoute[1]);
      const action = taskRoute[2];
      if (!action && req.method === 'PUT') {
        sendJson(res, 200, { success: true, task: await service.updateTask(id, await readHotelJson<UpdateHotelTaskInput>(req)) }); return true;
      }
      if (action && req.method === 'POST') {
        const body = await readHotelJson<Record<string, unknown>>(req);
        let task;
        switch (action) {
          case 'queue': task = await service.queueTask(id); break;
          case 'dispatch': task = await runtime.dispatch(id); break;
          case 'reconcile': task = await runtime.reconcile(id); break;
          case 'retry': task = await service.retryTask(id, { acknowledgeUncertain: body.acknowledgeUncertain === true }); break;
          case 'cancel': task = await runtime.cancel(id); break;
          case 'review': task = await service.reviewTask(id, { decision: body.decision as 'accept' | 'return', note: body.note as string, actor: 'owner' }); break;
          case 'approve': task = await service.approveTask(id, { decision: body.decision as 'approve' | 'reject', planVersion: body.planVersion as number, planHash: body.planHash as string | undefined, note: body.note as string, actor: 'owner' }); break;
          case 'result': task = await runtime.returnResult(id, body.attemptId as string, body.result as HotelTaskResult, 'owner'); break;
          case 'delegate': {
            const tasks = await service.expandDelegation(id);
            ctx.eventBus.emit('hotel:changed', { taskId: id });
            sendJson(res, 200, { success: true, tasks }); return true;
          }
          case 'technical': task = await service.createTechnicalTask(id); break;
          case 'record-publication': task = await service.recordPublication(id, body.url as string); break;
          default: throw new HotelDomainError('未知任务动作', 404);
        }
        ctx.eventBus.emit('hotel:changed', { taskId: id });
        sendJson(res, 200, { success: true, task }); return true;
      }
    }
    sendJson(res, 404, { success: false, error: '没有此酒店接口' });
  } catch (error) {
    const status = error instanceof HotelDomainError ? error.statusCode : 409;
    sendJson(res, status, { success: false, error: error instanceof Error ? error.message : '酒店任务操作失败' });
  }
  return true;
}
