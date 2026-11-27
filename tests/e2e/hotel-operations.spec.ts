import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CALLBACK_RECEIVED_HTML } from '../../electron/utils/openai-codex-oauth';
import type { HotelSnapshot } from '../../shared/hotel';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

// These tests use the real Host API and isolated Electron user-data directory.
// No production Gateway, hotel account, or fabricated success response is used.
test.describe('Hotel operations command center', () => {
  test('opens the complete workbench and queues a natural-language goal without claiming execution', async ({ launchElectronApp, userDataDir }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-nav-hotel').click();
      await expect(page.getByRole('tab', { name: '总管工作台', exact: true })).toHaveAttribute('aria-selected', 'true');
      const workbench = page.getByTestId('hotel-workbench');
      await expect(workbench).toBeVisible();
      for (const name of ['经营概览', '任务与审批', '岗位绑定', '知识库', '定时任务', '接入与门店']) {
        await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
      }
      const roles = {
        supervisor: 'AI 总管', pms: '别样红运营', revenue: '收益与竞对', ctrip: '携程运营',
        douyin: '抖音创作', finance: '财务分析', service: '客户服务', codex: 'Codex 技术支持',
      };
      for (const [role, label] of Object.entries(roles)) {
        const card = workbench.getByTestId(`hotel-role-${role}`);
        await expect(card.getByRole('heading', { name: label, exact: true })).toBeVisible();
        await expect(card.getByText('待绑定', { exact: true })).toBeVisible();
      }
      await expect(page.getByText('该日期尚无已验收经营指标')).toHaveCount(0);
      const submit = workbench.getByRole('button', { name: '提交给总管', exact: true });
      await expect(submit).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath('hotel-workbench.png'), fullPage: true });

      const objective = '整理酒店管理体系的岗位职责、资料来源和验收清单，仅使用本次合成测试资料。';
      await workbench.getByLabel('交给总管的目标', { exact: true }).fill(objective);
      await submit.click();
      const detail = page.getByTestId('hotel-task-detail');
      await expect(detail).toBeVisible();
      await expect(detail.getByText(objective, { exact: true })).toBeVisible();
      await expect(detail.getByText('待执行', { exact: true })).toBeVisible();

      // Inspect the persisted result of the real UI → Host API flow. With no
      // Gateway or role binding in this fixture, queueing must not fabricate a run.
      const snapshot = JSON.parse(await readFile(join(userDataDir, 'hotel-command-center.json'), 'utf8')) as HotelSnapshot;
      expect(snapshot.tasks).toHaveLength(1);
      const created = snapshot.tasks[0];
      expect(created).toMatchObject({ objective, role: 'supervisor', action: 'analysis', status: 'queued', attempts: [] });
      expect(created.result).toBeUndefined();
      expect(created.approval).toBeUndefined();
      expect(snapshot.audit.some((entry) => entry.taskId === created.id && entry.action === 'task.queued')).toBe(true);

      await page.reload();
      await expect(page.getByTestId('hotel-workbench')).toBeVisible();
      await page.getByRole('tab', { name: '任务与审批', exact: true }).click();
      await page.getByRole('button', { name: created.title, exact: true }).click();
      await expect(page.getByTestId('hotel-task-detail').getByText(objective, { exact: true })).toBeVisible();
      await expect(page.getByTestId('hotel-task-detail').getByText('待执行', { exact: true })).toBeVisible();
    } finally { await closeElectronApp(app); }
  });

  test('persists a hotel task and knowledge while showing missing metrics honestly', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-nav-hotel').click();
      await expect(page.getByTestId('hotel-page-title')).toHaveText('酒店总管');
      await expect(page.getByText(/OpenClaw Gateway/)).toBeVisible();
      await page.getByRole('tab', { name: '经营概览', exact: true }).click();
      await expect(page.getByText('该日期尚无已验收经营指标')).toBeVisible();
      await expect(page.getByText('待接入', { exact: true })).toHaveCount(4);

      await page.getByRole('button', { name: '新建任务', exact: true }).click();
      await page.getByLabel('任务标题', { exact: true }).fill('本周入住率分析');
      await page.getByLabel('希望达到的结果', { exact: true }).fill('核对已授权经营数据，区分缺数据与真实零值，提出可验证建议。');
      await page.getByRole('button', { name: '建立任务', exact: true }).click();
      await expect(page.getByTestId('hotel-task-detail')).toBeVisible();
      await expect(page.getByTestId('hotel-task-detail').getByText('草稿', { exact: true })).toBeVisible();

      await page.reload();
      await page.getByRole('tab', { name: '任务与审批' }).click();
      await page.getByRole('button', { name: '本周入住率分析', exact: true }).click();
      await expect(page.getByTestId('hotel-task-detail')).toBeVisible();

      await page.getByRole('tab', { name: '知识库' }).click();
      await page.getByRole('button', { name: '新增知识', exact: true }).click();
      await page.getByLabel('知识标题', { exact: true }).fill('经营日报口径');
      await page.getByLabel('知识正文', { exact: true }).fill('客房收入以经营日口径核对，缺失金额必须标注待核实。');
      await page.getByLabel('来源与核实依据', { exact: true }).fill('本次验收测试资料，不包含真实酒店数据');
      await page.getByRole('button', { name: '保存知识', exact: true }).click();
      await expect(page.getByRole('heading', { name: '经营日报口径', exact: true })).toBeVisible();

      await page.getByRole('tab', { name: '岗位绑定' }).click();
      await expect(page.getByRole('button', { name: '保存岗位绑定' })).toHaveCount(8);
      await expect(page.getByText('AI 总管', { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('hotel-agent-bindings.png'), fullPage: true });
    } finally { await closeElectronApp(app); }
  });

  test('binds approval to a concrete plan and keeps unconnected business writes blocked', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-nav-hotel').click();
      await page.getByRole('button', { name: '新建任务', exact: true }).click();
      await page.getByLabel('任务标题', { exact: true }).fill('周末房价评审');
      await page.getByLabel('负责岗位', { exact: true }).selectOption('revenue');
      await page.getByLabel('任务类型', { exact: true }).selectOption('price_change');
      await page.getByLabel('希望达到的结果', { exact: true }).fill('审查价格变更，执行适配器未接通前保留为方案。');
      await page.getByLabel('影响对象', { exact: true }).fill('测试门店示例房型，不对应生产');
      await page.getByLabel('变更前', { exact: true }).fill('示例方案 A');
      await page.getByLabel('变更后', { exact: true }).fill('示例方案 B');
      await page.getByLabel('变更依据', { exact: true }).fill('演示审批版本控制，不代表经营建议。');
      await page.getByLabel('回退与补救办法', { exact: true }).fill('撤销方案，不修改任何生产后台。');
      await page.getByRole('button', { name: '建立任务', exact: true }).click();
      await page.getByRole('button', { name: '加入执行队列', exact: true }).click();
      await expect(page.getByRole('button', { name: '批准当前方案', exact: true })).toBeDisabled();
      await page.getByLabel('审批意见', { exact: true }).fill('仅批准展示的测试方案，等待后续接入验证。');
      await page.getByRole('button', { name: '批准当前方案', exact: true }).click();
      await expect(page.getByTestId('hotel-task-detail').getByText('已阻塞', { exact: true })).toBeVisible();
      await expect(page.getByText(/审批记录不等于后台已执行/)).toBeVisible();
      await page.getByRole('button', { name: '修改任务', exact: true }).click();
      await page.getByLabel('变更后', { exact: true }).fill('示例方案 C');
      await page.getByRole('button', { name: '保存新版本', exact: true }).click();
      await expect(page.getByText('经营变更方案 · v2', { exact: true })).toBeVisible();
      await expect(page.getByText(/老板已批准/)).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('hotel-approval-revision.png'), fullPage: true });
    } finally { await closeElectronApp(app); }
  });
});

