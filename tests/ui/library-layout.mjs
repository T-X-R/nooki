// Geometry and inline editing regressions for the folder workspace.
import assert from 'node:assert/strict';
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(() => {
    if (!localStorage.getItem('personal-workbench-preferences')) localStorage.setItem('personal-workbench-preferences', JSON.stringify({ state: { view: 'library', language: 'zh', theme: 'light' }, version: 4 }));
    if (!localStorage.getItem('personal-workbench-library-v2')) localStorage.setItem('personal-workbench-library-v2', JSON.stringify({ documents: [], history: {}, organization: { folders: [{ id: 'project', name: '项目', documentIds: [] }, { id: 'notes', name: '笔记', parentId: 'project', documentIds: [] }], topics: [], origins: {}, trash: {} } }));
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const directory = page.getByRole('navigation', { name: '资料目录', exact: true });
  const root = directory.getByRole('button', { name: '我的资料', exact: true });
  await root.waitFor();
  await page.locator('.library-folder-heading').waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.page-wrap')).transform === 'none');
  const dimensions = await page.evaluate(() => ({ top: document.querySelector('.library-workspace').getBoundingClientRect().top, directory: document.querySelector('.library-directory').getBoundingClientRect().width, header: document.querySelector('.library-shell-heading').getBoundingClientRect().height }));
  assert.ok(dimensions.top <= 65 && dimensions.header <= 60 && dimensions.directory <= 250, JSON.stringify(dimensions));
  assert.equal(await page.locator('.app-main > .topbar').count(), 0, 'Library uses one integrated toolbar');
  assert.equal(await root.locator('svg path').count(), 1, 'Root has a disclosure chevron and no folder icon');
  await root.click(); assert.equal(await root.getAttribute('aria-expanded'), 'false');
  assert.equal(await directory.getByRole('button', { name: '项目', exact: true }).count(), 0);
  await root.click(); assert.equal(await root.getAttribute('aria-expanded'), 'true');
  await directory.getByRole('button', { name: '笔记', exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1240, 800, 640]) {
      await page.setViewportSize({ width, height: 820 });
      for (const label of ['添加到 项目', '文件夹操作 项目']) {
        const trigger = directory.getByRole('button', { name: label, exact: true });
        await trigger.click();
        const menu = page.getByRole('menu', { name: label, exact: true });
        const bounds = await menu.evaluate(el => { const box = el.getBoundingClientRect(); return { x: box.x, right: box.right, y: box.y, bottom: box.bottom, height: box.height, children: [...el.querySelectorAll('button')].map(item => item.getBoundingClientRect().height) }; });
        assert.ok(bounds.height <= 150 && bounds.x >= 0 && bounds.right <= width && bounds.y >= 0 && bounds.bottom <= 820 && bounds.children.every(height => height >= 32 && height <= 40), JSON.stringify({ theme, width, label, bounds }));
        await page.screenshot({ path: `/private/tmp/nooki-library-menu-${theme}-${width}-${label.startsWith('添加') ? 'add' : 'more'}.png` });
        await page.keyboard.press('Escape'); assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
      }
    }
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  // Rename from the content list stays in that list, supports blur, and persists.
  const list = page.locator('.library-folder-list');
  await list.getByRole('button', { name: '文件夹操作 项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const field = list.getByRole('textbox', { name: '文件夹名称', exact: true });
  await field.fill('项目资料');
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByRole('heading', { name: '我的资料', exact: true }).click();
  await list.getByRole('button', { name: /项目资料/ }).first().waitFor();
  await page.reload(); await directory.getByRole('button', { name: '项目资料', exact: true }).waitFor();
  await directory.getByRole('button', { name: '项目资料', exact: true }).click();
  await page.locator('.library-shell-heading').getByRole('button', { name: '文件夹操作 项目资料', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const headingField = page.locator('.library-folder-heading').getByRole('textbox', { name: '文件夹名称', exact: true });
  await headingField.fill('取消的名字'); await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: '项目资料', exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.tagName === 'H2');
  await page.getByRole('button', { name: '搜索 Nooki (⌘ K)', exact: true }).click();
  await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: compact unified toolbar, narrower directory, collapsible icon-free root, bounded menus in themes/viewports, inline rename from list/heading, blur/save/cancel/reload and global search');
} catch (error) { await page.screenshot({ path: '/private/tmp/nooki-library-layout-failure.png' }).catch(() => {}); throw error; }
finally { await browser.close(); }
