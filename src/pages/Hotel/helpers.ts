import type { HotelContent } from '../../../shared/hotel';

export const roleLabels = {
  supervisor: 'AI 总管',
  pms: '酒店运营 · 别样红',
  revenue: '收益管理 · 竞对',
  ctrip: '携程运营',
  douyin: '抖音内容',
  finance: '财务分析',
  service: '客户服务',
  codex: 'Codex 技术研发',
} as const;

export const roleDescriptions: Record<keyof typeof roleLabels, string> = {
  supervisor: '讨论目标、核对依据、拆分工作，汇总待验收的结果。',
  pms: '读取已授权房态、入住率与营业收入，注明统计口径。',
  revenue: '比较本店所在城市同日期、房型与退订条件的房价，提出定价方案。',
  ctrip: '分析曝光、转化、订单及评价，保留数据来源。',
  douyin: '轮换四类主题，制作 30–60 秒竖屏视频方案，80 分质量门槛。',
  finance: '核对收款、退款与成本，列出差异及待核实事项。',
  service: '整理评价和投诉，拟定回复，跟踪服务问题。',
  codex: '在隔离研发环境修复问题，返回代码变更与验证证据。',
};

export const actionLabels: Record<string, string> = {
  read: '只读采集', analysis: '分析与方案', code: '隔离研发',
  price_change: '调价方案', publish: '发布方案', payment: '付款方案',
  refund: '退款方案', message: '对客回复方案', config_change: '配置变更方案',
};

export const statusLabels: Record<string, string> = {
  draft: '草稿', queued: '排队中', ready: '待执行', running: '执行中',
  review: '待验收', needs_review: '待验收', awaiting_review: '待验收',
  awaiting_approval: '待老板审批', approved: '已批准',
  succeeded: '已验收', completed: '已验收', failed: '失败',
  blocked: '已阻塞', cancelled: '已取消', rejected: '已拒绝',
};

export function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

export function dateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
    : value;
}

export function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function contentQuality(content: HotelContent): number {
  return content.scores.reduce((sum, entry) => sum + entry.score, 0);
}
