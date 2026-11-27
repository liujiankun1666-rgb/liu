import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Download, Link2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { hotelApi, type HotelBridgeState } from '@/lib/hotel-api';
import type { HotelProperty, HotelSnapshotResponse } from '../../../shared/hotel';
import type { ActionRunner } from './TaskEditor';
import { Field, Notice, Panel } from './components';
import { dateTime, downloadJson } from './helpers';

export function Integrations({ response, property, busy, run, onProperty }: { response: HotelSnapshotResponse; property: HotelProperty; busy: boolean; run: ActionRunner; onProperty: (id: string) => void }) {
  const [bridge, setBridge] = useState<HotelBridgeState | null>(null);
  const [bridgeError, setBridgeError] = useState('');
  const [scope, setScope] = useState([property.id]);
  const [allowDispatch, setAllowDispatch] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showPropertyForm, setShowPropertyForm] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const loadBridge = useCallback(async () => {
    try {
      const next = await hotelApi.bridge();
      setBridge(next);
      setScope(next.propertyIds.length ? next.propertyIds : [property.id]);
      setAllowDispatch(next.allowDispatch);
      setBridgeError('');
    } catch (error) { setBridgeError(error instanceof Error ? error.message : String(error)); }
  }, [property.id]);
  useEffect(() => {
    let active = true;
    void hotelApi.bridge().then((next) => {
      if (!active) return;
      setBridge(next);
      setScope(next.propertyIds.length ? next.propertyIds : [property.id]);
      setAllowDispatch(next.allowDispatch);
      setBridgeError('');
    }).catch((error) => { if (active) setBridgeError(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, [property.id]);
  async function generateBridge() {
    await run('桥接访问令牌已生成', async () => {
      const next = await hotelApi.enableBridge(scope, allowDispatch);
      setBridge(next);
      setConfirmRotate(false);
      setCopied(false);
      setBridgeError('');
    });
  }
  async function copyToken() {
    if (!bridge?.token) return;
    try { await navigator.clipboard.writeText(bridge.token); setCopied(true); } catch { setBridgeError('无法访问剪贴板，请手动复制本页令牌。'); }
  }
  return <div className="space-y-5">
    <Panel title="接入状态" description="以下状态由当前安装和适配器提供。模型已连接、账号曾登录，都不能单独证明酒店后台已接通。">
      <div className="divide-y">{response.capabilities.map((capability) => <div key={capability.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"><div className="min-w-0 flex-1"><h3 className="text-sm font-medium">{capability.label}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{capability.detail}</p></div><Badge variant={capability.status === 'implemented' ? 'success' : 'secondary'}>{capability.status === 'implemented' ? '功能已实现' : capability.status === 'needs_connection' ? '待接入验证' : '当前不可用'}</Badge></div>)}</div>
    </Panel>
    <Panel title="ChatGPT 与 Codex 桥接" description="本地桥接供兼容的客户端访问酒店任务。ChatGPT 云端到这台电脑的远程连接仍需单独接入和验证。">
      <div className="space-y-4">
        <Notice>当前页面不代表 ChatGPT 已能远程控制本机。桥接仅监听本地回环地址，令牌不包含老板审批或岗位配置权限。</Notice>
        {bridgeError && <Notice error>{bridgeError}</Notice>}
        <div className="flex flex-wrap items-center gap-3"><Badge variant={bridge?.enabled ? 'success' : 'secondary'}>{bridge?.enabled ? '本地桥接已启用' : bridge ? '本地桥接未启用' : '正在读取桥接状态'}</Badge><span className="text-xs text-muted-foreground">最近访问：{dateTime(bridge?.lastUsedAt)}</span></div>
        {bridge?.endpoint && <div className="rounded-lg bg-muted/50 p-3"><p className="mb-1 text-xs text-muted-foreground">本地服务地址</p><code className="break-all text-xs">{bridge.endpoint}</code></div>}
        <details className="rounded-lg border p-4"><summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><Link2 className="h-4 w-4" />配置桥接授权</summary><div className="mt-4 space-y-4">
          <fieldset><legend className="mb-2 text-sm font-medium">可访问门店</legend><div className="space-y-2">{response.snapshot.properties.map((entry) => <label className="flex items-center gap-2 text-sm" key={entry.id}><input type="checkbox" checked={scope.includes(entry.id)} onChange={(event) => setScope(event.target.checked ? [...scope, entry.id] : scope.filter((id) => id !== entry.id))} />{entry.name} · {entry.city}</label>)}</div></fieldset>
          <label className="flex items-start gap-2 text-sm leading-relaxed"><input type="checkbox" className="mt-1" checked={allowDispatch} onChange={(event) => setAllowDispatch(event.target.checked)} /><span>允许桥接请求任务派发；仍需满足本机的岗位绑定、依赖和执行权限。</span></label>
          <div className="flex flex-wrap gap-2"><Button disabled={busy || scope.length === 0 || !bridge} onClick={() => bridge?.enabled ? setConfirmRotate(true) : void generateBridge()}>{bridge?.enabled ? '更新授权并轮换令牌' : '启用本地桥接'}</Button>{bridge?.enabled && <Button variant="outline" disabled={busy} onClick={() => void run('桥接授权已撤销', async () => { await hotelApi.revokeBridge(); await loadBridge(); })}>撤销桥接授权</Button>}</div>
          {confirmRotate && <div className="space-y-3 rounded-lg border p-3"><p className="text-sm">旧令牌会立即失效，已连接的客户端需要更新配置。</p><Button size="sm" disabled={busy} onClick={() => void generateBridge()}>确认轮换</Button></div>}
        </div></details>
        {bridge?.token && <div className="space-y-3 rounded-lg border border-amber-200 p-4 dark:border-amber-900"><p className="text-sm font-medium">请现在保存令牌，离开此页面后不会再次显示。</p><Textarea aria-label="本地桥接令牌" readOnly rows={2} value={bridge.token} className="font-mono text-xs" /><Button variant="outline" size="sm" onClick={() => void copyToken()}>{copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}{copied ? '已复制' : '复制令牌'}</Button><p className="text-xs leading-relaxed text-muted-foreground">把令牌保存在客户端的本地凭据配置中，不要放入聊天正文、知识库或公开仓库。</p></div>}
      </div>
    </Panel>
    <Panel title="门店管理" description="每个门店分别保存岗位绑定、任务、知识与计划。当前门店由页面顶部选择。" actions={<Button variant="outline" size="sm" onClick={() => setShowPropertyForm(!showPropertyForm)}><Plus className="mr-1.5 h-4 w-4" />增加门店</Button>}>
      <div className="space-y-3">{response.snapshot.properties.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">{entry.name}</p><p className="mt-1 text-xs text-muted-foreground">{entry.city} · {entry.timezone} · {entry.id}</p></div><Button size="sm" variant="outline" disabled={entry.id === property.id} onClick={() => onProperty(entry.id)}>{entry.id === property.id ? '当前门店' : '切换门店'}</Button></div>)}</div>
      {showPropertyForm && <PropertyForm busy={busy} run={run} onClose={() => setShowPropertyForm(false)} onCreated={onProperty} />}
    </Panel>
    <Panel title="导出与操作记录" description="导出当前门店的任务、知识和计划，供复盘或交接；导出内容可能包含经营信息，请自行保管。" actions={<Button variant="outline" size="sm" onClick={() => downloadJson(`hotel-${property.id}-${new Date().toISOString().slice(0, 10)}.json`, { ...response.snapshot, properties: [property], bindings: response.snapshot.bindings.filter((entry) => entry.propertyId === property.id), tasks: response.snapshot.tasks.filter((entry) => entry.propertyId === property.id), knowledge: response.snapshot.knowledge.filter((entry) => entry.propertyId === property.id), schedules: response.snapshot.schedules.filter((entry) => entry.propertyId === property.id), audit: response.snapshot.audit.filter((entry) => entry.propertyId === property.id) })}><Download className="mr-1.5 h-4 w-4" />导出本店记录</Button>}>
      <div className="max-h-80 space-y-3 overflow-y-auto">{response.snapshot.audit.filter((entry) => entry.propertyId === property.id).slice(-30).reverse().map((entry) => <div key={entry.id} className="border-b pb-3 text-sm last:border-0 last:pb-0"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{entry.action}</span><span className="text-xs text-muted-foreground">{dateTime(entry.at)} · {entry.actor}</span></div><p className="mt-1 break-words text-muted-foreground">{entry.detail}</p></div>)}{response.snapshot.audit.filter((entry) => entry.propertyId === property.id).length === 0 && <p className="text-sm text-muted-foreground">尚无操作记录。</p>}</div>
    </Panel>
  </div>;
}

function PropertyForm({ busy, run, onClose, onCreated }: { busy: boolean; run: ActionRunner; onClose: () => void; onCreated: (id: string) => void }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await run('门店已建立', () => hotelApi.createProperty({ id, name, city, timezone }));
    if (saved) { onCreated(id); onClose(); }
  }
  return <form onSubmit={submit} className="mt-5 space-y-4 border-t pt-5"><div className="grid gap-4 md:grid-cols-2"><Field label="门店名称"><Input required value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="门店标识" hint="用小写英文字母、数字、短横线，如 agon-second。"><Input required pattern="[a-z0-9][a-z0-9_-]*" value={id} onChange={(event) => setId(event.target.value)} /></Field><Field label="所在城市"><Input required value={city} onChange={(event) => setCity(event.target.value)} /></Field><Field label="时区"><Input required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></Field></div><div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !id || !name.trim() || !city.trim()}>建立门店</Button></div></form>;
}
