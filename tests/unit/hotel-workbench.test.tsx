import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Workbench } from '../../src/pages/Hotel/Workbench';
import { HOTEL_ROLES, type HotelSchedule, type HotelSnapshotResponse, type HotelTask } from '../../shared/hotel';

const { createTask, taskAction } = vi.hoisted(() => ({ createTask: vi.fn(), taskAction: vi.fn() }));
vi.mock('@/lib/hotel-api', () => ({ hotelApi: { createTask, taskAction } }));

function response(): HotelSnapshotResponse {
  return {
    success: true,
    snapshot: { schemaVersion: 1, revision: 0, properties: [{ id: 'hotel-a', name: '测试门店', city: '测试城市', timezone: 'Asia/Shanghai', createdAt: '2026-11-27T00:00:00Z' }], bindings: [], tasks: [], knowledge: [], schedules: [], audit: [] },
    agents: [], gateway: { state: 'stopped' }, capabilities: [], templates: [],
  };
}

function setup(value = response()) {
  const errors: unknown[] = [];
  const success = vi.fn();
  const props = {
    property: value.snapshot.properties[0], response: value, busy: false,
    run: vi.fn(async (label: string, work: () => Promise<unknown>) => {
      try { await work(); success(label); return true; }
      catch (error) { errors.push(error); return false; }
    }),
    onTask: vi.fn(), onNavigate: vi.fn(),
  };
  const view = render(<Workbench {...props} />);
  return { ...view, props, errors, success };
}

function enterGoal(goal = '核对本周经营问题\n整理优先事项和可审阅分工') {
  fireEvent.change(screen.getByRole('textbox', { name: '交给总管的目标' }), { target: { value: goal } });
}

beforeEach(() => {
  vi.clearAllMocks();
  createTask.mockResolvedValue({ success: true, task: { id: 'batch-task' } });
  taskAction.mockResolvedValue({ success: true, task: { id: 'batch-task', status: 'queued' } });
});

