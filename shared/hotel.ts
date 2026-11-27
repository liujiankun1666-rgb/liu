/** Shared contract for the local hotel command center. No credentials belong here. */
export const HOTEL_ROLES = ['supervisor', 'pms', 'revenue', 'ctrip', 'douyin', 'finance', 'service', 'codex'] as const;
export type HotelRole = typeof HOTEL_ROLES[number];
export const HOTEL_ROLE_LABELS: Record<HotelRole, string> = {
  supervisor: 'AI 总管', pms: '别样红运营', revenue: '收益与竞对', ctrip: '携程运营',
  douyin: '抖音创作', finance: '财务分析', service: '客户服务', codex: 'Codex 技术支持',
};
export const HOTEL_ACTIONS = ['read', 'analysis', 'code', 'price_change', 'publish', 'payment', 'refund', 'message', 'config_change'] as const;
export type HotelAction = typeof HOTEL_ACTIONS[number];
export type HotelTaskStatus = 'draft' | 'queued' | 'running' | 'needs_review' | 'awaiting_approval' | 'succeeded' | 'failed' | 'blocked' | 'cancelled';
export const HOTEL_STATUS_LABELS: Record<HotelTaskStatus, string> = {
  draft: '草稿', queued: '待执行', running: '执行中', needs_review: '待验收',
  awaiting_approval: '待审批', succeeded: '已验收', failed: '失败', blocked: '已阻塞', cancelled: '已取消',
};
export interface HotelProperty { id: string; name: string; city: string; timezone: string; createdAt: string }
export interface HotelBinding {
  propertyId: string; role: HotelRole; agentId: string | null;
  /** Human-attested readiness only. This is not an enforced runtime sandbox. */
  enabled: boolean; notes: string; updatedAt: string;
}
export interface HotelSource { label: string; uri: string; observedAt: string }
export interface HotelArtifact { label: string; uri: string }
export type HotelMetricKey = 'availableRooms' | 'occupiedRooms' | 'roomRevenue' | 'orders' | 'refunds' | 'costs';
export interface HotelMetric {
  key: HotelMetricKey; value: number; periodStart: string; periodEnd: string;
  basis: string; source: HotelSource;
}
export type HotelContentTopic = 'hotel' | 'games' | 'hardware' | 'service';
export interface HotelContentScore { criterion: string; score: number; maximum: number; reason: string }
export interface HotelContent {
  topic: HotelContentTopic; title: string; hook: string; script: string; storyboard: string;
  subtitles: string; coverPlan: string; caption: string; durationSeconds: number;
  aspectRatio: '9:16'; scores: HotelContentScore[]; improvements: string[];
  templateId?: string; inputRevision?: number;
  publication?: { url: string; recordedAt: string; recordedBy: 'owner' };
}
export interface HotelTaskResult {
  summary: string; completedItems: string[]; missingItems: string[];
  sources: HotelSource[]; artifacts: HotelArtifact[]; dataPeriod: string;
  verificationNotes: string; suggestedNextActions: string[];
  metrics?: HotelMetric[]; content?: HotelContent;
  assessment?: { decision: 'accept' | 'return'; note: string };
  plannedTasks?: HotelPlannedTask[];
}
export interface HotelPlannedTask {
  title: string; objective: string; role: HotelRole; action: 'read' | 'analysis' | 'code';
  inputs: string; acceptanceCriteria: string[]; dependsOn: number[];
}
export interface HotelPlan {
  target: string; before: string; after: string; reason: string; rollback: string;
}
export interface HotelApproval {
  decision: 'approve' | 'reject'; actor: 'owner'; planVersion: number;
  planHash: string; note: string; decidedAt: string;
}
export interface HotelReview { decision: 'accept' | 'return'; actor: 'owner' | 'supervisor'; note: string; reviewedAt: string; reviewerTaskId?: string }
export interface HotelResultHistoryEntry {
  attemptId: string; recordedAt: string; origin: 'gateway' | 'owner' | 'bridge' | 'codex-cli';
  result: HotelTaskResult; review?: HotelReview;
}
export interface HotelPlanHistoryEntry {
  planVersion: number; recordedAt: string; title: string; objective: string; role: HotelRole; action: HotelAction;
  inputs: string; acceptanceCriteria: string[]; dependencies: string[]; knowledgeIds: string[];
  plan?: HotelPlan; approval?: HotelApproval;
}
export interface HotelAttempt {
  /** Explicit runtime identity; omitted means the historical Gateway implementation. */
  executor?: 'gateway' | 'codex-cli';
  id: string; number: number; sessionKey: string; dispatchKey: string;
  startedAt: string; leaseExpiresAt: string; runId?: string; endedAt?: string;
  outcome?: 'returned' | 'failed' | 'uncertain' | 'cancelled'; error?: string;
  retryAcknowledgedAt?: string;
}
export interface HotelTask {
  id: string; propertyId: string; title: string; objective: string; role: HotelRole;
  action: HotelAction; priority: 'normal' | 'high' | 'urgent'; status: HotelTaskStatus;
  parentTaskId?: string; dependencies: string[]; inputs: string;
  acceptanceCriteria: string[]; knowledgeIds: string[]; idempotencyKey: string; requestHash: string;
  planVersion: number; plan?: HotelPlan; approval?: HotelApproval;
  review?: HotelReview; result?: HotelTaskResult;
  resultOrigin?: 'gateway' | 'owner' | 'bridge' | 'codex-cli';
  resultHistory?: HotelResultHistoryEntry[];
  planHistory?: HotelPlanHistoryEntry[];
  assignedAgentId?: string; attempts: HotelAttempt[]; maxAttempts: number;
  deadline?: string; blockedReason?: string; createdAt: string; updatedAt: string;
  scheduleId?: string; scheduleSlot?: string; technicalTaskId?: string;
  reviewTarget?: { taskId: string; attemptId: string; resultHash: string; reviewerAgentId: string };
  delegation?: { attemptId: string; resultHash: string; childTaskIds: string[]; expandedAt: string; result: HotelTaskResult };
}
export interface CreateHotelTaskInput {
  propertyId: string; title: string; objective: string; role: HotelRole;
  action?: HotelAction; priority?: HotelTask['priority']; parentTaskId?: string;
  dependencies?: string[]; inputs?: string; acceptanceCriteria: string[];
  knowledgeIds?: string[]; idempotencyKey: string; maxAttempts?: number;
  deadline?: string; plan?: HotelPlan;
}
export type UpdateHotelTaskInput = Partial<Pick<CreateHotelTaskInput,
  'title' | 'objective' | 'role' | 'action' | 'priority' | 'dependencies' | 'inputs' |
  'acceptanceCriteria' | 'knowledgeIds' | 'deadline' | 'plan'>>;
