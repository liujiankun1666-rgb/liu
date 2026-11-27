import { hostApiFetch } from '@/lib/host-api';
import type {
  CreateHotelTaskInput, HotelBinding, HotelProperty, HotelReport, HotelSnapshotResponse,
  HotelTask, HotelTaskResult, SaveHotelKnowledgeInput, SaveHotelScheduleInput, UpdateHotelTaskInput,
} from '../../shared/hotel';

export interface HotelBridgeState {
  success: boolean;
  enabled: boolean;
  propertyIds: string[];
  allowDispatch: boolean;
  endpoint: string;
  createdAt?: string;
  lastUsedAt?: string;
  token?: string;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await hostApiFetch<T & { success?: boolean; error?: string }>(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response || response.success === false) {
    throw new Error(response?.error || '酒店总管返回了无效响应，请刷新后重试。');
  }
  return response;
}

export const hotelApi = {
  snapshot: () => request<HotelSnapshotResponse>('/api/hotel/snapshot'),
  report: (propertyId: string, date: string) => request<{ success: boolean; report: HotelReport }>(`/api/hotel/report?propertyId=${encodeURIComponent(propertyId)}&date=${encodeURIComponent(date)}`),
  workflow: (propertyId: string, kind: 'daily_operations' | 'pricing_review' | 'content_review', idempotencyKey: string) => request<{ success: boolean; tasks: HotelTask[] }>('/api/hotel/workflows', 'POST', { propertyId, kind, idempotencyKey }),
  runReady: (propertyId: string) => request<{ success: boolean }>('/api/hotel/run-ready', 'POST', { propertyId }),
  createTask: (input: CreateHotelTaskInput) => request<{ success: boolean; task: HotelTask }>('/api/hotel/tasks', 'POST', input),
  updateTask: (id: string, input: UpdateHotelTaskInput) => request<{ success: boolean; task: HotelTask }>(`/api/hotel/tasks/${encodeURIComponent(id)}`, 'PUT', input),
  taskAction: (id: string, action: string, body: unknown = {}) => request<{ success: boolean; task?: HotelTask }>(`/api/hotel/tasks/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, 'POST', body),
  returnResult: (id: string, attemptId: string, result: HotelTaskResult) => request<{ success: boolean; task: HotelTask }>(`/api/hotel/tasks/${encodeURIComponent(id)}/result`, 'POST', { attemptId, result }),
  bindAgent: (binding: Omit<HotelBinding, 'updatedAt'>) => request<{ success: boolean }>('/api/hotel/bindings', 'PUT', binding),
  saveKnowledge: (input: SaveHotelKnowledgeInput) => request<{ success: boolean }>('/api/hotel/knowledge', 'POST', input),
  saveSchedule: (input: SaveHotelScheduleInput) => request<{ success: boolean }>('/api/hotel/schedules', 'POST', input),
  createProperty: (input: Omit<HotelProperty, 'createdAt'>) => request<{ success: boolean }>('/api/hotel/properties', 'POST', input),
  executionPolicy: (agentId: string, action: 'analysis' | 'read' | 'code') => request<{ success: boolean; allowed: boolean; reason: string; verifiedTools: string[] }>(`/api/hotel/execution-policy?agentId=${encodeURIComponent(agentId)}&action=${action}`),
  bridge: () => request<HotelBridgeState>('/api/hotel/bridge'),
  enableBridge: (propertyIds: string[], allowDispatch: boolean) => request<HotelBridgeState>('/api/hotel/bridge', 'POST', { propertyIds, allowDispatch }),
  revokeBridge: () => request<{ success: boolean }>('/api/hotel/bridge', 'DELETE'),
};
