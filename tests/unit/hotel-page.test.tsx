import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Hotel } from '../../src/pages/Hotel';
import { TaskDetail } from '../../src/pages/Hotel/TaskDetail';
import type { HotelSnapshotResponse, HotelTask } from '../../shared/hotel';

const { fetchMock, successMock, errorMock, switchSessionMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), successMock: vi.fn(), errorMock: vi.fn(), switchSessionMock: vi.fn() }));
vi.mock('@/lib/host-api', () => ({ hostApiFetch: (...args: unknown[]) => fetchMock(...args) }));
vi.mock('@/stores/chat', () => ({ useChatStore: (selector: (state: { switchSession: typeof switchSessionMock }) => unknown) => selector({ switchSession: switchSessionMock }) }));
vi.mock('sonner', () => ({ toast: { success: successMock, error: errorMock } }));

function response(): HotelSnapshotResponse {
  return { success: true, snapshot: { schemaVersion: 1, revision: 0, properties: [{ id: 'xingcheng-aigong', name: '兴城爱攻电竞酒店', city: '兴城市', timezone: 'Asia/Shanghai', createdAt: '2026-11-27T00:00:00Z' }], bindings: [], tasks: [], knowledge: [], schedules: [], audit: [] }, agents: [], gateway: { state: 'stopped' }, capabilities: [], templates: [] };
}
function task(): HotelTask {
  return { id: 'video-task', propertyId: 'xingcheng-aigong', title: '电竞酒店视频制作', objective: '制作可审核的视频', role: 'douyin', action: 'analysis', priority: 'normal', status: 'succeeded', dependencies: [], inputs: '', acceptanceCriteria: ['资料完整'], knowledgeIds: [], idempotencyKey: 'video-key', requestHash: 'sample', planVersion: 1, attempts: [], maxAttempts: 3, createdAt: '2026-11-27T00:00:00Z', updatedAt: '2026-11-27T00:00:00Z', result: { summary: '已生成视频方案', completedItems: ['全部素材'], missingItems: [], sources: [{ label: '房型配置', uri: 'https://example.com/rooms', observedAt: '2026-11-27T00:00:00Z' }], artifacts: [], dataPeriod: '不适用', verificationNotes: '已核对资料', suggestedNextActions: ['完善脚本'], content: { topic: 'hotel', title: '酒店体验', hook: '三十秒体验', script: '视频脚本', storyboard: '分镜', subtitles: '字幕', coverPlan: '竖屏封面', caption: '发布文案', durationSeconds: 45, aspectRatio: '9:16', scores: [{ criterion: '信息完整', score: 40, maximum: 50, reason: '结构完整' }, { criterion: '吸引力', score: 39, maximum: 50, reason: '钩子需优化' }], improvements: ['优化开场钩子'] } } };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/hotel/snapshot') return response();
    if (path.startsWith('/api/hotel/report?')) return { success: true, report: { propertyId: 'xingcheng-aigong', date: '2026-11-27', timezone: 'Asia/Shanghai', metrics: { availableRooms: null, occupiedRooms: null, roomRevenue: null, orders: null, refunds: null, costs: null }, occupancyRate: null, averageDailyRate: null, revenuePerAvailableRoom: null, warnings: [], pendingApprovals: [], blockedTasks: [], completedTasks: [] } };
    return { success: true };
  });
});

describe('Hotel operations UI', () => {
  it('shows unavailable business data as pending connection instead of zero', async () => {
    render(<MemoryRouter><Hotel /></MemoryRouter>);
    expect(await screen.findByText('该日期尚无已验收经营指标')).toBeInTheDocument();
    expect(screen.getAllByText('待接入')).toHaveLength(4);
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '绑定你的总管' })).toBeInTheDocument();
  });

  it('keeps a failed task submission open and never reports success', async () => {
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((path: string, init: RequestInit) => path === '/api/hotel/tasks' ? Promise.resolve({ success: false, error: '保存被拒绝' }) : base(path, init));
    render(<MemoryRouter><Hotel /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '新建任务' }));
    fireEvent.change(screen.getByLabelText('任务标题'), { target: { value: '经营分析' } });
    fireEvent.change(screen.getByLabelText('希望达到的结果'), { target: { value: '核对入住情况并给出建议' } });
    fireEvent.click(screen.getByRole('button', { name: '建立任务' }));
    expect(await screen.findByText('保存被拒绝')).toBeInTheDocument();
    expect(screen.getByDisplayValue('经营分析')).toBeInTheDocument();
    expect(successMock).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalledWith('保存被拒绝');
  });

  it('shows a connection failure without a fabricated dashboard', async () => {
    fetchMock.mockRejectedValue(new Error('本机服务不可用'));
    render(<MemoryRouter><Hotel /></MemoryRouter>);
    expect(await screen.findByText('暂时无法读取任务中心')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('本机服务不可用');
    expect(screen.queryByText('客房收入')).not.toBeInTheDocument();
  });

  it('blocks manual publication below 80 and does not call the backend', async () => {
    const run = vi.fn();
    render(<MemoryRouter><TaskDetail task={task()} tasks={[task()]} busy={false} run={run} onClose={vi.fn()} onEdit={vi.fn()} onChild={vi.fn()} onSelect={vi.fn()} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('已发布视频链接'), { target: { value: 'https://www.douyin.com/video/123' } });
    expect(screen.getByRole('button', { name: '记录人工发布' })).toBeDisabled();
    expect(screen.getByText('当前质量评分 79 分，未达到 80 分，不能登记为已发布。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '记录人工发布' }));
    expect(run).not.toHaveBeenCalled();
  });

  it('requires reconciliation acknowledgement before retrying an uncertain attempt', async () => {
    const value = task();
    value.status = 'blocked';
    value.result = undefined;
    value.attempts = [{ id: 'attempt', number: 1, sessionKey: 'agent:test:hotel:video-task:attempt', dispatchKey: 'dispatch', startedAt: value.createdAt, leaseExpiresAt: value.createdAt, outcome: 'uncertain' }];
    const run = vi.fn().mockResolvedValue(true);
    render(<MemoryRouter><TaskDetail task={value} tasks={[value]} busy={false} run={run} onClose={vi.fn()} onEdit={vi.fn()} onChild={vi.fn()} onSelect={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '检查后重试' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('已检查上次运行，确认可重新尝试'));
    expect(screen.getByRole('button', { name: '检查后重试' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '核对执行会话' }));
    await waitFor(() => expect(run).toHaveBeenCalledWith('已核对原执行会话', expect.any(Function)));
  });
  it('shows the supervisor plan and delegates only after an explicit confirmation', async () => {
    const value = task();
    value.role = 'supervisor'; value.status = 'needs_review';
    value.result!.content = undefined;
    value.result!.plannedTasks = [{ title: '读取本周房态', objective: '核对日期与房态', role: 'pms', action: 'read', inputs: '仅使用有权限的数据', acceptanceCriteria: ['保留来源'], dependsOn: [] }];
    const run = vi.fn(async (_label: string, work: () => Promise<unknown>) => { await work(); return true; });
    render(<MemoryRouter><TaskDetail task={value} tasks={[value]} busy={false} run={run} onClose={vi.fn()} onEdit={vi.fn()} onChild={vi.fn()} onSelect={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('1. 读取本周房态')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认方案并派给现有 Agent' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/hotel/tasks/video-task/delegate', expect.objectContaining({ method: 'POST' })));
  });

});
