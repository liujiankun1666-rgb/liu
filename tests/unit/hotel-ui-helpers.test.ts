import { describe, expect, it } from 'vitest';
import type { HotelMetric, HotelReport, HotelTask } from '../../shared/hotel';
import { contentReuseInput } from '../../src/pages/Hotel/content-reuse';
import { compareHotelMetric } from '../../src/pages/Hotel/report-comparison';

function revenue(date: string, value: number, basis = '人民币客房实收，含税，经营日口径'): HotelMetric {
  const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  return { key: 'roomRevenue', value, periodStart: `${date}T00:00:00+08:00`, periodEnd: `${next.toISOString().slice(0, 10)}T00:00:00+08:00`, basis, source: { label: '测试报表', uri: 'https://example.com/report', observedAt: `${next.toISOString().slice(0, 10)}T01:00:00+08:00` } };
}
function report(date: string, value: number, basis?: string): HotelReport {
  return { propertyId: 'test-property', date, timezone: 'Asia/Shanghai', metrics: { availableRooms: null, occupiedRooms: null, roomRevenue: revenue(date, value, basis), orders: null, refunds: null, costs: null }, occupancyRate: null, averageDailyRate: null, revenuePerAvailableRoom: null, warnings: [], pendingApprovals: [], blockedTasks: [], completedTasks: [] };
}
const now = Date.parse('2026-11-30T00:00:00Z');

describe('Hotel report comparability', () => {
  it('calculates changes only for matching complete operating days', () => {
    const result = compareHotelMetric(report('2026-11-26', 1200), report('2026-11-25', 1000), 'roomRevenue', now);
    expect(result.reason).toBeNull(); expect(result.delta).toBe(200); expect(result.relativeChange).toBe(0.2);
  });
  it('refuses different bases and partial or future reporting periods', () => {
    expect(compareHotelMetric(report('2026-11-26', 1200, '订单口径'), report('2026-11-25', 1000), 'roomRevenue', now).reason).toContain('统计口径不同');
    const partial = report('2026-11-26', 1200); partial.metrics.roomRevenue!.periodEnd = '2026-11-26T12:00:00+08:00';
    expect(compareHotelMetric(partial, report('2026-11-25', 1000), 'roomRevenue', now).delta).toBeNull();
    expect(compareHotelMetric(report('2026-11-26', 1200), report('2026-11-25', 1000), 'roomRevenue', Date.parse('2026-11-26T06:00:00Z')).delta).toBeNull();
  });
  it('keeps missing data and a zero baseline distinct', () => {
    const zero = compareHotelMetric(report('2026-11-26', 1200), report('2026-11-25', 0), 'roomRevenue', now);
    expect(zero.delta).toBe(1200); expect(zero.relativeChange).toBeNull(); expect(zero.reason).toBeNull();
    const missing = report('2026-11-26', 1200); missing.metrics.roomRevenue = null;
    expect(compareHotelMetric(missing, report('2026-11-25', 1000), 'roomRevenue', now).reason).toContain('缺少');
  });
  it('recognizes a complete local operating day across daylight saving', () => {
    const current = report('2026-11-01', 1200); current.timezone = 'America/New_York'; current.metrics.roomRevenue!.periodStart = '2026-11-01T00:00:00-04:00'; current.metrics.roomRevenue!.periodEnd = '2026-11-02T00:00:00-05:00';
    const baseline = report('2026-10-31', 1000); baseline.timezone = 'America/New_York'; baseline.metrics.roomRevenue!.periodStart = '2026-10-31T00:00:00-04:00'; baseline.metrics.roomRevenue!.periodEnd = '2026-11-01T00:00:00-04:00';
    expect(compareHotelMetric(current, baseline, 'roomRevenue', now).delta).toBe(200);
  });
});

describe('Reuse approved video content as a fresh draft', () => {
  const source = { id: 'source-content', propertyId: 'test-property', role: 'douyin', status: 'succeeded', knowledgeIds: ['rooms'], result: { content: { topic: 'hotel', title: '酒店体验', hook: '开场钩子', script: '脚本', storyboard: '分镜', subtitles: '字幕', coverPlan: '封面', caption: '文案', durationSeconds: 45, aspectRatio: '9:16', scores: [{ criterion: '完整度', score: 90, maximum: 100, reason: '历史评价' }], improvements: [], publication: { url: 'https://www.douyin.com/video/old-publication', recordedAt: '2026-11-20T00:00:00Z', recordedBy: 'owner' } } } } as unknown as HotelTask;
  it('copies template material without the old publication or score', () => {
    const draft = contentReuseInput(source, 'test-property', 'new-request');
    expect(draft.action).toBe('analysis'); expect(draft.role).toBe('douyin');
    expect(draft.inputs).toContain('酒店体验'); expect(draft.inputs).toContain('重新生成全部素材与评分');
    expect(draft.inputs).not.toContain('old-publication'); expect(draft.inputs).not.toContain('"scores"');
    expect(draft).not.toHaveProperty('result'); expect(draft).not.toHaveProperty('approval');
  });
  it('rejects reuse from another property or an unaccepted task', () => {
    expect(() => contentReuseInput(source, 'another-property', 'request')).toThrow('当前门店');
    expect(() => contentReuseInput({ ...source, status: 'needs_review' }, 'test-property', 'request')).toThrow('已经验收');
  });
});
