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
  const directory = page.getByRole('navigation', { name: '资料目录', exact: true });
  const create = async (name = '我的资料') => { await directory.getByRole('button', { name: `添加到 ${name}`, exact: true }).click(); await page.getByRole('menuitem', { name: '新建文档', exact: true }).click(); };
  await create();
  const dialog = page.getByRole('dialog', { name: '创建文档', exact: true });
  const save = dialog.getByRole('button', { name: '创建并保存', exact: true });
  const title = dialog.getByRole('textbox', { name: '文档标题', exact: true });
  const content = dialog.getByRole('textbox', { name: '正文', exact: true });
  assert.equal(await title.evaluate(el => el === document.activeElement), true);
  assert.equal(await dialog.getByRole('button', { name: /^保存到栏目 / }).count(), 0);
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
  await directory.getByRole('button', { name: '项目观察笔记', exact: true }).click();
  await page.locator('.library-reader-header h2').filter({ hasText: '项目观察笔记' }).waitFor();
  assert.equal(await page.locator('.library-capability-heading').count(), 0);
  await page.getByRole('region', { name: '文档正文', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '编辑 Markdown', exact: true }).inputValue(), source);
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.keyboard.press('Escape');
  const newFolder = async (name, parent = '我的资料') => {
    await directory.getByRole('button', { name: `添加到 ${parent}`, exact: true }).click();
    await page.getByRole('menuitem', { name: '新建文件夹', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '新建文件夹', exact: true });
    await modal.getByRole('textbox', { name: '文件夹名称', exact: true }).fill(name);
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    await directory.getByRole('button', { name, exact: true }).waitFor();
  };
  await newFolder('项目笔记');
  await create('项目笔记');
  await dialog.getByText('我的资料 / 项目笔记', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('listbox').count(), 0);
  await title.fill('文件夹中的新文档');
  await content.fill('直接写在当前文件夹。');
  await save.click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.library-reader-header h2').filter({ hasText: '文件夹中的新文档' }).waitFor();
  await newFolder('优化方向', '项目笔记');
  await newFolder('已归档');
  const movedLink = () => directory.getByRole('button', { name: '文件夹中的新文档', exact: true });
  await directory.getByRole('button', { name: '收起 已归档', exact: true }).click();
  await movedLink().dragTo(page.locator('.library-shell-heading'));
  await movedLink().waitFor();
  assert.equal(await page.locator('.is-drop-target').count(), 0);
  await page.evaluate(() => { window.failSave = true; });
  await movedLink().dragTo(directory.getByRole('button', { name: '已归档', exact: true }));
  await page.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor();
  await movedLink().waitFor();
  await page.evaluate(() => { window.failSave = false; });
  let dragTimer;
  try {
    await Promise.race([
      movedLink().dragTo(directory.getByRole('button', { name: '已归档', exact: true })),
      new Promise((_, reject) => { dragTimer = setTimeout(() => reject(new Error('Drag retry did not finish')), 10000); }),
    ]);
  } finally { clearTimeout(dragTimer); }
  await page.getByRole('status').filter({ hasText: '资料已移动。' }).waitFor();
  await movedLink().waitFor();
  await directory.getByRole('button', { name: '收起 已归档', exact: true }).waitFor();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')));
  const moved = stored.documents.find(doc => doc.title === '文件夹中的新文档');
  assert.equal(stored.organization.folders.find(folder => folder.name === '已归档').documentIds.includes(moved.id), true);
  assert.equal(stored.organization.folders.find(folder => folder.name === '项目笔记').documentIds.includes(moved.id), false);
  assert.equal(stored.history[moved.id], undefined);
  await page.screenshot({ path: '/private/tmp/nooki-folders-drag.png' });
  await movedLink().dragTo(directory.getByRole('button', { name: '我的资料', exact: true }));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).organization.folders.every(folder => folder.documentIds.length === 0));
  await page.reload();
  await movedLink().waitFor();
  await create('优化方向');
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
  assert.equal(await directory.locator('.library-directory-document').count(), 2);
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: 'EN English English interface', exact: true }).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('navigation', { name: 'Library directory', exact: true }).getByRole('button', { name: 'Add to My documents', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New document', exact: true }).click();
  const english = page.getByRole('dialog', { name: 'Create document', exact: true });
  await english.getByRole('textbox', { name: 'Document title', exact: true }).waitFor();
  await english.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('PASS: contextual root/nested creation, no destination picker, folder creation, durable readback, drag cancellation/failure/retry, collapsed destinations, root moves, revision preservation, preview, discard, light/dark layouts, English, clean console');
} catch (error) {
  await page.screenshot({ path: '/private/tmp/nooki-drag-test-failure.png', timeout: 5000 }).catch(() => {});
  console.error(await page.locator('.library-page').innerText({ timeout: 5000 }).catch(() => 'Library unavailable'));
  throw error;
} finally { await browser.close(); }
