import { useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hotelApi } from '@/lib/hotel-api';
import { HOTEL_ACTIONS, HOTEL_ROLES, type CreateHotelTaskInput, type HotelAction, type HotelKnowledge, type HotelPlan, type HotelRole, type HotelTask, type HotelTaskTemplate } from '../../../shared/hotel';
import { Field, Notice, Panel } from './components';
import { actionLabels, lines, roleLabels } from './helpers';

export type ActionRunner = (label: string, work: () => Promise<unknown>) => Promise<boolean>;

export interface TaskEditorProps {
  propertyId: string;
  tasks: HotelTask[];
  knowledge: HotelKnowledge[];
  templates: HotelTaskTemplate[];
  task?: HotelTask;
  initialTemplate?: HotelTaskTemplate;
  initialParentId?: string;
  busy: boolean;
  run: ActionRunner;
  onClose: () => void;
  onCreated: (id: string) => void;
}

const emptyPlan: HotelPlan = { target: '', before: '', after: '', reason: '', rollback: '' };
const businessWrites = new Set<HotelAction>(['price_change', 'publish', 'payment', 'refund', 'message', 'config_change']);

export function TaskEditor({ propertyId, tasks, knowledge, templates, task, initialTemplate, initialParentId, busy, run, onClose, onCreated }: TaskEditorProps) {
  const [title, setTitle] = useState(task?.title ?? initialTemplate?.title ?? '');
  const [objective, setObjective] = useState(task?.objective ?? initialTemplate?.objective ?? '');
  const [role, setRole] = useState<HotelRole>(task?.role ?? initialTemplate?.role ?? 'supervisor');
  const [action, setAction] = useState<HotelAction>(task?.action ?? initialTemplate?.action ?? 'analysis');
  const [priority, setPriority] = useState<HotelTask['priority']>(task?.priority ?? 'normal');
  const [inputs, setInputs] = useState(task?.inputs ?? '');
  const [criteria, setCriteria] = useState((task?.acceptanceCriteria ?? initialTemplate?.acceptanceCriteria ?? ['说明数据来源、统计周期和缺失项', '给出可执行建议及影响']).join('\n'));
  const [parentTaskId, setParentTaskId] = useState(task?.parentTaskId ?? initialParentId ?? '');
  const [dependencies, setDependencies] = useState<string[]>(task?.dependencies ?? []);
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>(task?.knowledgeIds ?? []);
  const [deadline, setDeadline] = useState(task?.deadline ? new Date(new Date(task.deadline).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) : '');
  const [plan, setPlan] = useState<HotelPlan>(task?.plan ?? emptyPlan);
  const requestKey = useRef(crypto.randomUUID());
  const writeAction = businessWrites.has(action);

  function applyTemplate(id: string) {
    const selected = templates.find((entry) => entry.id === id);
    if (!selected) return;
    setTitle(selected.title);
    setObjective(selected.objective);
    setRole(selected.role);
    setAction(selected.action);
    setCriteria(selected.acceptanceCriteria.join('\n'));
    requestKey.current = crypto.randomUUID();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: CreateHotelTaskInput = {
      propertyId, title: title.trim(), objective: objective.trim(), role, action, priority,
      inputs: inputs.trim(), acceptanceCriteria: lines(criteria), dependencies, knowledgeIds,
      idempotencyKey: requestKey.current,
      ...(parentTaskId ? { parentTaskId } : {}),
      ...(deadline ? { deadline: new Date(`${deadline}:00+08:00`).toISOString() } : {}),
      ...(writeAction ? { plan } : {}),
    };
    let taskId = task?.id;
    const saved = await run(task ? '任务方案已更新' : '任务已建立', async () => {
      if (task) {
        const { propertyId: _propertyId, idempotencyKey: _key, parentTaskId: _parent, ...update } = input;
        const result = await hotelApi.updateTask(task.id, update);
        taskId = result.task.id;
      } else {
        const result = await hotelApi.createTask(input);
        taskId = result.task.id;
      }
    });
    if (saved && taskId) {
      requestKey.current = crypto.randomUUID();
      onCreated(taskId);
      onClose();
    }
  }

  return <Panel title={task ? '修改任务与方案' : '交给总管一项工作'} description={task ? '修改执行方案后，之前的审批不再适用于新版本。' : '先把目标、依据和验收条件写清楚，再加入执行队列。'} actions={<Button variant="ghost" size="icon" aria-label="关闭任务编辑" onClick={onClose}><X className="h-4 w-4" /></Button>}>
    <form onSubmit={submit} className="space-y-5" data-testid="hotel-task-form">
      {!task && <Field label="使用岗位模板"><Select defaultValue={initialTemplate?.id ?? ''} onChange={(event) => applyTemplate(event.target.value)}><option value="">自定义任务</option>{templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</Select></Field>}
      <Field label="任务标题"><Input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：分析本周入住率并提出改进方案" /></Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="负责岗位"><Select value={role} onChange={(event) => setRole(event.target.value as HotelRole)}>{HOTEL_ROLES.map((entry) => <option key={entry} value={entry}>{roleLabels[entry]}</option>)}</Select></Field>
        <Field label="任务类型"><Select value={action} onChange={(event) => setAction(event.target.value as HotelAction)}>{HOTEL_ACTIONS.map((entry) => <option key={entry} value={entry}>{actionLabels[entry]}</option>)}</Select></Field>
        <Field label="优先级"><Select value={priority} onChange={(event) => setPriority(event.target.value as HotelTask['priority'])}><option value="normal">正常</option><option value="high">优先</option><option value="urgent">紧急</option></Select></Field>
      </div>
      <Field label="希望达到的结果"><Textarea required rows={3} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="说明问题、希望做出的判断，以及不能改变的条件。" /></Field>
      <Field label="已有资料与限制"><Textarea rows={3} value={inputs} onChange={(event) => setInputs(event.target.value)} placeholder="提供已核实的数据、文件位置或补充要求。不要填账号密码、密钥或客人身份信息。" /></Field>
      <Field label="验收条件" hint="每行一项；Agent 返回后逐项核对。"><Textarea required rows={3} value={criteria} onChange={(event) => setCriteria(event.target.value)} /></Field>
      {writeAction && <div className="space-y-4 rounded-lg border border-amber-200 p-4 dark:border-amber-900">
        <Notice>这是一份待审批的经营变更方案。批准不会直接修改后台；执行适配器尚未完成接入时，任务会保持阻塞。</Notice>
        <Field label="影响对象"><Input required value={plan.target} onChange={(event) => setPlan({ ...plan, target: event.target.value })} placeholder="具体门店、平台、房型、入住日期或内容" /></Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="变更前"><Textarea required value={plan.before} onChange={(event) => setPlan({ ...plan, before: event.target.value })} /></Field>
          <Field label="变更后"><Textarea required value={plan.after} onChange={(event) => setPlan({ ...plan, after: event.target.value })} /></Field>
        </div>
        <Field label="变更依据"><Textarea required value={plan.reason} onChange={(event) => setPlan({ ...plan, reason: event.target.value })} /></Field>
        <Field label="回退与补救办法"><Textarea required value={plan.rollback} onChange={(event) => setPlan({ ...plan, rollback: event.target.value })} /></Field>
      </div>}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">关联任务、知识与截止时间</summary>
        <div className="mt-4 space-y-4">
          {!task && <Field label="所属主任务"><Select value={parentTaskId} onChange={(event) => setParentTaskId(event.target.value)}><option value="">独立任务</option>{tasks.filter((entry) => !entry.reviewTarget && !entry.delegation && !['succeeded', 'cancelled', 'running', 'needs_review'].includes(entry.status)).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</Select></Field>}
          <Field label="截止时间（北京时间）"><Input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></Field>
          <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">前置任务（验收完成后才执行）</legend>{tasks.filter((entry) => entry.id !== task?.id && entry.id !== parentTaskId).length === 0 ? <p className="text-sm text-muted-foreground">暂无可关联任务</p> : tasks.filter((entry) => entry.id !== task?.id && entry.id !== parentTaskId).map((entry) => <label key={entry.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dependencies.includes(entry.id)} onChange={(event) => setDependencies(event.target.checked ? [...dependencies, entry.id] : dependencies.filter((id) => id !== entry.id))} />{entry.title}</label>)}</fieldset>
          <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">引用本店知识</legend>{knowledge.length === 0 ? <p className="text-sm text-muted-foreground">可先在知识库补充酒店资料、房型和经营制度。</p> : knowledge.map((entry) => <label key={entry.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={knowledgeIds.includes(entry.id)} onChange={(event) => setKnowledgeIds(event.target.checked ? [...knowledgeIds, entry.id] : knowledgeIds.filter((id) => id !== entry.id))} />{entry.title} · v{entry.revisions.at(-1)?.version ?? 1}</label>)}</fieldset>
        </div>
      </details>
      <div className="flex items-center justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !title.trim() || !objective.trim() || lines(criteria).length === 0}>{busy ? '正在保存…' : task ? '保存新版本' : '建立任务'}</Button></div>
    </form>
  </Panel>;
}
