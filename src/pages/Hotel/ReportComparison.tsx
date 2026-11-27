import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { hotelApi } from '@/lib/hotel-api';
import type { HotelMetricKey, HotelProperty, HotelReport } from '../../../shared/hotel';
import { Empty, Notice, Panel } from './components';
import { compareHotelMetric } from './report-comparison';

const labels: Record<HotelMetricKey, string> = { availableRooms: '可售房间', occupiedRooms: '已入住房间', roomRevenue: '客房收入', orders: '订单数', refunds: '退款', costs: '成本' };

export function ReportComparison({ property, report, date, revision }: { property: HotelProperty; report: HotelReport | null; date: string; revision: number }) {
  const [baselineDate, setBaselineDate] = useState('');
  const [state, setState] = useState<{ key: string; report: HotelReport | null; error: string }>({ key: '', report: null, error: '' });
  const key = `${property.id}:${baselineDate}:${revision}`;
  useEffect(() => {
    let active = true;
    if (!baselineDate) return;
    void hotelApi.report(property.id, baselineDate).then((response) => { if (active) setState({ key, report: response.report, error: '' }); }).catch((error) => { if (active) setState({ key, report: null, error: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; };
  }, [property.id, baselineDate, key]);
  const baseline = state.key === key ? state.report : null;
  const comparisons = report && baseline ? (Object.keys(labels) as HotelMetricKey[]).map((metric) => compareHotelMetric(report, baseline, metric)) : [];
  const format = (value: number | null, metric: HotelMetricKey, signed = false) => value === null ? '缺数据' : `${signed && value > 0 ? '+' : ''}${['roomRevenue', 'refunds', 'costs'].includes(metric) ? '¥' : ''}${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
  return <Panel title="经营日对比" description="对比已验收的完整经营日；口径不同或日期尚未结束时不计算变化。前后变化本身不能证明某项策略造成了结果。" actions={<label className="flex items-center gap-2 text-sm">对比日期<Input aria-label="对比日期" type="date" className="w-40" value={baselineDate} onChange={(event) => setBaselineDate(event.target.value)} /></label>}>
    {!baselineDate ? <Empty title="选择一个对比日期" description="可选择调整策略前的经营日，或同一星期的历史日期。" /> : state.key === key && state.error ? <Notice error>{state.error}</Notice> : !report || !baseline ? <p className="text-sm text-muted-foreground">等待两个日期的日报依据可用后比较。</p> : <div className="space-y-3"><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr>{['指标', baselineDate, date, '变化量', '变化比例 / 可比性'].map((heading, index) => <th key={index} className="py-3 pr-4 font-medium">{heading}</th>)}</tr></thead><tbody>{comparisons.map((comparison) => <tr className="border-b last:border-0" key={comparison.key}><td className="py-3 pr-4 font-medium">{labels[comparison.key]}</td><td className="py-3 pr-4">{format(comparison.baseline, comparison.key)}</td><td className="py-3 pr-4">{format(comparison.current, comparison.key)}</td><td className="py-3 pr-4">{comparison.reason ? '不可比' : format(comparison.delta, comparison.key, true)}</td><td className="py-3 text-xs text-muted-foreground">{comparison.reason ?? (comparison.relativeChange === null ? '基期为 0，不计算比例' : `${comparison.relativeChange > 0 ? '+' : ''}${(comparison.relativeChange * 100).toFixed(1)}%`)}</td></tr>)}</tbody></table></div><p className="text-xs leading-relaxed text-muted-foreground">金额或订单变化只作观察。请结合同期活动、节假日、房量和渠道变化，再评估策略效果。</p></div>}
  </Panel>;
}
