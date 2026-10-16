// Runs against the real browser Library store in an isolated profile.
import assert from 'node:assert/strict';
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
try {
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    if (!localStorage.getItem('personal-workbench-preferences')) localStorage.setItem('personal-workbench-preferences', JSON.stringify({ state: { view: 'library', language: 'zh', theme: 'light' }, version: 4 }));
    if (!localStorage.getItem('personal-workbench-library-v2')) {
      const doc = { id: 'com.personal.notes/notes/2026/10/entry', key: 'entry', capabilityId: 'com.personal.notes', capabilityName: '笔记', collectionKey: 'notes', collectionName: 'Notes', title: '项目观察', content: '# 观察\n\n保留这份文档。', documentDate: '2026-10-16', createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z', revision: 'original', format: 'markdown', sizeBytes: 64 };
      const section = { id: 'custom-reading', name: '阅读笔记' };
      localStorage.setItem('personal-workbench-library-v2', JSON.stringify({ documents: [doc], history: {}, organization: { topics: [], trash: {}, origins: {}, sections: { [doc.id]: section }, customSections: [section, { id: 'custom-other', name: '其他栏目' }] } }));
    }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'personal-workbench-library-v2' && window.failSave) throw new Error('Disk full');
      return setItem.call(this, key, value);
    };
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const rename = name => page.getByRole('button', { name: `重命名栏目：${name}`, exact: true });
  const remove = name => page.getByRole('button', { name: `删除栏目：${name}`, exact: true });
  const renameDialog = page.getByRole('dialog', { name: '重命名栏目', exact: true });
  const field = renameDialog.getByRole('textbox', { name: '栏目名称', exact: true });
  await rename('阅读笔记').focus();
  await page.keyboard.press('Enter');
  assert.equal(await field.inputValue(), '阅读笔记');
  assert.equal(await field.evaluate(el => el === document.activeElement), true);
  await field.fill(' ');
  assert.ok(await renameDialog.getByRole('button', { name: '保存名称', exact: true }).isDisabled());
  await field.fill('其他栏目');
  await page.keyboard.press('Enter');
  await renameDialog.getByRole('alert').filter({ hasText: 'Section already exists' }).waitFor();
  await field.fill('长期阅读');
  await page.evaluate(() => { window.failSave = true; });
  await page.keyboard.press('Enter');
  await renameDialog.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor();
  assert.equal(await field.inputValue(), '长期阅读');
  await page.evaluate(() => { window.failSave = false; });
  await page.keyboard.press('Enter');
  await renameDialog.waitFor({ state: 'hidden' });
  await rename('长期阅读').waitFor();
  await page.reload();
  await rename('长期阅读').waitFor();
  await rename('长期阅读').click();
  await field.fill('不保存的名字');
  await page.keyboard.press('Escape');
  await rename('长期阅读').waitFor();
  assert.equal(await rename('不保存的名字').count(), 0);
  const deletion = page.getByRole('dialog', { name: '删除栏目', exact: true });
  await remove('长期阅读').click();
  await deletion.getByText(/其中的文档会保留并回到原来源栏目/).waitFor();
  await deletion.screenshot({ path: '/private/tmp/nooki-section-delete-confirm.png' });
  await deletion.getByRole('button', { name: '取消', exact: true }).click();
  await rename('长期阅读').waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1240, 768, 640]) {
      await page.setViewportSize({ width, height: 820 });
      await page.locator('.library-capability-node').filter({ hasText: '长期阅读' }).screenshot({ path: `/private/tmp/nooki-section-${theme}-${width}.png` });
      const overlap = await page.locator('.library-section-heading-row').filter({ hasText: '长期阅读' }).evaluate(row => {
        const heading = row.querySelector('.library-capability-heading').getBoundingClientRect(), actions = row.querySelector('.library-section-actions').getBoundingClientRect();
        return heading.right > actions.left;
      });
      assert.equal(overlap, false);
    }
  }
  await remove('长期阅读').click();
  await page.evaluate(() => { window.failSave = true; });
  await deletion.getByRole('button', { name: '删除栏目', exact: true }).click();
  await deletion.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor();
  await page.evaluate(() => { window.failSave = false; });
  await deletion.getByRole('button', { name: '删除栏目', exact: true }).click();
  await deletion.waitFor({ state: 'hidden' });
  await rename('长期阅读').waitFor({ state: 'hidden' });
  await page.locator('.library-capability-node').filter({ hasText: '笔记' }).getByRole('button', { name: '项目观察 2026-10-16', exact: true }).waitFor();
  assert.equal(await rename('笔记').count(), 0);
  await page.reload();
  await page.locator('.library-reader-header h2').filter({ hasText: '项目观察' }).waitFor();
  assert.equal(await rename('长期阅读').count(), 0);
  await remove('其他栏目').click();
  await deletion.getByRole('button', { name: '删除栏目', exact: true }).click();
  await deletion.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.library-document-link').count(), 1);
  await page.getByRole('button', { name: '新建栏目', exact: true }).click();
  await page.getByRole('textbox', { name: '栏目名称', exact: true }).fill('英文测试');
  await page.keyboard.press('Enter');
  await rename('英文测试').waitFor();
  await page.locator('.sidebar-settings').click();
  await page.getByRole('button', { name: 'EN English English interface', exact: true }).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Rename section：英文测试', exact: true }).click();
  await page.getByRole('textbox', { name: 'Section name', exact: true }).fill('Reading');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await page.getByRole('button', { name: 'Delete section：Reading', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete section', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log('PASS: section rename/delete, keyboard, duplicates, cancellation, failure retry, persistence, documents retained at source, empty deletion, English, light/dark layout');
} finally { await browser.close(); }
