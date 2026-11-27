import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Loader2, MessageSquare, Plus, RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useChatStore } from '@/stores/chat';
import { hotelApi } from '@/lib/hotel-api';
import { HOTEL_ROLES, HOTEL_STATUS_LABELS, type HotelSnapshotResponse, type HotelTask, type HotelTaskTemplate } from '../../../shared/hotel';
import { Bindings } from './Bindings';
import { Integrations } from './Integrations';
import { Knowledge } from './Knowledge';
import { Overview, type WorkflowKind } from './Overview';
import { Schedules } from './Schedules';
import { TaskDetail } from './TaskDetail';
import { TaskEditor, type ActionRunner } from './TaskEditor';
import { Empty, Notice, StatusBadge } from './components';
import { actionLabels, dateTime, roleLabels } from './helpers';
import { contentReuseInput } from './content-reuse';

type Tab = 'overview' | 'tasks' | 'bindings' | 'knowledge' | 'schedules' | 'integrations';
const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: '经营概览' }, { id: 'tasks', label: '任务与审批' },
  { id: 'bindings', label: '岗位绑定' }, { id: 'knowledge', label: '知识库' },
  { id: 'schedules', label: '定时任务' }, { id: 'integrations', label: '接入与门店' },
];

export function Hotel() {
  const [response, setResponse] = useState<HotelSnapshotResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [propertyId, setPropertyId] = useState('xingcheng-aigong');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ taskId?: string; parentId?: string; template?: HotelTaskTemplate } | null>(null);
  const [loadedAt, setLoadedAt] = useState('');
  const sequence = useRef(0);
  const mounted = useRef(true);
  const workflowKeys = useRef<Partial<Record<WorkflowKind, string>>>({});
  const reuseKeys = useRef<Record<string, string>>({});
  const navigate = useNavigate();
  const switchSession = useChatStore((state) => state.switchSession);

  const refresh = useCallback(async (showLoading = false) => {
    const current = ++sequence.current;
    if (showLoading) setLoading(true);
    try {
      const next = await hotelApi.snapshot();
      if (!next.snapshot?.properties?.length || !Array.isArray(next.snapshot.tasks)) throw new Error('酒店总管快照格式不完整，请检查本机服务。');
      if (mounted.current && current === sequence.current) {
        setResponse(next);
        setError('');
        setLoadedAt(new Date().toISOString());
      }
    } catch (failure) {
      if (mounted.current && current === sequence.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current && current === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [refresh]);

  const run: ActionRunner = useCallback(async (label, work) => {
    if (busy) return false;
    setBusy(true);
    try {
      await work();
      await refresh();
      toast.success(label);
      return true;
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setError(message);
      toast.error(message);
      return false;
    } finally { setBusy(false); }
  }, [busy, refresh]);

  const property = response?.snapshot.properties.find((entry) => entry.id === propertyId) ?? response?.snapshot.properties[0];
  const tasks = response?.snapshot.tasks.filter((entry) => entry.propertyId === property?.id) ?? [];
  const knowledge = response?.snapshot.knowledge.filter((entry) => entry.propertyId === property?.id) ?? [];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const editingTask = editor?.taskId ? tasks.find((task) => task.id === editor.taskId) : undefined;
  const supervisorBinding = response?.snapshot.bindings.find((binding) => binding.propertyId === property?.id && binding.role === 'supervisor');
  const supervisor = response?.agents.find((agent) => agent.id === supervisorBinding?.agentId);
  const reviews = tasks.filter((task) => ['needs_review', 'awaiting_approval'].includes(task.status)).length;

  function selectTask(id: string) { setSelectedTaskId(id); setEditor(null); setTab('tasks'); }
  function switchProperty(id: string) { setPropertyId(id); setSelectedTaskId(null); setEditor(null); }
  async function createWorkflow(kind: WorkflowKind) {
    if (!property) return;
    const key = workflowKeys.current[kind] ?? crypto.randomUUID();
    workflowKeys.current[kind] = key;
    let taskId: string | undefined;
    const saved = await run('协作任务已建立', async () => {
      const result = await hotelApi.workflow(property.id, kind, key);
      taskId = result.tasks[0]?.id;
    });
    if (saved) { delete workflowKeys.current[kind]; setTab('tasks'); if (taskId) setSelectedTaskId(taskId); }
  }

  async function reuseContent(task: HotelTask) {
    if (!property) return;
    const key = reuseKeys.current[task.id] ?? crypto.randomUUID();
    reuseKeys.current[task.id] = key;
    let createdId: string | undefined;
    const saved = await run('内容模板已复用，新草稿待补充资料', async () => {
      const result = await hotelApi.createTask(contentReuseInput(task, property.id, key));
      createdId = result.task.id;
    });
    if (saved && createdId) { delete reuseKeys.current[task.id]; selectTask(createdId); setEditor({ taskId: createdId }); }
  }

  return <div className="mx-auto max-w-[1440px] space-y-5 pb-8" data-testid="hotel-page">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2"><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /><h1 className="text-2xl font-semibold tracking-tight" data-testid="hotel-page-title">酒店总管</h1><Badge variant="outline">本机任务中心</Badge></div><p className="text-sm text-muted-foreground">讨论目标、派发工作、核验结果，把每项经营决策留在同一处。</p></div>
      <div className="flex flex-wrap items-center gap-2">{response && property && <Select aria-label="当前门店" className="w-52" value={property.id} onChange={(event) => switchProperty(event.target.value)}>{response.snapshot.properties.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</Select>}<Button variant="outline" size="icon" disabled={loading || busy} aria-label="刷新酒店数据" onClick={() => void refresh(true)}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button></div>
    </header>
    {error && <Notice error>{error}{response && <p className="mt-1">当前保留上次成功读取的数据，刷新成功后更新。</p>}</Notice>}
    {!response || !property ? loading ? <div className="flex items-center justify-center gap-3 rounded-xl border py-24 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />正在读取本机酒店任务中心…</div> : <Empty title="暂时无法读取任务中心" description="检查本机 ClawX 服务后重试。未连接时不会生成演示经营数据。"><Button onClick={() => void refresh(true)}>重新读取</Button></Empty> : <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3"><div className="flex flex-wrap items-center gap-3 text-sm"><span className={`h-2 w-2 rounded-full ${response.gateway.state === 'running' ? 'bg-emerald-500' : 'bg-amber-500'}`} /><span>Agent 运行服务{response.gateway.state === 'running' ? '已连接' : '待连接'}</span><span className="text-xs text-muted-foreground">上次更新 {dateTime(loadedAt)} · 北京时间</span></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { if (supervisor) { switchSession(supervisor.mainSessionKey || `agent:${supervisor.id}:main`); navigate('/'); } else setTab('bindings'); }}><MessageSquare className="mr-1.5 h-4 w-4" />{supervisor ? '和总管讨论' : '绑定你的总管'}</Button><Button size="sm" onClick={() => { setTab('tasks'); setSelectedTaskId(null); setEditor({}); }} disabled={busy}><Plus className="mr-1.5 h-4 w-4" />新建任务</Button></div></div>
      <div className="overflow-x-auto border-b"><div role="tablist" aria-label="酒店工作区" className="flex min-w-max gap-1">{tabs.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} aria-controls={`hotel-panel-${item.id}`} id={`hotel-tab-${item.id}`} key={item.id} onClick={() => setTab(item.id)} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${tab === item.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{item.label}{item.id === 'tasks' && reviews > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">{reviews}</span>}</button>)}</div></div>
      <div role="tabpanel" id={`hotel-panel-${tab}`} aria-labelledby={`hotel-tab-${tab}`} key={`${property.id}-${tab}`}>
        {tab === 'overview' && <Overview property={property} response={response} busy={busy} onTask={selectTask} onWorkflow={(kind) => void createWorkflow(kind)} onBindings={() => setTab('bindings')} />}
        {tab === 'tasks' && (editor?.taskId && !editingTask ? <Notice>任务已保存，暂未读到最新记录。请先刷新酒店数据，再继续编辑。</Notice> : editor ? <TaskEditor key={editingTask ? `${editingTask.id}-${editingTask.planVersion}` : editor.parentId ?? editor.template?.id ?? 'new'} propertyId={property.id} tasks={tasks} knowledge={knowledge} templates={response.templates} task={editingTask} initialTemplate={editor.template} initialParentId={editor.parentId} busy={busy} run={run} onClose={() => setEditor(null)} onCreated={selectTask} /> : selectedTask ? <TaskDetail key={selectedTask.id} task={selectedTask} tasks={tasks} busy={busy} run={run} onClose={() => setSelectedTaskId(null)} onEdit={() => setEditor({ taskId: selectedTask.id })} onChild={() => setEditor({ parentId: selectedTask.id })} onSelect={selectTask} onReuse={() => void reuseContent(selectedTask)} /> : <TaskList tasks={tasks} templates={response.templates} busy={busy} onTask={selectTask} onTemplate={(template) => setEditor({ template })} onRun={() => void run('已检查当前门店待执行任务', () => hotelApi.runReady(property.id))} />)}
        {tab === 'bindings' && <Bindings propertyId={property.id} bindings={response.snapshot.bindings} agents={response.agents} busy={busy} run={run} />}
        {tab === 'knowledge' && <Knowledge propertyId={property.id} entries={knowledge} busy={busy} run={run} />}
        {tab === 'schedules' && <Schedules property={property} schedules={response.snapshot.schedules.filter((entry) => entry.propertyId === property.id)} templates={response.templates} busy={busy} run={run} onTask={selectTask} />}
        {tab === 'integrations' && <Integrations response={response} property={property} busy={busy} run={run} onProperty={switchProperty} />}
      </div>
    </>}
  </div>;
}

function TaskList({ tasks, templates, busy, onTask, onTemplate, onRun }: { tasks: HotelTask[]; templates: HotelTaskTemplate[]; busy: boolean; onTask: (id: string) => void; onTemplate: (template: HotelTaskTemplate) => void; onRun: () => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const filtered = tasks.filter((task) => (status === 'all' || task.status === status) && (role === 'all' || task.role === role) && `${task.title} ${task.objective}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
      { label: '待执行', count: tasks.filter((entry) => ['draft', 'queued'].includes(entry.status)).length },
      { label: '执行中', count: tasks.filter((entry) => entry.status === 'running').length },
      { label: '待验收 / 审批', count: tasks.filter((entry) => ['needs_review', 'awaiting_approval'].includes(entry.status)).length },
      { label: '阻塞 / 失败', count: tasks.filter((entry) => ['blocked', 'failed'].includes(entry.status)).length },
    ].map((item) => <div key={item.label} className="rounded-lg border bg-card px-4 py-3"><span className="text-xs text-muted-foreground">{item.label}</span><p className="mt-1 text-xl font-semibold">{item.count}</p></div>)}</div>
    <div className="flex flex-wrap items-center gap-3"><div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="搜索任务" placeholder="搜索任务目标或标题" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select className="w-40" aria-label="按任务状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(HOTEL_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select><Select className="w-48" aria-label="按负责岗位筛选" value={role} onChange={(event) => setRole(event.target.value)}><option value="all">全部岗位</option>{HOTEL_ROLES.map((value) => <option value={value} key={value}>{roleLabels[value]}</option>)}</Select><Button variant="outline" disabled={busy} onClick={onRun}>检查执行队列</Button></div>
    {filtered.length === 0 ? <Empty title={tasks.length ? '没有符合筛选条件的任务' : '还没有经营任务'} description="选择岗位模板，或从经营概览建立完整工作流。每项任务独立记录执行、回传和验收。" /> : <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr>{['任务', '负责岗位', '状态', '进度与更新时间'].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{filtered.map((task) => <tr key={task.id} className="border-b transition-colors last:border-0 hover:bg-muted/30"><td className="max-w-[28rem] px-4 py-4"><button className="text-left font-medium text-primary hover:underline" onClick={() => onTask(task.id)}>{task.title}</button><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{task.parentTaskId ? '子任务 · ' : ''}{actionLabels[task.action]}{task.priority !== 'normal' ? task.priority === 'urgent' ? ' · 紧急' : ' · 优先' : ''}</p></td><td className="px-4 py-4 text-muted-foreground">{roleLabels[task.role]}</td><td className="px-4 py-4"><StatusBadge status={task.status} /></td><td className="max-w-xs px-4 py-4"><p className="line-clamp-1 text-xs text-muted-foreground">{task.blockedReason ?? (task.result ? '已有回传结果' : task.attempts.length ? `已尝试 ${task.attempts.length} 次` : task.dependencies.length ? `${task.dependencies.length} 项前置依赖` : '尚未执行')}</p><p className="mt-1 text-xs text-muted-foreground">{dateTime(task.updatedAt)}</p></td></tr>)}</tbody></table></div>}
    <details className="rounded-xl border bg-card p-5" open={tasks.length === 0}><summary className="cursor-pointer font-medium">各岗位任务模板</summary><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{templates.map((template) => <button key={template.id} disabled={busy} onClick={() => onTemplate(template)} className="rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"><p className="text-xs text-muted-foreground">{roleLabels[template.role]}</p><h3 className="mt-2 text-sm font-medium">{template.title}</h3><p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{template.objective}</p></button>)}</div></details>
  </div>;
}
