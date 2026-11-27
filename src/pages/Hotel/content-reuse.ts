import type { CreateHotelTaskInput, HotelTask } from '../../../shared/hotel';

/** Reuse structure within the current property; never copy prior approval or publication. */
export function contentReuseInput(task: HotelTask, propertyId: string, idempotencyKey: string): CreateHotelTaskInput {
  if (task.propertyId !== propertyId || task.role !== 'douyin' || task.status !== 'succeeded' || !task.result?.content) {
    throw new Error('只能复用当前门店已经验收的抖音内容。');
  }
  const content = task.result.content;
  const template = {
    topic: content.topic,
    title: content.title,
    hook: content.hook,
    script: content.script,
    storyboard: content.storyboard,
    subtitles: content.subtitles,
    coverPlan: content.coverPlan,
    caption: content.caption,
    durationSeconds: content.durationSeconds,
    aspectRatio: content.aspectRatio,
  };
  return {
    propertyId,
    title: `${content.title} · 新内容草稿`,
    objective: '参照已验收内容的结构制作一条新视频。先明确新选题和当前资料，重新生成标题、钩子、脚本、分镜、字幕、封面方案与文案，并按新内容重新评分。',
    role: 'douyin', action: 'analysis', priority: 'normal',
    acceptanceCriteria: ['新选题与历史记录核对，说明本次差异，避免重复', '30–60 秒、9:16，素材完整且来源可核实', '按当前素材重新评分并说明扣分理由；低于 80 分给出改进建议', '仅制作审核方案，保留人工发布；不继承原内容的审批、评分或发布记录'],
    knowledgeIds: [...task.knowledgeIds], idempotencyKey,
    inputs: `以下是本店已验收内容的结构模板，来源任务：${task.id}。\n模板只供参考，不代表新内容事实已核实。请先补充本次选题、适用日期、房型或服务变化，再重新生成全部素材与评分。旧内容的发布状态、审核结论和分数均不适用于新任务。\n\n参考模板：\n${JSON.stringify(template, null, 2)}`,
  };
}
