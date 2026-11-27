import { useState, type FormEvent } from 'react';
import { Clock, Pause, Play, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { hotelApi } from '@/lib/hotel-api';
import { HOTEL_ROLES, type HotelProperty, type HotelRole, type HotelSchedule, type HotelTaskTemplate, type SaveHotelScheduleInput } from '../../../shared/hotel';
import type { ActionRunner } from './TaskEditor';
import { Empty, Field, Notice, Panel } from './components';
import { dateTime, lines, roleLabels } from './helpers';

const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function scheduleInput(schedule: HotelSchedule): SaveHotelScheduleInput {
  const { lastSlot: _slot, lastTaskId: _task, lastError: _error, updatedAt: _updated, ...input } = schedule;
  return input;
}

export function Schedules({ property, schedules, templates, busy, run, onTask }: { property: HotelProperty; schedules: HotelSchedule[]; templates: HotelTaskTemplate[]; busy: boolean; run: ActionRunner; onTask: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = schedules.find((entry) => entry.id === selectedId);
  return <div className="space-y-4">
    <Notice>计划在本机 ClawX 运行时检查并生成任务；关闭应用期间不会在云端继续执行。已生成任务按岗位权限排队，同一计划时段不会重复创建。</Notice>
    <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">本店时区：{property.timezone}</p><Button onClick={() => { setSelectedId(null); setEditing(true); }}><Plus className="mr-2 h-4 w-4" />新建定时任务</Button></div>
    {editing && <ScheduleEditor key={selected?.id ?? 'new'} property={property} schedule={selected} templates={templates} busy={busy} run={run} onClose={() => setEditing(false)} />}
    {!editing && schedules.length === 0 ? <Empty title="还没有酒店定时任务" description="可安排经营日报、竞对调查或内容制作。已有 ChatGPT 定时任务不会被自动复制到这里。" /> : <div className="grid gap-4 xl:grid-cols-2">{schedules.map((schedule) => <article key={schedule.id} className="space-y-4 rounded-xl border bg-card p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{schedule.name}</h2><p className="mt-1 text-sm text-muted-foreground">{roleLabels[schedule.template.role]}</p></div><Badge variant={schedule.enabled ? 'success' : 'secondary'}>{schedule.enabled ? '已启用' : '已暂停'}</Badge></div><p className="flex items-start gap-2 text-sm"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{schedule.frequency === 'interval' ? `每 ${schedule.intervalMinutes} 分钟` : `${schedule.frequency === 'daily' ? '每天' : schedule.weekdays.map((day) => weekdayNames[day]).join('、')} ${schedule.time}`} · {schedule.timezone}</p><p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{schedule.template.objective}</p>{schedule.lastError && <Notice error>{schedule.lastError}</Notice>}<div className="border-t pt-3 text-xs text-muted-foreground"><p>最近任务时段：{schedule.lastSlot ?? '尚未运行'}</p><p className="mt-1">最近修改：{dateTime(schedule.updatedAt)}</p>{schedule.lastTaskId && <button onClick={() => onTask(schedule.lastTaskId!)} className="mt-2 text-primary underline">查看最近生成的任务</button>}</div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => { setSelectedId(schedule.id); setEditing(true); }}>编辑计划</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(schedule.enabled ? '计划已暂停' : '计划已启用', () => hotelApi.saveSchedule({ ...scheduleInput(schedule), enabled: !schedule.enabled }))}>{schedule.enabled ? <Pause className="mr-1.5 h-4 w-4" /> : <Play className="mr-1.5 h-4 w-4" />}{schedule.enabled ? '暂停' : '启用'}</Button></div></article>)}</div>}
  </div>;
}

function ScheduleEditor({ property, schedule, templates, busy, run, onClose }: { property: HotelProperty; schedule?: HotelSchedule; templates: HotelTaskTemplate[]; busy: boolean; run: ActionRunner; onClose: () => void }) {
  const [name, setName] = useState(schedule?.name ?? '');
  const [frequency, setFrequency] = useState<HotelSchedule['frequency']>(schedule?.frequency ?? 'daily');
  const [time, setTime] = useState(schedule?.time ?? '09:00');
  const [weekdays, setWeekdays] = useState(schedule?.weekdays ?? [1]);
  const [intervalMinutes, setIntervalMinutes] = useState(schedule?.intervalMinutes ?? 60);
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false);
  const [role, setRole] = useState<HotelRole>(schedule?.template.role ?? 'supervisor');
  const [title, setTitle] = useState(schedule?.template.title ?? '');
  const [objective, setObjective] = useState(schedule?.template.objective ?? '');
  const [criteria, setCriteria] = useState((schedule?.template.acceptanceCriteria ?? ['注明数据来源、统计周期和缺失项', '给出可核实的结果与建议']).join('\n'));
  const availableTemplates = templates.filter((entry) => ['read', 'analysis', 'code'].includes(entry.action));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await run('定时任务已保存', () => hotelApi.saveSchedule({ ...(schedule ? { id: schedule.id } : {}), propertyId: property.id, name, enabled, frequency, time, timezone: property.timezone, weekdays, intervalMinutes, template: { title, objective, role, action: 'analysis', acceptanceCriteria: lines(criteria), inputs: `按 ${property.timezone} 的计划执行，城市为 ${property.city}。所有数据须注明实际统计周期。` } }));
    if (saved) onClose();
  }

  return <Panel title={schedule ? '编辑定时任务' : '新建定时任务'} description="保存后可按需要启用；这不会替换现有平台定时任务。"><form onSubmit={submit} className="space-y-4">
    <Field label="计划名称"><Input required value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：每日经营检查" /></Field>
    <div className="grid gap-4 md:grid-cols-3"><Field label="重复周期"><Select value={frequency} onChange={(event) => setFrequency(event.target.value as HotelSchedule['frequency'])}><option value="daily">每天</option><option value="weekly">每周</option><option value="interval">固定间隔</option></Select></Field>{frequency === 'interval' ? <Field label="间隔（分钟）"><Input required min={5} max={10080} type="number" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))} /></Field> : <Field label={`执行时间（${property.timezone}）`}><Input required type="time" value={time} onChange={(event) => setTime(event.target.value)} /></Field>}<Field label="负责岗位"><Select value={role} onChange={(event) => setRole(event.target.value as HotelRole)}>{HOTEL_ROLES.map((entry) => <option value={entry} key={entry}>{roleLabels[entry]}</option>)}</Select></Field></div>
    {frequency === 'weekly' && <fieldset><legend className="mb-2 text-sm font-medium">执行日期</legend><div className="flex flex-wrap gap-4">{weekdayNames.map((label, index) => <label className="flex items-center gap-2 text-sm" key={label}><input type="checkbox" checked={weekdays.includes(index)} onChange={(event) => setWeekdays(event.target.checked ? [...weekdays, index] : weekdays.filter((value) => value !== index))} />{label}</label>)}</div></fieldset>}
    <Field label="使用任务模板"><Select defaultValue="" onChange={(event) => { const template = availableTemplates.find((entry) => entry.id === event.target.value); if (template) { setTitle(template.title); setObjective(template.objective); setRole(template.role); setCriteria(template.acceptanceCriteria.join('\n')); } }}><option value="">自定义计划内容</option>{availableTemplates.map((template) => <option value={template.id} key={template.id}>{template.title}</option>)}</Select></Field>
    <Field label="生成的任务标题"><Input required value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="任务目标"><Textarea required value={objective} onChange={(event) => setObjective(event.target.value)} /></Field><Field label="验收条件（每行一项）"><Textarea required value={criteria} onChange={(event) => setCriteria(event.target.value)} /></Field>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />保存后启用此计划</label>
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !name.trim() || !title.trim() || !objective.trim() || (frequency === 'weekly' && weekdays.length === 0)}>保存计划</Button></div>
  </form></Panel>;
}
