import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hotelApi } from '@/lib/hotel-api';
import type { HotelKnowledge } from '../../../shared/hotel';
import type { ActionRunner } from './TaskEditor';
import { Empty, Field, Panel } from './components';
import { dateTime } from './helpers';

const categories: Record<HotelKnowledge['category'], string> = { property: '酒店资料', rooms: '房型配置', policy: '制度与流程', metrics: '指标口径', decision: '经营决策', experience: '经验复盘' };

export function Knowledge({ propertyId, entries, busy, run }: { propertyId: string; entries: HotelKnowledge[]; busy: boolean; run: ActionRunner }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const selected = entries.find((entry) => entry.id === selectedId);
  const filtered = entries.filter((entry) => `${entry.title} ${entry.revisions.at(-1)?.content ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3"><Input aria-label="搜索知识库" placeholder="搜索酒店资料、制度或历史决策" value={query} onChange={(event) => setQuery(event.target.value)} className="max-w-md" /><Button onClick={() => { setSelectedId(null); setEditing(true); }}><Plus className="mr-2 h-4 w-4" />新增知识</Button></div>
    <p className="text-sm text-muted-foreground">知识按门店隔离，每次修改保留来源和版本。任务可以明确引用已保存的资料。</p>
    {editing ? <KnowledgeEditor key={`${selected?.id ?? 'new'}-${selected?.revisions.length ?? 0}`} propertyId={propertyId} entry={selected} busy={busy} run={run} onClose={() => setEditing(false)} /> : selected ? <Panel title={selected.title} description={`${categories[selected.category]} · ${selected.revisions.length} 个版本`} actions={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setSelectedId(null)}>返回目录</Button><Button size="sm" onClick={() => setEditing(true)}>编辑新版本</Button></div>}>
      <div className="space-y-5"><div className="whitespace-pre-wrap break-words text-sm leading-7">{selected.revisions.at(-1)?.content}</div><p className="break-words text-sm text-muted-foreground">来源：{selected.revisions.at(-1)?.source}</p><details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">版本记录</summary><div className="mt-3 space-y-4">{[...selected.revisions].reverse().map((revision) => <div key={revision.version} className="rounded-lg border p-3"><p className="text-sm font-medium">v{revision.version} · {dateTime(revision.updatedAt)}</p><p className="mt-1 text-xs text-muted-foreground">来源：{revision.source}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{revision.content}</p></div>)}</div></details></div>
    </Panel> : filtered.length === 0 ? <Empty title={query ? '没有匹配的知识' : '先建立本店的共同依据'} description="酒店资料、房型配置、经营制度、指标口径和已核实的决策，都可以保存在这里。" /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((entry) => <button key={entry.id} onClick={() => setSelectedId(entry.id)} className="space-y-2 rounded-xl border bg-card p-5 text-left transition-colors hover:bg-muted/40"><span className="text-xs text-muted-foreground">{categories[entry.category]} · v{entry.revisions.at(-1)?.version ?? 1}</span><h2 className="font-semibold">{entry.title}</h2><p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{entry.revisions.at(-1)?.content}</p><p className="text-xs text-muted-foreground">更新于 {dateTime(entry.revisions.at(-1)?.updatedAt)}</p></button>)}</div>}
  </div>;
}

function KnowledgeEditor({ propertyId, entry, busy, run, onClose }: { propertyId: string; entry?: HotelKnowledge; busy: boolean; run: ActionRunner; onClose: () => void }) {
  const revision = entry?.revisions.at(-1);
  const [title, setTitle] = useState(entry?.title ?? '');
  const [category, setCategory] = useState<HotelKnowledge['category']>(entry?.category ?? 'property');
  const [content, setContent] = useState(revision?.content ?? '');
  const [source, setSource] = useState(revision?.source ?? '');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await run('知识版本已保存', () => hotelApi.saveKnowledge({ ...(entry ? { id: entry.id } : {}), propertyId, title, category, content, source }));
    if (saved) onClose();
  }
  return <Panel title={entry ? '更新知识版本' : '新增知识'} description="填写可核查的来源；尚不确定的内容请明确标注。"><form onSubmit={submit} className="space-y-4"><div className="grid gap-4 md:grid-cols-[2fr_1fr]"><Field label="知识标题"><Input required value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="分类"><Select value={category} onChange={(event) => setCategory(event.target.value as HotelKnowledge['category'])}>{Object.entries(categories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field></div><Field label="知识正文"><Textarea required rows={10} value={content} onChange={(event) => setContent(event.target.value)} /></Field><Field label="来源与核实依据"><Input required value={source} onChange={(event) => setSource(event.target.value)} placeholder="文件位置、后台报表链接，或老板确认的日期与事项" /></Field><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={busy}>取消</Button><Button type="submit" disabled={busy || !title.trim() || !content.trim() || !source.trim()}>保存知识</Button></div></form></Panel>;
}