test('labels native technical results as pending review without claiming Gateway execution', async ({ launchElectronApp, userDataDir }) => {
  // Synthetic persisted UI fixture only; not evidence of a real executor run.
  const { writeFile } = await import('node:fs/promises'); const { join } = await import('node:path');
  const stamp = '2026-11-27T05:00:00Z';
  const result = { summary: 'Synthetic native UI fixture', completedItems: ['fixture'], missingItems: [], sources: [], artifacts: [], dataPeriod: 'fixture', verificationNotes: 'UI fixture only', suggestedNextActions: [] };
  await writeFile(join(userDataDir, 'hotel-command-center.json'), JSON.stringify({ schemaVersion: 1, revision: 1, properties: [{ id: 'xingcheng-aigong', name: '测试门店', city: '测试', timezone: 'Asia/Shanghai', createdAt: stamp }], bindings: [], knowledge: [], schedules: [], audit: [], tasks: [{ id: 'native-ui-fixture', propertyId: 'xingcheng-aigong', title: '原生技术结果UI测试', objective: 'UI fixture only', role: 'codex', action: 'code', priority: 'normal', status: 'needs_review', dependencies: [], inputs: '', acceptanceCriteria: ['source label'], knowledgeIds: [], idempotencyKey: 'native-ui-fixture', requestHash: 'fixture', planVersion: 1, attempts: [{ id: 'fixture-attempt', executor: 'codex-cli', number: 1, sessionKey: 'codex-cli:fixture', dispatchKey: 'fixture', startedAt: stamp, leaseExpiresAt: stamp, endedAt: stamp, outcome: 'returned' }], assignedAgentId: 'codex-cli-technical', maxAttempts: 1, createdAt: stamp, updatedAt: stamp, result, resultOrigin: 'codex-cli' }] }));
  const app = await launchElectronApp({ skipSetup: true });
  try { const page = await getStableWindow(app); await page.getByTestId('sidebar-nav-hotel').click(); await page.getByRole('tab', { name: '任务与审批' }).click(); await page.getByRole('button', { name: '原生技术结果UI测试', exact: true }).click(); await expect(page.getByText(/原生Codex技术执行器回传/)).toBeVisible(); await expect(page.getByTestId('hotel-task-detail').getByText('待验收', { exact: true })).toBeVisible(); }
  finally { await closeElectronApp(app); }
});

test('renders OAuth callback receipt without premature success', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try { const page = await getStableWindow(app); await page.setContent(CALLBACK_RECEIVED_HTML); await expect(page.getByText(/Authorization callback received/)).toBeVisible(); await expect(page.getByText(/token exchange may still fail/)).toBeVisible(); await expect(page.getByText(/Authentication successful/)).toHaveCount(0); }
  finally { await closeElectronApp(app); }
});
