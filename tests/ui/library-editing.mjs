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
    if (!localStorage.getItem('personal-workbench-library-v2')) {
      const doc = { id: 'notes/documents/2026/10/one', key: 'one', title: '原位笔记', content: '# 原始正文\n\n保留原始内容。', capabilityId: 'notes', capabilityName: 'Notes', collectionKey: 'documents', collectionName: 'Documents', documentDate: '2026-10-16', createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z', revision: 'original', format: 'markdown', sizeBytes: 32 };
      localStorage.setItem('personal-workbench-library-v2', JSON.stringify({ documents: [doc, { ...doc, id: 'notes/documents/2026/10/two', key: 'two', title: '子文件夹笔记', content: 'Second' }, { ...doc, id: 'notes/documents/2026/10/trash', key: 'trash', title: '已删除笔记' }], history: {}, organization: { folders: [{ id: 'project', name: '项目', documentIds: [doc.id] }, { id: 'child', name: '子目录', parentId: 'project', documentIds: [doc.id, 'notes/documents/2026/10/two', 'notes/documents/2026/10/trash'] }], topics: [], origins: {}, trash: { 'notes/documents/2026/10/trash': '2026-10-16' } } }));
    }
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'personal-workbench-library-v2' && window.failSave) throw new Error('Disk full'); return set.call(this, key, value); };
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const directory = page.getByRole('navigation', { name: '资料目录', exact: true });
  const toolbar = page.locator('.library-shell-heading');
  assert.equal(await toolbar.locator('.library-menu-anchor').count(), 0, 'Folders have no global add or more menu');
  await directory.getByRole('button', { name: '原位笔记', exact: true }).first().click();
  const content = page.getByRole('region', { name: '文档正文', exact: true });
  await content.getByRole('heading', { name: '原始正文', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '修订', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '继续讨论', exact: true }).count(), 0);
  await toolbar.getByRole('button', { name: '文档更多操作', exact: true }).click();
  assert.deepEqual(await page.getByRole('menu', { name: '文档更多操作', exact: true }).getByRole('menuitem').allTextContents(), ['导出 Markdown', '版本历史']);
  await page.keyboard.press('Escape');
  await content.click();
  const editor = page.getByRole('textbox', { name: '编辑 Markdown', exact: true });
  assert.equal(await editor.inputValue(), '# 原始正文\n\n保留原始内容。');
  const markdown = '# 原位完成\n\n- 第一项\n- 第二项\n\n| 项目 | 状态 |\n| --- | --- |\n| 编辑 | 完成 |';
  await editor.fill(markdown);
  await toolbar.getByRole('heading', { name: '资料库', exact: true }).click();
  await content.getByRole('heading', { name: '原位完成', exact: true }).waitFor();
  assert.equal(await content.locator('table').count(), 1);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).history['notes/documents/2026/10/one'].length), 1);
  // Escape cancels an unsaved edit; Cmd+Enter saves and restores formatted preview.
  await content.click(); await editor.fill('# 不保存'); await page.keyboard.press('Escape');
  await content.getByRole('heading', { name: '原位完成', exact: true }).waitFor();
  await content.click(); await editor.fill(markdown + '\n\n快捷键保存。'); await page.keyboard.press('Meta+Enter');
  await content.getByText('快捷键保存。', { exact: true }).waitFor();
  // A failed save survives switching documents and reloading; retry remains version checked.
  await content.click(); await editor.fill('# 待恢复草稿'); await page.evaluate(() => { window.failSave = true; });
  await toolbar.getByRole('heading', { name: '资料库', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor();
  assert.equal(await editor.inputValue(), '# 待恢复草稿');
  await directory.getByRole('button', { name: '文件夹操作 项目', exact: true }).click();
  await page.getByRole('menuitem', { name: '去讨论', exact: true }).click();
  assert.equal(await page.locator('.conversation-page').count(), 0, 'A failed draft save prevents sending stale content to a conversation');
  await page.reload(); await directory.getByRole('button', { name: '原位笔记', exact: true }).first().click();
  assert.equal(await editor.inputValue(), '# 待恢复草稿');
  await page.keyboard.press('Meta+Enter'); await content.getByRole('heading', { name: '待恢复草稿', exact: true }).waitFor();
  await content.click(); await editor.fill('# 冲突草稿'); await page.evaluate(async () => {
    const { createLibraryStore } = await import('/src/platform/library-store.ts');
    const store = createLibraryStore(localStorage), doc = store.read('notes/documents/2026/10/one');
    store.change({ kind: 'edit', id: doc.id, title: doc.title, content: '# 外部新版本', expected: doc.revision });
  });
  await page.keyboard.press('Meta+Enter'); await page.getByRole('alert').filter({ hasText: 'Document changed' }).waitFor();
  assert.equal(await editor.inputValue(), '# 冲突草稿');
  await page.reload(); await directory.getByRole('button', { name: '原位笔记', exact: true }).first().click();
  await page.keyboard.press('Escape'); await content.getByRole('heading', { name: '外部新版本', exact: true }).waitFor();
  // Document rename edits the title in place, with no revision dialog.
  await directory.getByRole('button', { name: '文档操作 原位笔记', exact: true }).first().click();
  assert.equal((await page.getByRole('menu', { name: '文档操作 原位笔记', exact: true }).getByRole('menuitem').allTextContents())[0], '去讨论');
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('原位新标题'); await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '原位新标题', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await toolbar.getByRole('button', { name: '文档更多操作', exact: true }).click(); await page.getByRole('menuitem', { name: '版本历史', exact: true }).click();
  await page.getByRole('dialog', { name: '版本历史', exact: true }).getByRole('button', { name: '关闭', exact: true }).last().click();
  // The first folder menu action attaches the recursive, deduplicated live contents.
  await directory.getByRole('button', { name: '文件夹操作 项目', exact: true }).click();
  assert.equal((await page.getByRole('menu', { name: '文件夹操作 项目', exact: true }).getByRole('menuitem').allTextContents())[0], '去讨论');
  await page.getByRole('menuitem', { name: '去讨论', exact: true }).click();
  await page.locator('.conversation-attachments').getByRole('button', { name: '原位新标题', exact: true }).waitFor();
  assert.equal(await page.locator('.conversation-attachments > span').count(), 2);
  assert.equal(await page.locator('.conversation-attachments').getByText('已删除笔记', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '资料库', exact: true }).click();
  await directory.getByRole('button', { name: '原位新标题', exact: true }).first().waitFor();
  // Invoke the real Tauri JS API with an IPC recorder, checking descendant targets and exclusions.
  await page.evaluate(() => { window.dragCommands = []; window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' } }, invoke: async (command) => { if (command.startsWith('plugin:window|')) window.dragCommands.push(command); const state = JSON.parse(localStorage.getItem('personal-workbench-library-v2')); if (command === 'library_list_documents') return state.documents.filter(doc => !state.organization.trash[doc.id]); if (command === 'library_organization') return state.organization; return null; } }; });
  await toolbar.getByRole('heading', { name: '资料库', exact: true }).dispatchEvent('mousedown', { button: 0, detail: 1 });
  await toolbar.locator('.library-shell-title > span').dispatchEvent('mousedown', { button: 0, detail: 1 });
  await toolbar.getByRole('button', { name: '搜索 Nooki (⌘ K)', exact: true }).dispatchEvent('mousedown', { button: 0, detail: 1 });
  await toolbar.getByRole('button', { name: '我的资料', exact: true }).dispatchEvent('mousedown', { button: 0, detail: 1 });
  await toolbar.getByRole('heading', { name: '资料库', exact: true }).dispatchEvent('mousedown', { button: 0, detail: 2 });
  assert.deepEqual(await page.evaluate(() => window.dragCommands), ['plugin:window|start_dragging', 'plugin:window|start_dragging', 'plugin:window|toggle_maximize']);
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__; });
  assert.deepEqual(errors, []);
  console.log('PASS: inline autosave/Markdown preview/title rename, keyboard save/cancel, durable drafts, failure/retry, revision conflicts/history, scoped toolbar menus, recursive folder discussion, real Tauri drag API with interactive exclusions');
} catch (error) { await page.screenshot({ path: '/private/tmp/nooki-inline-edit-failure.png' }).catch(() => {}); throw error; }
finally { await browser.close(); }