describe('Hotel supervisor workbench', () => {
  it('saves the owner brief as a supervisor analysis task before queueing and opening it', async () => {
    const value = response();
    value.snapshot.knowledge = [{ id: 'local-knowledge', propertyId: 'hotel-a', title: '门店资料', category: 'property', revisions: [] }, { id: 'other-knowledge', propertyId: 'hotel-b', title: '其他门店', category: 'property', revisions: [] }];
    const { props } = setup(value);
    expect(screen.getByRole('button', { name: '提交给总管' })).toBeDisabled();
    enterGoal();
    fireEvent.click(screen.getByRole('button', { name: '提交给总管' }));
    await waitFor(() => expect(props.onTask).toHaveBeenCalledWith('batch-task'));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 'hotel-a', role: 'supervisor', action: 'analysis', objective: '核对本周经营问题\n整理优先事项和可审阅分工', knowledgeIds: ['local-knowledge'], idempotencyKey: expect.any(String) }));
    expect(taskAction).toHaveBeenCalledExactlyOnceWith('batch-task', 'queue');
    expect(createTask.mock.invocationCallOrder[0]).toBeLessThan(taskAction.mock.invocationCallOrder[0]);
    expect(screen.getByRole('textbox', { name: '交给总管的目标' })).toHaveValue('');
  });

  it('blocks concurrent submits while the first creation is unresolved', async () => {
    let resolveCreation!: (value: unknown) => void;
    createTask.mockImplementationOnce(() => new Promise((resolve) => { resolveCreation = resolve; }));
    const { props } = setup();
    enterGoal();
    const form = screen.getByRole('textbox', { name: '交给总管的目标' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '正在提交…' })).toBeDisabled();
    expect(taskAction).not.toHaveBeenCalled();
    resolveCreation({ success: true, task: { id: 'batch-task' } });
    await waitFor(() => expect(props.onTask).toHaveBeenCalledWith('batch-task'));
    expect(taskAction).toHaveBeenCalledTimes(1);
  });

  it('keeps a large knowledge base within the task reference limit and prioritizes recent entries', async () => {
    const value = response();
    value.snapshot.knowledge = Array.from({ length: 101 }, (_, index) => ({
      id: `knowledge-${index}`, propertyId: 'hotel-a', title: `测试资料 ${index}`, category: 'experience' as const,
      revisions: [{ version: 1, content: '合成资料', source: '测试', updatedAt: new Date(1700000000000 + index * 1000).toISOString() }],
    }));
    const { props } = setup(value);
    enterGoal();
    fireEvent.click(screen.getByRole('button', { name: '提交给总管' }));
    await waitFor(() => expect(props.onTask).toHaveBeenCalledWith('batch-task'));
    const references = createTask.mock.calls[0][0].knowledgeIds;
    expect(references).toHaveLength(100);
    expect(references[0]).toBe('knowledge-100');
    expect(references).not.toContain('knowledge-0');
  });

  it('reuses the exact request and idempotency key after a lost response, even after a snapshot refresh', async () => {
    createTask.mockRejectedValueOnce(new Error('响应中断'));
    const view = setup();
    enterGoal();
    fireEvent.click(screen.getByRole('button', { name: '提交给总管' }));
    await waitFor(() => expect(view.errors).toHaveLength(1));
    expect(view.success).not.toHaveBeenCalled();
    expect(view.props.onTask).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '交给总管的目标' })).toHaveValue('核对本周经营问题\n整理优先事项和可审阅分工');
    const refreshed = response();
    refreshed.snapshot.knowledge = [{ id: 'new-knowledge', propertyId: 'hotel-a', title: '新增资料', category: 'property', revisions: [] }];
    view.rerender(<Workbench {...view.props} response={refreshed} />);
    fireEvent.click(screen.getByRole('button', { name: '提交给总管' }));
    await waitFor(() => expect(view.props.onTask).toHaveBeenCalledWith('batch-task'));
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(createTask.mock.calls[1][0]).toEqual(createTask.mock.calls[0][0]);
    expect(taskAction).toHaveBeenCalledTimes(1);
  });

  it('opens a created draft when queueing fails and retries queueing without creating another task', async () => {
    const failure = new Error('队列暂不可用');
    taskAction.mockRejectedValueOnce(failure);
    const { props, errors, success } = setup();
    enterGoal();
    fireEvent.click(screen.getByRole('button', { name: '提交给总管' }));
    await waitFor(() => expect(props.onTask).toHaveBeenCalledWith('batch-task'));
    expect(errors).toEqual([failure]);
    expect(success).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '交给总管的目标' })).not.toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '提交给总管' }));
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(taskAction).toHaveBeenCalledTimes(2);
  });

  it('shows all eight real binding states and keeps counts and task links scoped to the selected property', () => {
    const value = response();
    const updatedAt = '2026-11-27T00:00:00Z';
    value.gateway.state = 'running';
    value.agents = [{ id: 'manager', name: '已有总管', modelDisplay: 'deepseek/deepseek-chat' }, { id: 'finance', name: '已有财务' }];
    value.snapshot.bindings = [
      { propertyId: 'hotel-a', role: 'supervisor', agentId: 'manager', enabled: true, notes: '', updatedAt },
      { propertyId: 'hotel-a', role: 'finance', agentId: 'finance', enabled: false, notes: '', updatedAt },
      { propertyId: 'hotel-a', role: 'pms', agentId: 'missing-agent', enabled: true, notes: '', updatedAt },
      { propertyId: 'hotel-b', role: 'revenue', agentId: 'manager', enabled: true, notes: '', updatedAt },
    ];
    value.snapshot.tasks = [
      { id: 'review', propertyId: 'hotel-a', title: '本店待验收结果', status: 'needs_review', updatedAt },
      { id: 'approval', propertyId: 'hotel-a', title: '本店待审批方案', status: 'awaiting_approval', updatedAt },
      { id: 'blocked', propertyId: 'hotel-a', title: '本店阻塞任务', status: 'blocked', updatedAt },
      { id: 'failed', propertyId: 'hotel-a', title: '本店失败任务', status: 'failed', updatedAt },
      { id: 'other', propertyId: 'hotel-b', title: '其他门店结果', status: 'needs_review', updatedAt },
    ] as HotelTask[];
    value.snapshot.knowledge = [{ id: 'local', propertyId: 'hotel-a', title: '资料', category: 'property', revisions: [] }, { id: 'remote', propertyId: 'hotel-b', title: '资料', category: 'property', revisions: [] }];
    value.snapshot.schedules = [{ id: 'enabled', propertyId: 'hotel-a', enabled: true }, { id: 'disabled', propertyId: 'hotel-a', enabled: false }, { id: 'remote', propertyId: 'hotel-b', enabled: true }] as HotelSchedule[];
    const { props } = setup(value);
    for (const role of HOTEL_ROLES) expect(screen.getByTestId(`hotel-role-${role}`)).toBeInTheDocument();
    expect(within(screen.getByTestId('hotel-role-supervisor')).getByText('派单已启用')).toBeInTheDocument();
    expect(within(screen.getByTestId('hotel-role-supervisor')).getByText('模型：deepseek/deepseek-chat')).toBeInTheDocument();
    expect(within(screen.getByTestId('hotel-role-finance')).getByText('派单已暂停')).toBeInTheDocument();
    expect(within(screen.getByTestId('hotel-role-pms')).getByText('Agent 未发现')).toBeInTheDocument();
    expect(within(screen.getByTestId('hotel-role-revenue')).getByText('待绑定')).toBeInTheDocument();
    expect(screen.getByText(/不代表已接入业务平台，也不证明已具备执行权限/)).toBeInTheDocument();
    expect(screen.getByText(/ChatGPT 云端自动交接未启用/)).toBeInTheDocument();
    expect(screen.queryByText('其他门店结果')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '本店知识 1 条' }));
    expect(props.onNavigate).toHaveBeenLastCalledWith('knowledge');
    fireEvent.click(screen.getByRole('button', { name: '已启用日程 1 项' }));
    expect(props.onNavigate).toHaveBeenLastCalledWith('schedules');
    fireEvent.click(screen.getByRole('button', { name: /本店阻塞任务/ }));
    expect(props.onTask).toHaveBeenLastCalledWith('blocked');
    fireEvent.click(screen.getByRole('button', { name: /本店失败任务/ }));
    expect(props.onTask).toHaveBeenLastCalledWith('failed');
  });
});
