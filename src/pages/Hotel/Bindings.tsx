import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hotelApi } from '@/lib/hotel-api';
import { HOTEL_ROLES, type HotelAgentOption, type HotelBinding, type HotelRole } from '../../../shared/hotel';
import type { ActionRunner } from './TaskEditor';
import { Field, Notice } from './components';
import { dateTime, roleDescriptions, roleLabels } from './helpers';

export function Bindings({ propertyId, bindings, agents, busy, run }: { propertyId: string; bindings: HotelBinding[]; agents: HotelAgentOption[]; busy: boolean; run: ActionRunner }) {
  return <div className="space-y-5">
    <Notice>从现有 Agent 中选择岗位，不会新建 Agent 或覆盖原有配置。启用派单前，需要检查该 Agent 的工具权限；这里的确认不提供运行时隔离。</Notice>
    {agents.length === 0 && <Notice>当前未读到已有 Agent。请确认本机 ClawX 配置已加载，刷新后再绑定。</Notice>}
    <div className="grid gap-4 xl:grid-cols-2">{HOTEL_ROLES.map((role) => {
      const binding = bindings.find((entry) => entry.propertyId === propertyId && entry.role === role);
      return <BindingCard key={`${propertyId}-${role}-${binding?.updatedAt ?? 'new'}`} propertyId={propertyId} role={role} binding={binding} agents={agents.filter((agent) => agent.executionBackend !== 'codex-cli' || role === 'codex')} busy={busy} run={run} />;
    })}</div>
  </div>;
}

function BindingCard({ propertyId, role, binding, agents, busy, run }: { propertyId: string; role: HotelRole; binding?: HotelBinding; agents: HotelAgentOption[]; busy: boolean; run: ActionRunner }) {
  const [agentId, setAgentId] = useState(binding?.agentId ?? '');
  const [enabled, setEnabled] = useState(binding?.enabled ?? false);
  const [notes, setNotes] = useState(binding?.notes ?? '');
  const [policy, setPolicy] = useState<{ allowed: boolean; reason: string; verifiedTools: string[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [policyError, setPolicyError] = useState('');
  async function checkPolicy() {
    setChecking(true);
    try { setPolicy(await hotelApi.executionPolicy(agentId, role === 'codex' ? 'code' : 'analysis', propertyId)); setPolicyError(''); }
    catch (error) { setPolicyError(error instanceof Error ? error.message : String(error)); }
    finally { setChecking(false); }
  }
  const selected = agents.find((entry) => entry.id === agentId);
  return <form className="space-y-4 rounded-xl border bg-card p-5" onSubmit={(event) => { event.preventDefault(); void run('岗位绑定已保存', () => hotelApi.bindAgent({ propertyId, role, agentId: agentId || null, enabled: enabled && !!agentId, notes })); }}>
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{roleLabels[role]}</h2><Badge variant={binding?.enabled ? 'success' : 'secondary'}>{binding?.enabled ? '已启用派单' : binding?.agentId ? '已绑定 · 派单暂停' : '待绑定'}</Badge></div>
    <p className="text-sm leading-relaxed text-muted-foreground">{roleDescriptions[role]}</p>
    <Field label={`为${roleLabels[role]}选择现有 Agent`}><Select value={agentId} onChange={(event) => { setAgentId(event.target.value); setEnabled(false); setPolicy(null); setPolicyError(''); }}><option value="">尚未绑定</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.id}</option>)}{agentId && !selected && <option value={agentId}>{agentId} · 当前未发现</option>}</Select></Field>
    {selected?.modelDisplay && <p className="text-xs text-muted-foreground">当前模型：{selected.modelDisplay}</p>}
    <div className="space-y-2"><Button type="button" size="sm" variant="outline" disabled={checking || !selected} onClick={() => void checkPolicy()}>{checking ? '正在检查…' : '检查执行权限'}</Button>{policy && <Notice error={!policy.allowed}>{policy.allowed ? '已满足当前派单的工具限制。' : '当前权限无法安全派单：'}{policy.reason}{policy.verifiedTools.length > 0 && <p className="mt-1 text-xs">已核验工具：{policy.verifiedTools.join('、')}</p>}</Notice>}{policyError && <Notice error>{policyError}</Notice>}</div>
    <Field label="权限检查与岗位备注"><Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="记录可访问平台、只读范围、检查方式和限制。" /></Field>
    <label className="flex items-start gap-2 text-sm leading-relaxed"><input type="checkbox" className="mt-1" checked={enabled} disabled={!selected || policy?.allowed === false} onChange={(event) => setEnabled(event.target.checked)} /><span>我已检查此 Agent 的工具权限，允许任务中心向它派单。此确认不是隔离沙箱。</span></label>
    <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{binding ? `最近保存 ${dateTime(binding.updatedAt)}` : '尚未保存'}</span><Button type="submit" size="sm" disabled={busy || (!!agentId && !selected)}>保存岗位绑定</Button></div>
  </form>;
}
