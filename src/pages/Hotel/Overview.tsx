import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, ClipboardList, TrendingUp, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hotelApi } from '@/lib/hotel-api';
import type { HotelProperty, HotelReport, HotelSnapshotResponse, HotelTask } from '../../../shared/hotel';
import { Empty, Notice, Panel, SafeLink, StatusBadge } from './components';
import { dateTime, roleLabels } from './helpers';
import { ReportComparison } from './ReportComparison';

export type WorkflowKind = 'daily_operations' | 'pricing_review' | 'content_review';

export function Overview({ property, response, busy, onTask, onWorkflow, onBindings }: { property: HotelProperty; response: HotelSnapshotResponse; busy: boolean; onTask: (id: string) => void; onWorkflow: (kind: WorkflowKind) => void; onBindings: () => void }) {
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: property.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [reportState, setReportState] = useState<{ report: HotelReport | null; error: string; key: string }>({ report: null, error: '', key: '' });
  const reportKey = `${property.id}:${date}:${response.snapshot.revision}`;
  useEffect(() => {
    let active = true;
    if (!date) return;
    void hotelApi.report(property.id, date).then((next) => {
      if (active) setReportState({ report: next.report, error: next.report ? '' : '日报数据格式无效，请稍后刷新。', key: reportKey });
    }).catch((error) => { if (active) setReportState({ report: null, error: error instanceof Error ? error.message : String(error), key: reportKey }); });
    return () => { active = false; };
  }, [property.id, date, reportKey]);
  const report = reportState.key === reportKey ? reportState.report : null;
  const tasks = response.snapshot.tasks.filter((entry) => entry.propertyId === property.id);
  const waiting = tasks.filter((task) => ['awaiting_approval', 'needs_review'].includes(task.status));
  const blocked = tasks.filter((task) => ['blocked', 'failed'].includes(task.status));
  const enabledRoles = response.snapshot.bindings.filter((binding) => binding.propertyId === property.id && binding.enabled && binding.agentId).length;
  const money = (value: number | undefined | null) => value == null ? '待接入' : `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const tiles = [
    { label: '客房收入', value: money(report?.metrics.roomRevenue?.value), hint: report?.metrics.roomRevenue?.basis ?? '等待有来源的经营数据' },
    { label: '入住率', value: report?.occupancyRate == null ? '待接入' : `${(report.occupancyRate * 100).toFixed(1)}%`, hint: '已入住房间 / 可售房间' },
    { label: '平均房价', value: money(report?.averageDailyRate), hint: '客房收入 / 已入住房间' },
    { label: '订单数', value: report?.metrics.orders ? report.metrics.orders.value.toLocaleString('zh-CN') : '待接入', hint: report?.metrics.orders?.basis ?? '以数据来源的订单口径为准' },
  ];
  const metricNames: Record<string, string> = { availableRooms: '可售房间', occupiedRooms: '已入住房间', roomRevenue: '客房收入', orders: '订单数', refunds: '退款', costs: '成本' };
  const metrics = report ? Object.values(report.metrics).filter((metric) => metric !== null) : [];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">经营概览</h2><p className="mt-1 text-sm text-muted-foreground">{property.city} · {property.timezone} · 数据仅取自已验收的结果</p></div><label className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4 text-muted-foreground" /><span className="sr-only">经营日期</span><Input aria-label="经营日期" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-40" /></label></div>
    {reportState.key === reportKey && reportState.error && <Notice error>日报暂时读取失败：{reportState.error}</Notice>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{tiles.map((tile) => <article key={tile.label} className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">{tile.label}</p><p className={`my-3 font-semibold tracking-tight ${tile.value === '待接入' ? 'text-xl text-muted-foreground' : 'text-2xl'}`}>{tile.value}</p><p className="text-xs leading-relaxed text-muted-foreground">{tile.hint}</p></article>)}</div>
    {report?.warnings && report.warnings.length > 0 && <Notice><ul className="list-inside list-disc space-y-1">{report.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></Notice>}
    <div className="grid gap-4 md:grid-cols-3">{([
      { kind: 'daily_operations', title: '经营日报', detail: '分派经营、渠道、财务与客服检查，汇总已验收的结果。', icon: ClipboardList },
      { kind: 'pricing_review', title: '定价调查', detail: `核对入住情况、携程表现和${property.city}竞对，再讨论调价方案。`, icon: TrendingUp },
      { kind: 'content_review', title: '抖音制作', detail: '生成四类主题的视频方案、素材和评分，保留人工审核。', icon: Video },
    ] as const).map((workflow) => <button key={workflow.kind} disabled={busy} onClick={() => onWorkflow(workflow.kind)} className="group rounded-xl border bg-card p-5 text-left transition-colors hover:bg-muted/40 disabled:opacity-50"><div className="flex items-center justify-between"><workflow.icon className="h-5 w-5 text-primary" /><ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" /></div><h3 className="mt-4 font-semibold">建立{workflow.title}工作流</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{workflow.detail}</p></button>)}</div>
    <div className="grid gap-5 xl:grid-cols-2"><Panel title="等你决策" description="执行结果先验收，经营变更按具体方案审批。">{waiting.length ? <TaskLinks tasks={waiting} onTask={onTask} /> : <Empty title="暂无待处理审批或验收" description="任务回传结果、经营变更方案提交后，会出现在这里。" />}</Panel><Panel title="需要关注" description={`${enabledRoles} / 8 个岗位已启用派单。`} actions={<Button variant="outline" size="sm" onClick={onBindings}>检查岗位绑定</Button>}>{blocked.length ? <TaskLinks tasks={blocked} onTask={onTask} /> : <Empty title="暂无失败或阻塞任务" description={enabledRoles === 0 ? '先绑定已有 Agent，并检查权限后启用派单。' : '运行中的任务和异常会持续更新到任务中心。'} />}</Panel></div>
    <ReportComparison property={property} report={report} date={date} revision={response.snapshot.revision} />
    <Panel title="日报数据依据" description="缺数据与零值分开显示；查看采集时间和指标口径后再作经营判断。">{metrics.length === 0 ? <Empty title="该日期尚无已验收经营指标" description="完成数据采集任务并回传带来源的指标后，日报会更新。" /> : <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr>{['指标', '值', '统计周期与口径', '来源'].map((label) => <th key={label} className="px-2 py-3 font-medium first:pl-0">{label}</th>)}</tr></thead><tbody>{metrics.map((metric) => <tr key={metric.key} className="border-b last:border-0"><td className="py-3 pr-3 font-medium">{metricNames[metric.key]}</td><td className="px-2 py-3">{['roomRevenue', 'refunds', 'costs'].includes(metric.key) ? money(metric.value) : metric.value}</td><td className="px-2 py-3"><p>{dateTime(metric.periodStart)} — {dateTime(metric.periodEnd)}</p><p className="mt-1 text-xs text-muted-foreground">{metric.basis}</p></td><td className="px-2 py-3"><SafeLink href={metric.source.uri}>{metric.source.label}</SafeLink><p className="mt-1 text-xs text-muted-foreground">采集于 {dateTime(metric.source.observedAt)}</p></td></tr>)}</tbody></table></div>}</Panel>
  </div>;
}

function TaskLinks({ tasks, onTask }: { tasks: HotelTask[]; onTask: (id: string) => void }) {
  return <div className="divide-y">{tasks.slice(0, 8).map((task) => <button key={task.id} className="flex w-full items-start justify-between gap-3 py-3 text-left first:pt-0 last:pb-0" onClick={() => onTask(task.id)}><div className="min-w-0"><p className="text-sm font-medium">{task.title}</p><p className="mt-1 text-xs text-muted-foreground">{roleLabels[task.role]} · {dateTime(task.updatedAt)}</p>{task.blockedReason && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.blockedReason}</p>}</div><StatusBadge status={task.status} /></button>)}</div>;
}
