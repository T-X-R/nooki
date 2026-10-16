import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(() => {
    if (!localStorage.getItem('personal-workbench-preferences')) localStorage.setItem('personal-workbench-preferences', JSON.stringify({ state: { view: 'library', language: 'zh', theme: 'light' }, version: 4 }));
    if (!localStorage.getItem('personal-workbench-library-v2')) {
      const versions = Array.from({ length: 15 }, (_, index) => ({ id: 'notes/documents/2026/10/one', key: 'one', title: `标题 ${index}`, content: `# 正文 ${index}\n\n第 ${index} 版`, capabilityId: 'notes', capabilityName: 'Notes', collectionKey: 'documents', collectionName: 'Documents', documentDate: '2026-10-16', createdAt: '2026-10-16T00:00:00Z', updatedAt: `2026-10-16T00:00:${String(index).padStart(2,'0')}Z`, revision: `version-${index}`, format: 'markdown', sizeBytes: 40 }));
      localStorage.setItem('personal-workbench-library-v2', JSON.stringify({ documents: [versions[14]], history: { [versions[14].id]: versions.slice(0,14) }, organization: { folders: [], topics: [], origins: {}, trash: {} } }));
    }
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const directory = page.getByRole('navigation', { name: '资料目录', exact: true });
  await directory.getByRole('button', { name: '标题 14', exact: true }).click();
  const title = page.getByRole('textbox', { name: '文档标题', exact: true });
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await title.waitFor();
  for (const field of [title, body]) {
    await field.focus();
    const style = await field.evaluate(el => { const css = getComputedStyle(el); return { border: css.borderWidth, outline: css.outlineStyle, shadow: css.boxShadow, background: css.backgroundColor }; });
    assert.ok(style.border.split(' ').every(width => parseFloat(width) === 0), JSON.stringify(style));
    assert.ok(['none', 'hidden'].includes(style.outline), JSON.stringify(style));
    assert.equal(style.shadow, 'none');
  }
  const paper = page.locator('.library-inline-document');
  assert.ok((await paper.boundingBox()).height >= (await page.locator('.library-folder-content').boundingBox()).height - 24, 'The editable paper fills the document pane');
  // Clicking white space places the caret in the document rather than a separate editor mode.
  await body.click({ position: { x: 100, y: 280 } }); assert.equal(await body.evaluate(el => el === document.activeElement), true);
  await page.getByRole('button', { name: '文档更多操作', exact: true }).click(); await page.getByRole('menuitem', { name: '版本历史', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '版本历史', exact: true });
  await panel.waitFor(); assert.equal(await page.getByRole('dialog').count(), 0);
  const versions = panel.getByRole('navigation', { name: '选择版本', exact: true }).getByRole('button');
  await page.waitForFunction(() => document.querySelectorAll('.library-history-panel nav button').length === 10);
  assert.equal(await versions.count(), 10);
  assert.equal(await panel.evaluate(el => getComputedStyle(el).scrollbarWidth), 'none');
  assert.equal(await panel.evaluate(el => getComputedStyle(el, '::-webkit-scrollbar').display), 'none');
  await page.setViewportSize({ width: 1240, height: 420 });
  assert.ok(await panel.evaluate(el => el.scrollHeight > el.clientHeight), 'History overflows in a short window');
  await panel.hover(); await page.mouse.wheel(0, 320);
  await page.waitForFunction(() => document.querySelector('.library-history-panel').scrollTop > 0);
  await versions.last().click();
  await page.setViewportSize({ width: 1240, height: 820 });
  const preview = page.getByRole('region', { name: '版本正文', exact: true });
  await preview.getByRole('heading', { name: '正文 5', exact: true }).waitFor();
  assert.equal(await body.count(), 0, 'Historical content is read-only in the same document pane');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents[0].content), '# 正文 14\n\n第 14 版', 'Selecting history never publishes it');
  await versions.first().click(); await preview.getByRole('heading', { name: '正文 14', exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1240, 800, 640]) {
      await page.setViewportSize({ width, height: 820 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `History does not overflow at ${theme}/${width}`);
      assert.ok(await panel.getByRole('button', { name: '关闭版本历史', exact: true }).isVisible());
      await page.waitForFunction(() => document.querySelectorAll('.page-wrap').length === 1 && getComputedStyle(document.querySelector('.page-wrap')).transform === 'none');
      await page.screenshot({ path: `/private/tmp/nooki-paper-history-${theme}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1240, height: 820 }); await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
  await body.getByRole('heading', { name: '正文 14', exact: true }).waitFor(); assert.equal(await title.inputValue(), '标题 14');
  await page.getByRole('button', { name: '文档更多操作', exact: true }).click(); await page.getByRole('menuitem', { name: '版本历史', exact: true }).click();
  await versions.last().click(); await panel.getByRole('button', { name: '恢复此版本', exact: true }).click();
  await preview.getByRole('heading', { name: '正文 5', exact: true }).waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents[0].content.includes('正文 5'));
  assert.equal(await versions.count(), 10); assert.equal(await versions.first().getAttribute('aria-pressed'), 'true');
  await panel.getByRole('button', { name: '关闭版本历史', exact: true }).click();
  await body.getByRole('heading', { name: '正文 5', exact: true }).waitFor();
  assert.equal(await title.inputValue(), '标题 5');
  // Restored versions remain editable without a border or modal.
  await title.fill('恢复后改名'); await page.keyboard.press('Enter'); await body.fill('恢复后继续写'); await page.keyboard.press('Meta+Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents[0].content.includes('恢复后继续写'));
  await page.reload(); await directory.getByRole('button', { name: '恢复后改名', exact: true }).click();
  assert.equal(await title.inputValue(), '恢复后改名');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).history['notes/documents/2026/10/one'].length), 9);
  assert.deepEqual(errors, []);
  console.log('PASS: borderless full-height document paper, compact history sidebar, ten-version cap, nonmutating inline previews, close/Escape, explicit restore and subsequent editing');
} catch (error) { await page.screenshot({ path: '/private/tmp/nooki-paper-history-failure.png' }); throw error; }
finally { await browser.close(); }
