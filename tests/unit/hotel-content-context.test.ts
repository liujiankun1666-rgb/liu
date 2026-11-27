import { describe, expect, it } from 'vitest';
import type { HotelContent, HotelTask } from '../../shared/hotel';
import { createInitialHotelSnapshot } from '@electron/services/hotel/domain';
import { buildHotelContentContext } from '@electron/services/hotel/content-context';

function content(topic: HotelContent['topic'] = 'hotel', score = 85): HotelContent {
  return {
    topic, title: `Example ${topic}`, hook: 'Example hook', script: 'Example script',
    storyboard: 'Example storyboard', subtitles: 'Example subtitles', coverPlan: 'Example cover',
    caption: 'Example caption', durationSeconds: 40, aspectRatio: '9:16',
    scores: [
      { criterion: 'Example quality', score: Math.min(score, 80), maximum: 80, reason: 'Synthetic fixture' },
      { criterion: 'Example clarity', score: Math.max(score - 80, 0), maximum: 20, reason: 'Synthetic fixture' },
    ],
    improvements: score < 80 ? ['Example improvement'] : [],
  };
}

function task(id: string, propertyId: string, topic: HotelContent['topic'], status: HotelTask['status'], updatedAt: string, score = 85): HotelTask {
  return {
    id, propertyId, title: id, objective: 'Example content task', role: 'douyin', action: 'analysis',
    priority: 'normal', status, dependencies: [], inputs: '', acceptanceCriteria: ['Example'],
    knowledgeIds: [], idempotencyKey: id, requestHash: id, planVersion: 1, attempts: [], maxAttempts: 3,
    createdAt: updatedAt, updatedAt,
    result: { summary: 'Example', completedItems: ['Example'], missingItems: [], sources: [], artifacts: [], dataPeriod: 'Example', verificationNotes: 'Example', suggestedNextActions: [], content: content(topic, score) },
  };
}

describe('hotel content planning context', () => {
  it('starts with hotel content without inventing history or performance', () => {
    const context = buildHotelContentContext(createInitialHotelSnapshot(), 'xingcheng-aigong');
    expect(context.nextTopic).toBe('hotel');
    expect(context.history).toEqual([]);
    expect(context.acceptedQualityTemplates).toEqual([]);
    expect(context.performanceKnowledge).toEqual([]);
    expect(context.guidance).toContain('质量评分不是播放');
  });

  it('rotates after the latest same-property content and includes unaccepted topics for deduplication', () => {
    const state = createInitialHotelSnapshot();
    state.tasks.push(
      task('older', 'xingcheng-aigong', 'games', 'succeeded', '2026-11-26T00:00:00Z'),
      task('latest', 'xingcheng-aigong', 'hardware', 'needs_review', '2026-11-27T00:00:00Z'),
      task('foreign', 'other-property', 'service', 'succeeded', '2026-11-28T00:00:00Z'),
    );
    const context = buildHotelContentContext(state, 'xingcheng-aigong');
    expect(context.nextTopic).toBe('service');
    expect(context.history.map((entry) => entry.taskId)).toEqual(['latest', 'older']);
    expect(context.acceptedQualityTemplates.map((entry) => entry.templateId)).toEqual(['older']);
  });

  it('excludes low quality and cancelled templates and wraps rotation to hotel', () => {
    const state = createInitialHotelSnapshot();
    state.tasks.push(
      task('low', 'xingcheng-aigong', 'service', 'succeeded', '2026-11-27T00:00:00Z', 79),
      task('cancelled', 'xingcheng-aigong', 'games', 'cancelled', '2026-11-28T00:00:00Z'),
    );
    const context = buildHotelContentContext(state, 'xingcheng-aigong');
    expect(context.nextTopic).toBe('hotel');
    expect(context.history).toHaveLength(1);
    expect(context.acceptedQualityTemplates).toEqual([]);
  });

  it('does not let a later publication record reorder the topic rotation', () => {
    const state = createInitialHotelSnapshot();
    const older = task('older', 'xingcheng-aigong', 'hotel', 'succeeded', '2026-11-25T00:00:00Z');
    older.updatedAt = '2026-11-29T00:00:00Z';
    state.tasks.push(older, task('newer', 'xingcheng-aigong', 'games', 'succeeded', '2026-11-27T00:00:00Z'));
    expect(buildHotelContentContext(state, 'xingcheng-aigong').nextTopic).toBe('hardware');
  });

  it('passes sourced same-property experience separately without treating it as measured performance', () => {
    const state = createInitialHotelSnapshot();
    state.knowledge.push(
      { id: 'local', propertyId: 'xingcheng-aigong', title: 'Example source note', category: 'experience', revisions: [{ version: 1, content: 'Needs actual verification', source: 'example://reference', updatedAt: '2026-11-27T00:00:00Z' }] },
      { id: 'foreign', propertyId: 'other-property', title: 'Other property', category: 'experience', revisions: [{ version: 1, content: 'Private elsewhere', source: 'example://foreign', updatedAt: '2026-11-27T00:00:00Z' }] },
    );
    const context = buildHotelContentContext(state, 'xingcheng-aigong');
    expect(context.performanceKnowledge.map((entry) => entry.id)).toEqual(['local']);
    expect(context.performanceKnowledge[0].revision.source).toBe('example://reference');
    expect(context).not.toHaveProperty('views');
    expect(context).not.toHaveProperty('conversionRate');
  });
});
