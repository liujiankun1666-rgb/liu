import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { hotelApi } from '@/lib/hotel-api';
import { HOTEL_ROLES, HOTEL_ROLE_LABELS, type CreateHotelTaskInput, type HotelProperty, type HotelSnapshotResponse } from '../../../shared/hotel';
import type { ActionRunner } from './TaskEditor';
import { Field, Notice, Panel, StatusBadge } from './components';
import { roleDescriptions } from './helpers';

interface WorkbenchProps {
  property: HotelProperty;
  response: HotelSnapshotResponse;
  busy: boolean;
  run: ActionRunner;
  onTask: (id: string) => void;
  onNavigate: (tab: 'tasks' | 'bindings' | 'knowledge' | 'schedules' | 'integrations') => void;
}

interface Submission {
  input: CreateHotelTaskInput;
  taskId?: string;
  queued?: boolean;
}

export function Workbench({ property, response, busy, run, onTask, onNavigate }: WorkbenchProps) {
  const [brief, setBrief] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  // Retain the exact request across a lost response, including its knowledge references.
  const submissions = useRef(new Map<string, Submission>());
  const { snapshot, agents } = response;
  const tasks = snapshot.tasks.filter((task) => task.propertyId === property.id);
  const knowledge = snapshot.knowledge.filter((entry) => entry.propertyId === property.id);
  const schedules = snapshot.schedules.filter((entry) => entry.propertyId === property.id && entry.enabled);
  const reviews = tasks.filter((task) => task.status === 'needs_review');
  const approvals = tasks.filter((task) => task.status === 'awaiting_approval');
  const active = tasks.filter((task) => task.status === 'queued' || task.status === 'running');
  const blocked = tasks.filter((task) => task.status === 'blocked' || task.status === 'failed');
  const attention = [...reviews, ...approvals, ...blocked].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const supervisorBinding = snapshot.bindings.find((entry) => entry.propertyId === property.id && entry.role === 'supervisor');
  const supervisor = agents.find((entry) => entry.id === supervisorBinding?.agentId);
  const waitingReason = !supervisorBinding?.agentId ? '总管尚未绑定，提交后会等待岗位配置。'
    : !supervisor ? '绑定的总管 Agent 当前未发现，提交后需核对岗位配置。'
      : !supervisorBinding.enabled ? '总管派单已暂停，提交后会等待启用。'
        : response.gateway.state !== 'running' ? 'Gateway 当前未运行，提交后会等待本机执行服务。' : '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    const goal = brief.trim();
    if (busy || pending.current || !goal) return;
    pending.current = true;
    setSubmitting(true);
    const fingerprint = JSON.stringify([property.id, goal]);
    let submission = submissions.current.get(fingerprint);
    if (!submission) {
      submission = {
        input: {
          propertyId: property.id,
          title: `总管任务：${goal.split('\n')[0]}`.slice(0, 120),
          objective: goal,
          role: 'supervisor',
          action: 'analysis',
          priority: 'normal',
          inputs: '先核对目标、本店知识、可用资料与缺项。需要协作时，以 plannedTasks 返回各岗位的目标、输入、依赖和验收标准，交由老板在现有任务详情确认派发。子任务验收后，汇总结果、来源、未完成项和待决事项。技术问题交给 Codex 技术岗；具体经营写入继续走原审批流程。',
          acceptanceCriteria: [
            '逐条回应本批目标，注明事实来源、时间范围和未核实事项，不编造数据或接入状态。',
            '需要协作时提出可审阅的岗位分工、依赖和验收标准；不得把建议写成已执行。',
            '汇总已完成项、缺项、需要老板决定的事项和关联任务编号。',
          ],
          knowledgeIds: [...knowledge]
            .sort((a, b) => (b.revisions.at(-1)?.updatedAt ?? '').localeCompare(a.revisions.at(-1)?.updatedAt ?? ''))
            .slice(0, 100)
            .map((entry) => entry.id),
          idempotencyKey: crypto.randomUUID(),
        },
      };
      submissions.current.set(fingerprint, submission);
    }
    const request = submission;
    try {
      const saved = await run('目标已保存并加入总管队列', async () => {
        if (!request.taskId) {
          const result = await hotelApi.createTask(request.input);
          request.taskId = result.task.id;
        }
        if (!request.queued) {
          await hotelApi.taskAction(request.taskId, 'queue');
          request.queued = true;
        }
      });
      if (saved) {
        submissions.current.delete(fingerprint);
        setBrief('');
      }
    } finally {
      pending.current = false;
      setSubmitting(false);
      // A queue failure must not strand the successfully persisted draft.
      if (request.taskId) onTask(request.taskId);
    }
  }

  return <div className="space-y-5" data-testid="hotel-workbench">
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Panel title="交给总管，一起推进" description={`为${property.name}写下工作目标，或粘贴与 ChatGPT 整理好的整份任务单。`}>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <Field label="交给总管的目标" hint="可写目标、时间范围、已有资料、允许动作与验收要求。优先引用本店最近更新的知识，可在任务详情调整；缺少资料时记录缺项。">
            <Textarea required maxLength={30000} rows={7} value={brief} disabled={busy || submitting} onChange={(event) => setBrief(event.target.value)} placeholder="例如：整理本周需要优先处理的经营问题，结合已有资料提出各岗位工作安排，最后给我一份带来源和待决事项的汇总。" />
          </Field>
          <p className="text-sm leading-relaxed text-muted-foreground">提交后先由总管分析。分派方案在任务详情确认，经营变更仍按具体方案审批。</p>
          {waitingReason && <Notice>{waitingReason}目标仍可保存。<button type="button" className="ml-1 font-medium underline underline-offset-2" onClick={() => onNavigate('bindings')}>查看岗位绑定</button></Notice>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">当前为本机批次交接，ChatGPT 云端自动交接未启用。</span>
            <Button type="submit" disabled={busy || submitting || !brief.trim()}><Send className="mr-2 h-4 w-4" />{submitting ? '正在提交…' : '提交给总管'}</Button>
          </div>
        </form>
      </Panel>

      <Panel title="当前待办" description="仅统计当前门店已保存的任务和配置。" actions={<Button size="sm" variant="ghost" onClick={() => onNavigate('tasks')}>全部任务<ArrowRight className="ml-1 h-4 w-4" /></Button>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: '待执行 / 执行中', items: active }, { label: '待验收', items: reviews }, { label: '待审批', items: approvals }, { label: '阻塞 / 失败', items: blocked },
          ].map(({ label, items }) => <button type="button" key={label} className="rounded-lg border px-2 py-3 text-center transition-colors hover:bg-muted/50" onClick={() => items[0] ? onTask(items[0].id) : onNavigate('tasks')}><span className="block text-xs text-muted-foreground">{label}</span><span className="mt-1 block text-xl font-semibold tabular-nums">{items.length}</span></button>)}
        </div>
        <div className="mt-4 divide-y">
          {attention.length ? attention.slice(0, 4).map((task) => <button type="button" key={task.id} className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:text-primary" onClick={() => onTask(task.id)}><span className="min-w-0 break-words">{task.title}</span><span className="shrink-0"><StatusBadge status={task.status} /></span></button>) : <p className="py-4 text-sm text-muted-foreground">目前没有待验收、待审批或异常任务。</p>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-4">
          <Button variant="outline" size="sm" onClick={() => onNavigate('knowledge')}>本店知识 {knowledge.length} 条</Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate('schedules')}>已启用日程 {schedules.length} 项</Button>
        </div>
      </Panel>
    </div>

    <Panel title="八个岗位，复用现有 Agent" description="这里显示岗位配置与已发现的模型。绑定或启用派单不代表已接入业务平台，也不证明已具备执行权限；每项任务仍需检查工具与真实来源。" actions={<Button size="sm" variant="outline" onClick={() => onNavigate('bindings')}>管理岗位绑定</Button>}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {HOTEL_ROLES.map((role) => {
          const binding = snapshot.bindings.find((entry) => entry.propertyId === property.id && entry.role === role);
          const agent = agents.find((entry) => entry.id === binding?.agentId);
          const status = !binding?.agentId ? '待绑定' : !agent ? 'Agent 未发现' : binding.enabled ? '派单已启用' : '派单已暂停';
          return <article key={role} data-testid={`hotel-role-${role}`} className="space-y-3 rounded-lg border p-4">
            <div className="space-y-2"><h3 className="text-sm font-semibold">{HOTEL_ROLE_LABELS[role]}</h3><Badge variant={binding?.agentId && !agent ? 'warning' : 'secondary'}>{status}</Badge></div>
            <p className="text-xs leading-relaxed text-muted-foreground">{roleDescriptions[role]}</p>
            <div className="space-y-1 border-t pt-3 text-xs leading-relaxed">
              <p className="break-words">Agent：{agent ? `${agent.name} · ${agent.id}` : binding?.agentId || '尚未选择'}</p>
              <p className="break-words text-muted-foreground">模型：{agent?.modelDisplay || (agent ? '配置未提供' : '待发现 Agent 后读取')}</p>
            </div>
          </article>;
        })}
      </div>
    </Panel>

    <section className="grid gap-4 rounded-xl border bg-card p-5 text-sm md:grid-cols-3" aria-label="系统分工">
      <div><h2 className="font-semibold">ChatGPT · 策略与统筹</h2><p className="mt-1 leading-relaxed text-muted-foreground">讨论目标、整理批次任务单，结合汇总复盘下一步。</p></div>
      <div><h2 className="font-semibold">ClawX · 管理与执行</h2><p className="mt-1 leading-relaxed text-muted-foreground">保存任务、管理岗位、派发、回传、验收及审批记录。</p></div>
      <div><h2 className="font-semibold">Codex · 技术建设</h2><p className="mt-1 leading-relaxed text-muted-foreground">承接程序、配置、修复与验证任务，交回技术成果。</p></div>
    </section>
  </div>;
}
