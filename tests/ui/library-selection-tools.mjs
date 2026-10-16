import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
page.setDefaultTimeout(10000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(() => {
    localStorage.setItem('personal-workbench-preferences', JSON.stringify({ state: { view: 'library', language: 'zh', theme: 'light' }, version: 4 }));
    const doc = { id: 'notes/documents/2026/10/selection', key: 'selection', title: '白纸笔记', content: '选择这段文字\n\n第二段正文', capabilityId: 'notes', capabilityName: 'Notes', collectionKey: 'documents', collectionName: 'Documents', documentDate: '2026-10-16', createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z', revision: 'original', format: 'markdown', sizeBytes: 80 };
    localStorage.setItem('personal-workbench-library-v2', JSON.stringify({ documents: [doc], history: {}, organization: { folders: [], topics: [], origins: {}, trash: {} } }));
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  await page.getByRole('navigation', { name: '资料目录', exact: true }).getByRole('button', { name: '白纸笔记', exact: true }).click();
  const title = page.getByRole('textbox', { name: '文档标题', exact: true });
  const editor = page.getByRole('textbox', { name: '文档正文', exact: true });
  const tools = page.getByRole('toolbar', { name: '文档工具', exact: true });
  await editor.waitFor();
  assert.equal(await tools.isVisible(), false, 'The paper has no persistent toolbar row');
  assert.equal(await page.getByRole('button', { name: '插入内容', exact: true }).count(), 0, 'Blocks are inserted with slash');
  const first = editor.locator('p').first();
  await first.click({ position: { x: 12, y: 10 } }); await page.keyboard.press('Meta+ArrowLeft');
  assert.equal(await tools.isVisible(), false, 'A caret alone does not show tools');
  const before = await first.boundingBox();
  await page.keyboard.press('Meta+Shift+ArrowRight'); await tools.waitFor();
  const after = await first.boundingBox();
  assert.equal(after.y, before.y, 'Selecting text never shifts the document');
  assert.notEqual(await tools.evaluate(el => getComputedStyle(el).position), 'static');
  assert.ok(Math.abs((await tools.boundingBox()).y - before.y) < 90, 'Tools float beside the selection');
  await tools.getByRole('button', { name: '粗体', exact: true }).click();
  assert.equal(await first.locator('strong').textContent(), '选择这段文字');
  assert.equal(await tools.getByRole('button', { name: '粗体', exact: true }).getAttribute('aria-pressed'), 'true');
  await tools.getByRole('button', { name: '斜体', exact: true }).click();
  assert.equal(await first.locator('em').textContent(), '选择这段文字', 'Clicking a tool preserves the selected range');
  await page.keyboard.press('ArrowRight'); await tools.waitFor({ state: 'hidden' });
  // Mouse selection and blur have the same behavior as keyboard selection.
  await first.dblclick({ position: { x: 12, y: 10 } }); await tools.waitFor();
  await title.click(); await tools.waitFor({ state: 'hidden' });
  await title.press('Meta+ArrowLeft'); await title.press('Meta+Shift+ArrowRight');
  assert.equal(await tools.isVisible(), false, 'Selecting the title does not open body tools');
  // Selection tools remain reachable by keyboard and dismiss on Escape.
  await first.click({ position: { x: 12, y: 10 } }); await page.keyboard.press('Meta+ArrowLeft'); await page.keyboard.press('Meta+Shift+ArrowRight'); await tools.waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await tools.evaluate(el => el.contains(document.activeElement)), true);
  await page.keyboard.press('Escape'); await tools.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '文档正文');
  assert.equal(await editor.evaluate(el => el === document.activeElement), true);
  // Slash insertion and cancellation work without a separate plus menu.
  await editor.locator('p').last().click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.insertText('/');
  const quick = page.getByRole('menu', { name: '快捷插入', exact: true }); await quick.waitFor();
  assert.equal(await tools.isVisible(), false);
  await quick.getByRole('menuitem', { name: '标题 2', exact: true }).click(); await page.keyboard.insertText('快捷标题');
  await editor.getByRole('heading', { name: '快捷标题', exact: true, level: 2 }).waitFor();
  await page.keyboard.press('Enter'); await page.keyboard.insertText('/'); await quick.waitFor(); await page.keyboard.press('Escape'); await quick.waitFor({ state: 'hidden' });
  await page.keyboard.press('Backspace'); await page.keyboard.press('Meta+Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents[0].content.includes('快捷标题'));
  assert.match(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents[0].content), /\*.*选择这段文字.*\*/);
  // Theme/viewport checks cover multi-line selection and clipping near page edges.
  await editor.fill('用于检查浮动工具条换行定位和页面边缘的长段落。'.repeat(12));
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1240, 800, 640]) {
      await page.setViewportSize({ width, height: 820 });
      await editor.click(); await page.keyboard.press('Meta+ArrowUp'); await page.keyboard.press('Shift+ArrowDown'); await tools.waitFor();
      const box = await tools.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0, `${theme}/${width}: ${JSON.stringify(box)}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.page-wrap')).transform === 'none');
      await page.screenshot({ path: `/private/tmp/nooki-selection-tools-${theme}-${width}.png` });
      await page.keyboard.press('ArrowRight'); await tools.waitFor({ state: 'hidden' });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: selection-only floating tools, no layout shift, pointer/keyboard formatting, selection preservation, blur/Escape dismissal, slash insertion, themes and viewport bounds');
} catch (error) { await page.screenshot({ path: '/private/tmp/nooki-selection-tools-failure.png' }); throw error; }
finally { await browser.close(); }