export interface HotelKnowledgeRevision {
  version: number; content: string; source: string; updatedAt: string;
}
export interface HotelKnowledge {
  id: string; propertyId: string; title: string; category: 'property' | 'rooms' | 'policy' | 'metrics' | 'decision' | 'experience';
  revisions: HotelKnowledgeRevision[];
}
export interface SaveHotelKnowledgeInput {
  id?: string; propertyId: string; title: string; category: HotelKnowledge['category']; content: string; source: string;
}
export interface HotelSchedule {
  id: string; propertyId: string; name: string; enabled: boolean;
  frequency: 'daily' | 'weekly' | 'interval'; time: string; timezone: string;
  weekdays: number[]; intervalMinutes: number; template: Omit<CreateHotelTaskInput, 'propertyId' | 'idempotencyKey' | 'parentTaskId' | 'dependencies' | 'deadline'>;
  lastSlot?: string; lastTaskId?: string; lastError?: string; updatedAt: string;
}
export type SaveHotelScheduleInput = Omit<HotelSchedule, 'id' | 'lastSlot' | 'lastTaskId' | 'lastError' | 'updatedAt' | 'enabled'> & { id?: string; enabled?: boolean };
export interface HotelAuditEvent {
  id: string; propertyId: string; taskId?: string; action: string; actor: string; detail: string; at: string;
}
export interface HotelSnapshot {
  schemaVersion: 1; revision: number; properties: HotelProperty[]; bindings: HotelBinding[];
  tasks: HotelTask[]; knowledge: HotelKnowledge[]; schedules: HotelSchedule[]; audit: HotelAuditEvent[];
}
export interface HotelReport {
  propertyId: string; date: string; timezone: string;
  metrics: Record<HotelMetricKey, HotelMetric | null>;
  occupancyRate: number | null; averageDailyRate: number | null; revenuePerAvailableRoom: number | null;
  warnings: string[]; pendingApprovals: HotelTask[]; blockedTasks: HotelTask[]; completedTasks: HotelTask[];
}
export interface HotelTaskTemplate {
  id: string; title: string; role: HotelRole; action: HotelAction; objective: string; acceptanceCriteria: string[];
}
export interface HotelAgentOption { executionBackend?: 'gateway' | 'codex-cli'; id: string; name: string; modelDisplay?: string; mainSessionKey?: string }
export interface HotelCapability { id: string; label: string; status: 'implemented' | 'needs_connection' | 'unavailable'; detail: string }
export interface HotelSnapshotResponse {
  success: boolean; snapshot: HotelSnapshot; agents: HotelAgentOption[];
  gateway: { state: string }; capabilities: HotelCapability[]; templates: HotelTaskTemplate[];
}
