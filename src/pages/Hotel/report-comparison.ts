import type { HotelMetric, HotelMetricKey, HotelReport } from '../../../shared/hotel';

export interface HotelMetricComparison {
  key: HotelMetricKey;
  current: number | null;
  baseline: number | null;
  delta: number | null;
  relativeChange: number | null;
  reason: string | null;
}

function localParts(value: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}:${values.second}.${values.fractionalSecond}` };
}
function nextDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}
function fullDay(metric: HotelMetric, date: string, timezone: string, now: number): string | null {
  const start = Date.parse(metric.periodStart);
  const end = Date.parse(metric.periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > now) return null;
  const startLocal = localParts(start, timezone);
  if (startLocal.date !== date) return null;
  // Accept exclusive next-day endpoints or inclusive millisecond endpoints.
  for (const boundary of [end, end + 1]) {
    const endLocal = localParts(boundary, timezone);
    if (endLocal.date === nextDate(date) && endLocal.time === startLocal.time) return startLocal.time;
  }
  return null;
}

export function compareHotelMetric(currentReport: HotelReport, baselineReport: HotelReport, key: HotelMetricKey, now = Date.now()): HotelMetricComparison {
  const current = currentReport.metrics[key];
  const baseline = baselineReport.metrics[key];
  const result: HotelMetricComparison = { key, current: current?.value ?? null, baseline: baseline?.value ?? null, delta: null, relativeChange: null, reason: null };
  if (currentReport.propertyId !== baselineReport.propertyId || currentReport.timezone !== baselineReport.timezone) return { ...result, reason: '门店或时区不同' };
  if (currentReport.date === baselineReport.date) return { ...result, reason: '请选择两个不同经营日' };
  if (!current || !baseline) return { ...result, reason: '某个日期缺少已验收数据' };
  if (!current.basis.trim() || current.basis.trim() !== baseline.basis.trim()) return { ...result, reason: '统计口径不同，不能直接比较' };
  const currentStart = fullDay(current, currentReport.date, currentReport.timezone, now);
  const baselineStart = fullDay(baseline, baselineReport.date, baselineReport.timezone, now);
  if (!currentStart || !baselineStart || currentStart !== baselineStart) return { ...result, reason: '需要相同起止口径且已结束的完整经营日' };
  return { ...result, delta: current.value - baseline.value, relativeChange: baseline.value === 0 ? null : (current.value - baseline.value) / Math.abs(baseline.value) };
}
