// Uses the real browser Library store in an isolated profile; no personal data is changed.
import assert from 'node:assert/strict';
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(`${message.text()} ${message.location().url}`); });
try {
  // The desktop shell has no browser favicon; avoid Chrome's unrelated automatic 404.
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    if (!localStorage.getItem('personal-workbench-preferences')) localStorage.setItem('personal-workbench-preferences', JSON.stringify({ state: { view: 'library', language: 'zh', theme: 'light' }, version: 4 }));
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'personal-workbench-library-v2' && window.failSave) throw new Error('Disk full');
      return setItem.call(this, key, value);
    };
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const create = page.getByRole('button', { name: '创建文档', exact: true });
  await create.click();
  const dialog = page.getByRole('dialog', { name: '创建文档', exact: true });
  const save = dialog.getByRole('button', { name: '创建并保存', exact: true });
  const title = dialog.getByRole('textbox', { name: '文档标题', exact: true });
  const content = dialog.getByRole('textbox', { name: '正文', exact: true });
  assert.equal(await title.evaluate(el => el === document.activeElement), true);
  assert.ok(await save.isDisabled());
  await title.fill('项目观察笔记');
  assert.ok(await save.isDisabled());
  await dialog.getByRole('button', { name: '预览', exact: true }).click();
  await dialog.getByText('写下内容后，在这里查看排版效果。', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '编辑', exact: true }).click();
  const source = '# 本周观察\n\n- 记录关键变化\n- 留下下一步行动\n\n| 事项 | 进展 |\n| --- | --- |\n| 新建文档 | 已完成 |\n\n```json\n{"status":"ready"}\n```';
  await content.fill(source);
  await dialog.getByRole('button', { name: '预览', exact: true }).click();
  await dialog.getByRole('heading', { name: '本周观察', exact: true }).waitFor();
  assert.equal(await dialog.locator('table').count(), 1);
  assert.equal(await dialog.locator('pre').count(), 1);
  await page.screenshot({ path: '/private/tmp/nooki-create-preview.png' });
  await dialog.getByRole('button', { name: '编辑', exact: true }).click();
  assert.equal(await content.inputValue(), source);
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await content.inputValue(), source);
  await page.evaluate(() => { window.failSave = true; });
  await save.click();
  await dialog.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor();
  assert.equal(await content.inputValue(), source);
  await page.evaluate(() => { window.failSave = false; });
  await save.click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.library-reader-header h2').filter({ hasText: '项目观察笔记' }).waitFor();
  await page.reload();
  await page.locator('.library-reader-header h2').filter({ hasText: '项目观察笔记' }).waitFor();
  await page.getByRole('button', { name: '修订', exact: true }).click();
  const revision = page.getByRole('dialog', { name: '修订文档', exact: true });
  assert.equal(await revision.getByRole('textbox', { name: '编辑 Markdown', exact: true }).inputValue(), source);
  await revision.getByRole('button', { name: '关闭', exact: true }).click();
  const topics = page.locator('#sidebar-library-topics');
  await topics.getByRole('button', { name: '新建专题', exact: true }).click();
  await topics.getByRole('textbox', { name: '专题名称' }).fill('项目笔记');
  await page.keyboard.press('Enter');
  await topics.getByRole('button', { name: '项目笔记', exact: true }).click();
  await create.click();
  await dialog.getByText('项目笔记 / 我的文档', { exact: true }).waitFor();
  await title.fill('专题中的新文档');
  await content.fill('写在专题里。');
  await save.click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.library-reader-header h2').filter({ hasText: '专题中的新文档' }).waitFor();
  await create.click();
  await title.fill('长文写作测试');
  await content.fill(source.repeat(40));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1240, 768, 640, 320]) {
      await page.setViewportSize({ width, height: 820 });
      await dialog.getByRole('button', { name: '预览', exact: true }).click();
      const bounds = await dialog.evaluate(el => {
        const box = el.getBoundingClientRect(), footer = el.querySelector('footer').getBoundingClientRect();
        return { left: box.left, right: box.right, bottom: footer.bottom, overflow: el.scrollWidth > el.clientWidth };
      });
      assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.bottom <= 820 && !bounds.overflow, JSON.stringify({ width, theme, bounds }));
      await dialog.screenshot({ path: `/private/tmp/nooki-create-${theme}-${width}.png` });
      await dialog.getByRole('button', { name: '编辑', exact: true }).click();
      assert.equal(await content.inputValue(), source.repeat(40));
    }
  }
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: '放弃文档', exact: true }).click();
  await page.setViewportSize({ width: 1240, height: 820 });
  await topics.getByRole('button', { name: '全部资料', exact: true }).click();
  assert.equal(await page.locator('.library-document-link').count(), 2);
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: 'EN English English interface', exact: true }).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Create document', exact: true }).click();
  const english = page.getByRole('dialog', { name: 'Create document', exact: true });
  await english.getByRole('textbox', { name: 'Document title', exact: true }).waitFor();
  await english.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('PASS: direct creation, durable readback, revision entry, topic membership, preview, failure retry, discard, light/dark layouts at 1240/768/640/320px, English, clean page errors');
} finally { await browser.close(); }
