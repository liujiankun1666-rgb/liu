import { useState, type FormEvent } from 'react';
import { ArrowLeft, ExternalLink, FilePenLine, GitBranch, Play, RotateCcw, Square, Wrench } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useChatStore } from '@/stores/chat';
import { hotelApi } from '@/lib/hotel-api';
import type { HotelContent, HotelTask, HotelTaskResult } from '../../../shared/hotel';
import type { ActionRunner } from './TaskEditor';
import { contentQuality } from './helpers';
import { Field, Notice, Panel, SafeLink, StatusBadge } from './components';
import { actionLabels, dateTime, lines, roleLabels, statusLabel } from './helpers';

interface Props {
  task: HotelTask;
  tasks: HotelTask[];
  busy: boolean;
  run: ActionRunner;
  onClose: () => void;
  onEdit: () => void;
  onChild: () => void;
  onSelect: (id: string) => void;
  onReuse?: () => void;
}

export function TaskDetail({ task, tasks, busy, run, onClose, onEdit, onChild, onSelect, onReuse }: Props) {
  const [note, setNote] = useState('');
  const [publicationUrl, setPublicationUrl] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [uncertainAcknowledged, setUncertainAcknowledged] = useState(false);
  const navigate = useNavigate();
  const switchSession = useChatStore((state) => state.switchSession);
  const latestAttempt = task.attempts.at(-1);
  const children = tasks.filter((entry) => entry.parentTaskId === task.id);
  const readAction = ['analysis', 'read', 'code'].includes(task.action);
  const active = !['succeeded', 'cancelled'].includes(task.status);
  const canEdit = !task.delegation && !task.reviewTarget && ['draft', 'queued', 'needs_review', 'blocked', 'failed', 'awaiting_approval'].includes(task.status);
  const score = task.result?.content ? contentQuality(task.result.content) : 0;

  async function decision(action: 'review' | 'approve', verdict: string) {
    const ok = await run(action === 'review' ? (verdict === 'accept' ? '结果已验收' : '已退回补充') : verdict === 'approve' ? '方案已批准，等待执行条件' : '方案已拒绝', () => hotelApi.taskAction(task.id, action, { decision: verdict, note, actor: 'owner', planVersion: task.planVersion }));
    if (ok) setNote('');
  }

  return <div className="space-y-4" data-testid="hotel-task-detail">
    <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft className="mr-2 h-4 w-4" />返回任务列表</Button>
    <Panel title={task.title} description={`${roleLabels[task.role]} · ${actionLabels[task.action]} · 方案 v${task.planVersion}`} actions={<StatusBadge status={task.status} />}>
      <div className="space-y-4">
        <p className="whitespace-pre-wrap break-words text-sm leading-7">{task.objective}</p>
        {task.blockedReason && <Notice>{task.blockedReason}</Notice>}
        {task.inputs && <div className="rounded-lg bg-muted/50 p-3"><p className="mb-1 text-xs font-medium text-muted-foreground">输入与限制</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{task.inputs}</p></div>}
        <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">负责人</dt><dd className="mt-1 break-all">{task.assignedAgentId || '按岗位绑定分派'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">建立时间（北京）</dt><dd className="mt-1">{dateTime(task.createdAt)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">截止时间（北京）</dt><dd className="mt-1">{dateTime(task.deadline)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">尝试次数</dt><dd className="mt-1">{task.attempts.length} / {task.maxAttempts}</dd></div>
        </dl>
        <div><h3 className="mb-2 text-sm font-medium">验收条件</h3><ul className="list-inside list-disc space-y-1.5 text-sm text-muted-foreground">{task.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul></div>
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {canEdit && <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}><FilePenLine className="mr-1.5 h-4 w-4" />修改任务</Button>}
          {task.status === 'draft' && <Button size="sm" disabled={busy} onClick={() => void run('任务已加入队列', () => hotelApi.taskAction(task.id, 'queue'))}><Play className="mr-1.5 h-4 w-4" />加入执行队列</Button>}
          {task.status === 'queued' && <Button size="sm" disabled={busy} onClick={() => void run('已检查任务执行条件', () => hotelApi.taskAction(task.id, 'dispatch'))}><Play className="mr-1.5 h-4 w-4" />现在尝试执行</Button>}
          {['failed', 'blocked'].includes(task.status) && readAction && <Button size="sm" variant="outline" disabled={busy || task.attempts.length >= task.maxAttempts || (latestAttempt?.outcome === 'uncertain' && !uncertainAcknowledged)} onClick={() => void run('任务已重新排队', () => hotelApi.taskAction(task.id, 'retry', { acknowledgeUncertain: uncertainAcknowledged }))}><RotateCcw className="mr-1.5 h-4 w-4" />检查后重试</Button>}
          {active && !task.reviewTarget && !task.delegation && !['running', 'needs_review'].includes(task.status) && <Button size="sm" variant="outline" disabled={busy} onClick={onChild}><GitBranch className="mr-1.5 h-4 w-4" />拆分子任务</Button>}
          {['failed', 'blocked'].includes(task.status) && <Button size="sm" variant="outline" disabled={busy || !!task.technicalTaskId} onClick={() => void run('技术排查任务已建立', () => hotelApi.taskAction(task.id, 'technical'))}><Wrench className="mr-1.5 h-4 w-4" />{task.technicalTaskId ? '已转技术排查' : '转技术排查'}</Button>}
          {latestAttempt?.sessionKey && <Button size="sm" variant="outline" onClick={() => { switchSession(latestAttempt.sessionKey); navigate('/'); }}><ExternalLink className="mr-1.5 h-4 w-4" />查看执行会话</Button>}
          {active && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmCancel(!confirmCancel)}><Square className="mr-1.5 h-3.5 w-3.5" />取消任务</Button>}
        </div>
        {latestAttempt && (latestAttempt.outcome === 'uncertain' || task.status === 'running') && <div className="space-y-3 rounded-lg border p-3"><p className="text-sm text-muted-foreground">先核对已有会话的执行结果，避免网络中断后重复派单。</p><Button size="sm" variant="outline" disabled={busy} onClick={() => void run('已核对原执行会话', () => hotelApi.taskAction(task.id, 'reconcile'))}>核对执行会话</Button>{latestAttempt.outcome === 'uncertain' && <label className="flex items-start gap-2 text-sm leading-relaxed"><input type="checkbox" className="mt-1" checked={uncertainAcknowledged} onChange={(event) => setUncertainAcknowledged(event.target.checked)} />已检查上次运行，确认可重新尝试</label>}</div>}
        {confirmCancel && <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><p className="flex-1 text-sm">取消后不再接受该次任务回传；已发生的外部操作需要另行核实。</p><Button size="sm" variant="destructive" disabled={busy} onClick={() => void run('任务已取消', () => hotelApi.taskAction(task.id, 'cancel'))}>确认取消任务</Button></div>}
      </div>
    </Panel>
    {task.reviewTarget && <Notice>这项工作是独立验收任务。验收对象：<button className="font-medium underline" onClick={() => onSelect(task.reviewTarget!.taskId)}>{tasks.find((entry) => entry.id === task.reviewTarget!.taskId)?.title ?? task.reviewTarget.taskId}</button>。总管会核对执行证据，审批经营变更仍由老板处理。</Notice>}
    {(task.parentTaskId || task.dependencies.length > 0 || children.length > 0) && <Panel title="协作关系" description="前置任务和下属工作必须完成验收，才能形成完整结论。">
      <div className="space-y-3 text-sm">
        {task.parentTaskId && <p>所属主任务：<button className="text-primary underline" onClick={() => onSelect(task.parentTaskId!)}>{tasks.find((entry) => entry.id === task.parentTaskId)?.title ?? task.parentTaskId}</button></p>}
        {task.dependencies.map((id) => { const dependency = tasks.find((entry) => entry.id === id); return <div key={id} className="flex items-center justify-between gap-3"><button className="text-left text-primary underline" onClick={() => onSelect(id)}>等待：{dependency?.title ?? id}</button>{dependency && <StatusBadge status={dependency.status} />}</div>; })}
        {children.map((child) => <div key={child.id} className="flex items-center justify-between gap-3"><button className="text-left text-primary underline" onClick={() => onSelect(child.id)}>下属工作：{child.title}</button><StatusBadge status={child.status} /></div>)}
      </div>
    </Panel>}
    {task.delegation && <Panel title="已确认的分派方案" description={`确认于 ${dateTime(task.delegation.expandedAt)} · 已建立 ${task.delegation.childTaskIds.length} 项子任务`}><p className="whitespace-pre-wrap text-sm leading-7">{task.delegation.result.summary}</p><p className="mt-3 text-sm text-muted-foreground">子任务结果验收完成后，总管继续汇总本项工作。</p></Panel>}
    {task.plan && <Panel title={`经营变更方案 · v${task.planVersion}`} description="审批仅适用于这里展示的具体方案。修改目标或变更内容后必须重新审批。">
      <div className="space-y-4 text-sm">
        <p><span className="font-medium">影响对象：</span>{task.plan.target}</p>
        <div className="grid gap-4 md:grid-cols-2"><div className="rounded-lg border p-3"><h3 className="mb-2 font-medium text-muted-foreground">变更前</h3><p className="whitespace-pre-wrap break-words">{task.plan.before}</p></div><div className="rounded-lg border border-primary/30 bg-primary/5 p-3"><h3 className="mb-2 font-medium">变更后</h3><p className="whitespace-pre-wrap break-words">{task.plan.after}</p></div></div>
        <p className="whitespace-pre-wrap"><span className="font-medium">依据：</span>{task.plan.reason}</p>
        <p className="whitespace-pre-wrap"><span className="font-medium">回退办法：</span>{task.plan.rollback}</p>
        {task.approval && <Notice>{task.approval.decision === 'approve' ? '老板已批准' : '老板已拒绝'} · {dateTime(task.approval.decidedAt)} · {task.approval.note}。审批记录不等于后台已执行。</Notice>}
        {task.status === 'awaiting_approval' && <div className="space-y-3 border-t pt-4"><Field label="审批意见"><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明批准范围或拒绝理由" /></Field><div className="flex flex-wrap gap-2"><Button disabled={busy || !note.trim()} onClick={() => void decision('approve', 'approve')}>批准当前方案</Button><Button variant="outline" disabled={busy || !note.trim()} onClick={() => void decision('approve', 'reject')}>拒绝当前方案</Button></div><p className="text-xs leading-relaxed text-muted-foreground">经营写入适配器当前未接入，批准后仍需等待接入和执行回执。抖音创作不会自动发布。</p></div>}
      </div>
    </Panel>}
    {task.result && <Panel title="结果与依据" description={`统计周期：${task.result.dataPeriod || '未注明'} · ${task.resultOrigin === 'gateway' ? 'Agent 执行会话回传' : task.resultOrigin === 'owner' ? '老板手工录入' : task.resultOrigin === 'bridge' ? '桥接客户端回传' : '回传来源未注明'}`}>
      <div className="space-y-5 text-sm">
        <p className="whitespace-pre-wrap break-words leading-7">{task.result.summary}</p>
        {task.result.assessment && <Notice>总管验收建议：{task.result.assessment.decision === 'accept' ? '通过' : '退回补充'} · {task.result.assessment.note}</Notice>}
        {task.result.missingItems.length > 0 && <Notice><p className="font-medium">尚未完成或缺少的数据</p><ul className="mt-1 list-inside list-disc">{task.result.missingItems.map((item, index) => <li key={index}>{item}</li>)}</ul></Notice>}
        <div className="grid gap-5 md:grid-cols-2"><div><h3 className="mb-2 font-medium">完成项</h3><ul className="list-inside list-disc space-y-1.5 text-muted-foreground">{task.result.completedItems.map((item, index) => <li key={index}>{item}</li>)}</ul></div><div><h3 className="mb-2 font-medium">建议后续行动</h3><ul className="list-inside list-disc space-y-1.5 text-muted-foreground">{task.result.suggestedNextActions.map((item, index) => <li key={index}>{item}</li>)}</ul></div></div>
        <div><h3 className="mb-2 font-medium">核验说明</h3><p className="whitespace-pre-wrap text-muted-foreground">{task.result.verificationNotes}</p></div>
        <div><h3 className="mb-2 font-medium">数据来源</h3>{task.result.sources.length === 0 ? <p className="text-muted-foreground">未提供来源，验收前需要补齐。</p> : <ul className="space-y-2">{task.result.sources.map((source, index) => <li key={index}><SafeLink href={source.uri}>{source.label}</SafeLink><span className="ml-2 text-xs text-muted-foreground">采集于 {dateTime(source.observedAt)}</span></li>)}</ul>}</div>
        {task.result.artifacts.length > 0 && <div><h3 className="mb-2 font-medium">交付材料</h3><ul className="space-y-2">{task.result.artifacts.map((artifact, index) => <li key={index}><SafeLink href={artifact.uri}>{artifact.label}</SafeLink></li>)}</ul></div>}
        {task.result.plannedTasks && task.result.plannedTasks.length > 0 && <section className="space-y-4 rounded-xl border p-4"><div><h3 className="font-semibold">总管提出的分派方案</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">核对目标与依赖后确认；任务中心会持久化子任务，并按现有岗位绑定执行。</p></div><div className="space-y-3">{task.result.plannedTasks.map((planned, index) => <div className="space-y-2 rounded-lg border p-3" key={index}><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium">{index + 1}. {planned.title}</h4><span className="text-xs text-muted-foreground">{roleLabels[planned.role]} · {actionLabels[planned.action]}</span></div><p className="whitespace-pre-wrap text-sm leading-relaxed">{planned.objective}</p>{planned.inputs && <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">输入与限制：{planned.inputs}</p>}<ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">{planned.acceptanceCriteria.map((criterion, criterionIndex) => <li key={criterionIndex}>{criterion}</li>)}</ul>{planned.dependsOn.length > 0 && <p className="text-xs text-muted-foreground">等待任务 {planned.dependsOn.map((dependency) => dependency + 1).join('、')} 完成验收</p>}</div>)}</div>{task.status === 'needs_review' && task.role === 'supervisor' && !task.reviewTarget && !task.delegation && <Button disabled={busy || task.result.missingItems.length > 0} onClick={() => void run('方案已确认，子任务已进入队列', () => hotelApi.taskAction(task.id, 'delegate'))}>确认方案并派给现有 Agent</Button>}</section>}
        {task.result.content && <ContentResult content={task.result.content} />}
        {task.role === 'douyin' && task.status === 'succeeded' && task.result.content && onReuse && <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 p-3"><p className="flex-1 text-sm leading-relaxed text-muted-foreground">把这条已验收内容作为结构模板。新草稿需要补充新资料、重新制作和评分，保留独立的审核与发布记录。</p><Button variant="outline" disabled={busy} onClick={onReuse}>复用已验收内容</Button></div>}
        {task.review && <div className="rounded-lg bg-muted/50 p-3">{task.review.actor === 'supervisor' ? '总管验收' : '老板验收'} · {task.review.decision === 'accept' ? '已通过' : '已退回补充'} · {dateTime(task.review.reviewedAt)}<p className="mt-1">{task.review.note}</p></div>}
        {task.status === 'needs_review' && <div className="space-y-3 border-t pt-4"><Field label="验收意见"><Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="逐项核对验收条件，说明通过依据或需要补充的内容" /></Field><div className="flex flex-wrap gap-2"><Button disabled={busy || !note.trim() || task.result.missingItems.length > 0} onClick={() => void decision('review', 'accept')}>{task.result.plannedTasks?.length ? '仅保存讨论结果' : '通过验收'}</Button><Button variant="outline" disabled={busy || !note.trim()} onClick={() => void decision('review', 'return')}>退回补充</Button></div>{task.result.missingItems.length > 0 && <p className="text-xs text-muted-foreground">仍有缺失项，补齐后才能通过验收。</p>}</div>}
        {task.result.content && !task.result.content.publication && <div className="space-y-3 border-t pt-4"><h3 className="font-medium">人工发布记录</h3><p className="text-sm text-muted-foreground">本系统不向抖音发送内容。视频已由你人工发布后，在此记录链接；只有验收通过且评分达到 80 分的方案可以登记。</p><Field label="已发布视频链接"><Input type="url" value={publicationUrl} onChange={(event) => setPublicationUrl(event.target.value)} placeholder="https://…" /></Field><Button variant="outline" disabled={busy || task.status !== 'succeeded' || score < 80 || task.role !== 'douyin' || !/^https:\/\//.test(publicationUrl)} onClick={() => void run('人工发布记录已保存', () => hotelApi.taskAction(task.id, 'record-publication', { url: publicationUrl }))}>记录人工发布</Button>{score < 80 && <Notice>当前质量评分 {score} 分，未达到 80 分，不能登记为已发布。</Notice>}</div>}
      </div>
    </Panel>}
    {task.status === 'running' && latestAttempt && <ResultForm task={task} busy={busy} run={run} />}
    {task.attempts.length > 0 && <Panel title="执行记录"><div className="space-y-3">{[...task.attempts].reverse().map((attempt) => <div key={attempt.id} className="rounded-lg border p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">第 {attempt.number} 次尝试</span><span className="text-muted-foreground">{dateTime(attempt.startedAt)}{attempt.endedAt ? ` — ${dateTime(attempt.endedAt)}` : ''}</span></div><p className="mt-1 text-xs text-muted-foreground">{attempt.outcome ? ({ returned: '结果已回传', failed: '执行失败', uncertain: '执行状态不确定，需要核实', cancelled: '已取消' }[attempt.outcome] ?? attempt.outcome) : `执行中 · 超时检查时间 ${dateTime(attempt.leaseExpiresAt)}`}</p>{attempt.error && <p className="mt-2 break-words text-destructive">{attempt.error}</p>}</div>)}</div></Panel>}
    <TaskHistory task={task} />
    <p className="break-all text-xs text-muted-foreground">任务编号：{task.id} · 当前状态：{statusLabel(task.status)}</p>
  </div>;
}


function TaskHistory({ task }: { task: HotelTask }) {
  if (!task.resultHistory?.length && !task.planHistory?.length) return null;
  const originLabels = { gateway: 'Agent 执行会话', owner: '老板手工录入', bridge: '桥接客户端' };
  return <Panel title="历史方案与回传" description="修改或重跑后，旧方案、审批、结果与验收意见仍可追溯。历史批准不适用于当前新版本。">
    <div className="space-y-3">
      {!!task.planHistory?.length && <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">方案版本记录 · {task.planHistory.length} 条</summary><div className="mt-4 space-y-4">{[...task.planHistory].reverse().map((entry, index) => <article className="space-y-3 rounded-lg bg-muted/30 p-4 text-sm" key={`${entry.planVersion}-${index}`}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">v{entry.planVersion} · {entry.title}</h3><span className="text-xs text-muted-foreground">归档于 {dateTime(entry.recordedAt)}</span></div><p className="whitespace-pre-wrap leading-relaxed">{entry.objective}</p><p className="text-xs text-muted-foreground">{roleLabels[entry.role]} · {actionLabels[entry.action]}</p>{entry.plan && <div className="space-y-2 rounded-lg border p-3"><p>影响对象：{entry.plan.target}</p><p className="whitespace-pre-wrap">变更前：{entry.plan.before}</p><p className="whitespace-pre-wrap">变更后：{entry.plan.after}</p><p className="whitespace-pre-wrap">依据：{entry.plan.reason}</p><p className="whitespace-pre-wrap">回退办法：{entry.plan.rollback}</p></div>}{entry.approval && <p className="rounded-lg border p-3">历史审批：{entry.approval.decision === 'approve' ? '批准' : '拒绝'} · {dateTime(entry.approval.decidedAt)}<span className="mt-1 block text-muted-foreground">{entry.approval.note}</span></p>}<details><summary className="cursor-pointer text-xs text-muted-foreground">查看该版本完整交接信息</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(entry, null, 2)}</pre></details></article>)}</div></details>}
      {!!task.resultHistory?.length && <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">执行结果记录 · {task.resultHistory.length} 条</summary><div className="mt-4 space-y-4">{[...task.resultHistory].reverse().map((entry, index) => <article className="space-y-3 rounded-lg bg-muted/30 p-4 text-sm" key={`${entry.attemptId}-${index}`}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{originLabels[entry.origin]}</h3><span className="text-xs text-muted-foreground">归档于 {dateTime(entry.recordedAt)}</span></div><p className="whitespace-pre-wrap leading-relaxed">{entry.result.summary}</p><p className="text-xs text-muted-foreground">统计周期：{entry.result.dataPeriod}</p>{entry.result.missingItems.length > 0 && <Notice>当次缺失项：{entry.result.missingItems.join('；')}</Notice>}{entry.review && <p>当次验收：{entry.review.actor === 'supervisor' ? '总管' : '老板'} · {entry.review.decision === 'accept' ? '通过' : '退回'} · {entry.review.note}</p>}<ul className="space-y-1">{entry.result.sources.map((source, sourceIndex) => <li key={sourceIndex}><SafeLink href={source.uri}>{source.label}</SafeLink><span className="ml-2 text-xs text-muted-foreground">{dateTime(source.observedAt)}</span></li>)}</ul>{entry.result.content && <details><summary className="cursor-pointer text-sm font-medium">查看当次视频素材与评分</summary><div className="mt-3"><ContentResult content={entry.result.content} /></div></details>}<details><summary className="cursor-pointer text-xs text-muted-foreground">查看该次完整交接信息</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(entry, null, 2)}</pre></details></article>)}</div></details>}
    </div>
  </Panel>;
}

function ContentResult({ content }: { content: HotelContent }) {
  const score = contentQuality(content);
  const topics = { hotel: '电竞酒店经营', games: '游戏', hardware: '电脑配置与外设', service: '酒店服务' };
  return <section className="space-y-4 rounded-xl border p-4" data-testid="hotel-content-result">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{content.title}</h3><p className="mt-1 text-xs text-muted-foreground">{topics[content.topic]} · {content.durationSeconds} 秒 · {content.aspectRatio}</p></div><div className={score >= 80 ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'font-semibold text-amber-700 dark:text-amber-300'}>{score} / 100</div></div>
    <div className="grid gap-4 xl:grid-cols-2">{([['开场钩子', content.hook], ['视频脚本', content.script], ['分镜', content.storyboard], ['字幕', content.subtitles], ['9:16 封面方案', content.coverPlan], ['发布文案', content.caption]] as const).map(([label, value]) => <div key={label}><h4 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h4><p className="whitespace-pre-wrap break-words leading-relaxed">{value}</p></div>)}</div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="py-2 font-medium">评分项</th><th className="py-2 font-medium">分数</th><th className="py-2 font-medium">理由</th></tr></thead><tbody>{content.scores.map((entry, index) => <tr key={index} className="border-b last:border-0"><td className="py-2 pr-3">{entry.criterion}</td><td className="whitespace-nowrap py-2 pr-3">{entry.score} / {entry.maximum}</td><td className="py-2 text-muted-foreground">{entry.reason}</td></tr>)}</tbody></table></div>
    {content.improvements.length > 0 && <div><h4 className="mb-1 font-medium">优化建议</h4><ul className="list-inside list-disc space-y-1 text-muted-foreground">{content.improvements.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    {content.publication && <p>人工发布记录：<SafeLink href={content.publication.url} /> · {dateTime(content.publication.recordedAt)}</p>}
  </section>;
}

function ResultForm({ task, busy, run }: { task: HotelTask; busy: boolean; run: ActionRunner }) {
  const [summary, setSummary] = useState('');
  const [completed, setCompleted] = useState('');
  const [missing, setMissing] = useState('');
  const [period, setPeriod] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [sourceUri, setSourceUri] = useState('');
  const [sourceObservedAt, setSourceObservedAt] = useState('');
  const [verification, setVerification] = useState('');
  const [nextActions, setNextActions] = useState('');
  const [structured, setStructured] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    let result: HotelTaskResult;
    try {
      result = structured.trim() ? JSON.parse(structured) as HotelTaskResult : {
        summary, completedItems: lines(completed), missingItems: lines(missing), dataPeriod: period,
        sources: sourceUri ? [{ label: sourceLabel, uri: sourceUri, observedAt: sourceObservedAt ? new Date(`${sourceObservedAt}:00+08:00`).toISOString() : '' }] : [],
        artifacts: [], verificationNotes: verification, suggestedNextActions: lines(nextActions),
      };
    } catch {
      setError('结构化结果不是有效 JSON，请检查后重试。');
      return;
    }
    const attemptId = task.attempts.at(-1)?.id;
    if (!attemptId) return;
    await run('结果已回传，等待验收', () => hotelApi.returnResult(task.id, attemptId, result));
  }

  return <details className="rounded-xl border bg-card p-5"><summary className="cursor-pointer font-medium">人工补录执行结果</summary><p className="mb-4 mt-2 text-sm leading-relaxed text-muted-foreground">Agent 正常回传会自动进入验收。需要人工接管时，可补录本次尝试的结果；不会直接标记成功。</p><form onSubmit={submit} className="space-y-4">
    {error && <Notice error>{error}</Notice>}
    <Field label="结果摘要"><Textarea required={!structured.trim()} value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
    <div className="grid gap-4 md:grid-cols-2"><Field label="完成了什么（每行一项）"><Textarea required={!structured.trim()} value={completed} onChange={(event) => setCompleted(event.target.value)} /></Field><Field label="缺失或未完成项（每行一项）"><Textarea value={missing} onChange={(event) => setMissing(event.target.value)} /></Field></div>
    <Field label="统计周期"><Input required={!structured.trim()} value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="例如：2026-11-26 经营日；无数据统计请写不适用" /></Field>
    <div className="grid gap-4 md:grid-cols-2"><Field label="来源名称"><Input required={!structured.trim()} value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} /></Field><Field label="来源链接或材料位置"><Input required={!structured.trim()} value={sourceUri} onChange={(event) => setSourceUri(event.target.value)} /></Field></div>
    <Field label="来源采集时间（北京时间）"><Input type="datetime-local" required={!structured.trim()} value={sourceObservedAt} onChange={(event) => setSourceObservedAt(event.target.value)} /></Field>
    <Field label="核验说明"><Textarea required={!structured.trim()} value={verification} onChange={(event) => setVerification(event.target.value)} /></Field>
    <Field label="建议后续行动（每行一项）"><Textarea value={nextActions} onChange={(event) => setNextActions(event.target.value)} /></Field>
    <details><summary className="cursor-pointer text-sm text-muted-foreground">导入 Agent 完整结果（含指标或视频素材）</summary><Textarea className="mt-2 font-mono text-xs" rows={8} value={structured} onChange={(event) => setStructured(event.target.value)} aria-label="完整结果 JSON" placeholder="粘贴约定交接格式中的 result 对象；有内容时以此完整对象为准。" /></details>
    <Button disabled={busy} type="submit">提交结果待验收</Button>
  </form></details>;
}
