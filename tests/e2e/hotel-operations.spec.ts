import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

// These tests use the real Host API and isolated Electron user-data directory.
// No production Gateway, hotel account, or fabricated success response is used.
test.describe('Hotel operations command center', () => {
  test('persists a hotel task and knowledge while showing missing metrics honestly', async ({ launchElectronApp }, testInfo) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await page.getByTestId('sidebar-nav-hotel').click();
      await expect(page.getByTestId('hotel-page-title')).toHaveText('酒店总管');
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
