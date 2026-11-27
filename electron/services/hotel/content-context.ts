import type { HotelContentTopic, HotelSnapshot, HotelTask } from '../../../shared/hotel';

const TOPIC_ROTATION: HotelContentTopic[] = ['hotel', 'games', 'hardware', 'service'];
const contentTime = (task: HotelTask) => task.attempts.at(-1)?.endedAt ?? task.createdAt;

/** Actual same-property content history for planning, never invented audience metrics. */
export function buildHotelContentContext(snapshot: HotelSnapshot, propertyId: string) {
  const contentTasks = snapshot.tasks
    .filter((task) => task.propertyId === propertyId && task.role === 'douyin'
      && task.status !== 'cancelled' && task.result?.content)
    .sort((a, b) => contentTime(b).localeCompare(contentTime(a)) || b.id.localeCompare(a.id));
  const latestTopic = contentTasks[0]?.result?.content?.topic;
  const nextTopic = latestTopic
    ? TOPIC_ROTATION[(TOPIC_ROTATION.indexOf(latestTopic) + 1) % TOPIC_ROTATION.length]
    : TOPIC_ROTATION[0];
  const qualityScore = (task: typeof contentTasks[number]) => task.result!.content!.scores.reduce((sum, score) => sum + score.score, 0);
  return {
    nextTopic,
    topicRotation: [...TOPIC_ROTATION],
    history: contentTasks.slice(0, 60).map((task) => ({
      taskId: task.id,
      topic: task.result!.content!.topic,
      title: task.result!.content!.title,
      qualityScore: qualityScore(task),
      accepted: task.status === 'succeeded',
      generatedAt: contentTime(task),
      updatedAt: task.updatedAt,
    })),
    acceptedQualityTemplates: contentTasks
      .filter((task) => task.status === 'succeeded' && qualityScore(task) >= 80)
      .slice(0, 3)
      .map((task) => ({
        templateId: task.id,
        qualityScore: qualityScore(task),
        content: structuredClone(task.result!.content!),
        sources: structuredClone(task.result!.sources),
      })),
    performanceKnowledge: snapshot.knowledge
      .filter((entry) => entry.propertyId === propertyId && entry.category === 'experience' && entry.revisions.length)
      .slice(-10)
      .map((entry) => ({ id: entry.id, title: entry.title, revision: structuredClone(entry.revisions.at(-1)!) })),
    guidance: '按 nextTopic 轮换四类主题，结合 history 避免重复角度；需要复用时引用 acceptedQualityTemplates 的 templateId 并更新事实。质量评分不是播放、转化或营收表现；只有 performanceKnowledge 中有来源且核实的效果资料才能支持效果判断。缺少真实效果数据时明确说明。',
  };
}
