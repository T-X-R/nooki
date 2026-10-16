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
      const doc = { id: 'notes/documents/2026/10/one', key: 'one', title: '原位笔记', content: '# 原始正文\n\n保留原始内容。\n\n- 第一项\n  - 子项\n- 第二项\n\n- [x] 已完成\n- [ ] 待办\n\n| 项目 | 状态 |\n| --- | --- |\n| 编辑 | 完成 |\n\n```ts\nconst value = 1 < 2;\n```\n\n[网页](https://example.com)\n\n> 引用文字', capabilityId: 'notes', capabilityName: 'Notes', collectionKey: 'documents', collectionName: 'Documents', documentDate: '2026-10-16', createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z', revision: 'original', format: 'markdown', sizeBytes: 400 };
      localStorage.setItem('personal-workbench-library-v2', JSON.stringify({ documents: [doc, { ...doc, id: 'notes/documents/2026/10/two', key: 'two', title: '子文件夹笔记', content: 'Second' }, { ...doc, id: 'notes/documents/2026/10/trash', key: 'trash', title: '已删除笔记' }], history: {}, organization: { folders: [{ id: 'project', name: '项目', documentIds: [doc.id] }, { id: 'child', name: '子目录', parentId: 'project', documentIds: [doc.id, 'notes/documents/2026/10/two', 'notes/documents/2026/10/trash'] }, { id: 'empty', name: '空目录', parentId: 'child', documentIds: [] }], topics: [], origins: {}, trash: { 'notes/documents/2026/10/trash': '2026-10-16' } } }));
    }
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'personal-workbench-library-v2' && window.failSave) throw new Error('Disk full'); return set.call(this, key, value); };
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const directory = page.getByRole('navigation', { name: '资料目录', exact: true });
  const toolbar = page.locator('.library-shell-heading');
  assert.equal(await toolbar.locator('.library-menu-anchor').count(), 0);
  await directory.getByRole('button', { name: '原位笔记', exact: true }).first().click();
  const editor = page.getByRole('textbox', { name: '文档正文', exact: true });
  await editor.getByRole('heading', { name: '原始正文', exact: true }).waitFor();
  assert.equal(await page.locator('.library-reader-content textarea').count(), 0, 'Formatted content is directly editable');
  assert.equal(await editor.getAttribute('contenteditable'), 'true');
  assert.equal(await page.getByText(/^更新于/).count(), 0);
  assert.equal(await editor.locator('table').count(), 1);
  assert.equal(await editor.locator('pre code').textContent(), 'const value = 1 < 2;');
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents.find(doc => doc.key === 'one').revision), 'original', 'Simply reading never rewrites Markdown');
  await editor.locator('p').filter({ hasText: /^保留原始内容。$/ }).click();
  await page.keyboard.press('End'); await page.keyboard.insertText('新增内容。'); await page.keyboard.press('Meta+Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents.find(doc => doc.key === 'one').content.includes('新增内容。'));
  assert.equal(await editor.evaluate(el => el === document.activeElement), true, 'Autosave keeps the caret in the editor');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents.find(doc => doc.key === 'one').content);
  assert.match(saved, /\| 项目\s+\| 状态\s+\|/);
  for (const fragment of ['```ts', 'const value = 1 < 2;', '[网页](https://example.com)', '- [x] 已完成', '子项', '> 引用文字']) assert.ok(saved.includes(fragment), fragment);
  await page.reload(); await directory.getByRole('button', { name: '原位笔记', exact: true }).first().click();
  await editor.getByText('保留原始内容。新增内容。', { exact: true }).waitFor();
  assert.equal(await editor.locator('table').count(), 1); assert.equal(await editor.locator('ul ul').count(), 1);
  // Keyboard formatting and quick insertion operate on rendered blocks.
  await editor.locator('blockquote p').click();
  await page.waitForFunction(() => document.querySelector('.tiptap')?.editor?.state.selection.$from.parent.textContent === '引用文字');
  await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.insertText('/');
  const quick = page.getByRole('menu', { name: '快捷插入', exact: true }); await quick.waitFor();
  await quick.getByRole('menuitem', { name: '标题 2', exact: true }).click(); await page.keyboard.insertText('快捷标题');
  await editor.getByRole('heading', { name: '快捷标题', level: 2, exact: true }).waitFor();
  await page.keyboard.press('Enter'); await page.keyboard.press('Meta+b'); await page.keyboard.insertText('加粗文字'); await page.keyboard.press('Meta+b');
  assert.equal(await editor.locator('strong').last().textContent(), '加粗文字');
  await page.keyboard.press('Enter'); await page.keyboard.insertText('/'); await quick.waitFor();
  const tools = quick;
  assert.ok((await tools.getByRole('menuitem').allTextContents()).some(text => text.includes('待办清单')));
  await page.keyboard.press('Escape'); await page.keyboard.press('Backspace');
  // Failed writes retain a rich-text draft across reload, without adding stale data to a conversation.
  await page.evaluate(() => { window.failSave = true; }); await editor.fill('待恢复草稿'); await page.keyboard.press('Meta+Enter');
  await page.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor();
  await directory.getByRole('button', { name: '文件夹操作 项目', exact: true }).click(); await page.getByRole('menuitem', { name: '添加到会话', exact: true }).click();
  assert.equal(await page.locator('.conversation-page').count(), 0);
  await page.reload(); await directory.getByRole('button', { name: '原位笔记', exact: true }).first().click(); await editor.getByText('待恢复草稿', { exact: true }).waitFor();
  await page.keyboard.press('Meta+Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents.find(doc => doc.key === 'one').content.includes('待恢复草稿'));
  await editor.fill('冲突草稿');
  await page.evaluate(async () => { const { createLibraryStore } = await import('/src/platform/library-store.ts'); const store = createLibraryStore(localStorage), doc = store.read('notes/documents/2026/10/one'); store.change({ kind: 'edit', id: doc.id, title: doc.title, content: '# 外部新版本', expected: doc.revision }); });
  await page.keyboard.press('Meta+Enter'); await page.getByRole('alert').filter({ hasText: 'Document changed' }).waitFor();
  assert.equal(await editor.textContent(), '冲突草稿');
  await page.getByRole('button', { name: '放弃草稿，读取最新文档', exact: true }).click();
  await editor.getByRole('heading', { name: '外部新版本', exact: true }).waitFor();
  // Title rename is inline; version history remains available.
  await directory.getByRole('button', { name: '文档操作 原位笔记', exact: true }).first().click();
  assert.equal((await page.getByRole('menu', { name: '文档操作 原位笔记', exact: true }).getByRole('menuitem').allTextContents())[0], '添加到会话');
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click(); await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('原位新标题'); await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('textbox', { name: '文档标题', exact: true }).inputValue(), '原位新标题');
  await toolbar.getByRole('button', { name: '文档更多操作', exact: true }).click(); await page.getByRole('menuitem', { name: '版本历史', exact: true }).click();
  const history = page.getByRole('complementary', { name: '版本历史', exact: true });
  assert.equal(await page.getByRole('dialog').count(), 0);
  await history.getByRole('button', { name: /^历史版本 1/ }).click();
  await history.getByRole('button', { name: '恢复此版本', exact: true }).click();
  await history.getByRole('button', { name: '关闭版本历史', exact: true }).click(); await history.waitFor({ state: 'hidden' });
  await editor.getByRole('heading', { name: '原始正文', exact: true }).waitFor();
  assert.equal(await editor.locator('table').count(), 1, 'Restoring history refreshes the existing rich editor without reopening the document');
  await toolbar.getByRole('button', { name: '文档更多操作', exact: true }).click(); await page.getByRole('menuitem', { name: '版本历史', exact: true }).click();
  await history.getByRole('navigation', { name: '选择版本', exact: true }).getByRole('button').nth(1).click();
  await history.getByRole('button', { name: '恢复此版本', exact: true }).click(); await history.getByRole('button', { name: '关闭版本历史', exact: true }).click(); await history.waitFor({ state: 'hidden' });
  await editor.getByRole('heading', { name: '外部新版本', exact: true }).waitFor();

  // Browser fallback downloads exactly the selected document, with its title, no ZIP or injected H1.
  await toolbar.getByRole('button', { name: '文档更多操作', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('menuitem', { name: '导出 Markdown', exact: true }).click();
  const download = await downloading; assert.equal(download.suggestedFilename(), '原位新标题.md');
  const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), '# 外部新版本');
  assert.equal(await page.locator('.library-feedback').textContent(), '');
  // A folder is one attachment, with its recursive hierarchy and empty descendants retained.
  await directory.getByRole('button', { name: '文件夹操作 项目', exact: true }).click(); await page.getByRole('menuitem', { name: '添加到会话', exact: true }).click();
  const folderChip = page.locator('.conversation-folder-attachments'); await folderChip.getByText('项目', { exact: false }).first().waitFor();
  assert.equal(await folderChip.locator(':scope > span').count(), 1);
  assert.equal(await folderChip.locator('details, summary, ul').count(), 0, 'Folder attachments remain compact without a disclosure tree');
  assert.equal(await folderChip.getByText('空目录', { exact: false }).count(), 0);
  assert.equal(await folderChip.getByText('子文件夹笔记', { exact: true }).count(), 0);
  assert.ok((await folderChip.textContent()).includes('2 篇资料'));
  assert.equal(await folderChip.getByText('已删除笔记', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '资料库', exact: true }).click(); await directory.getByRole('button', { name: '原位新标题', exact: true }).first().click();
  // Native export uses a single ID and treats Save dialog cancellation as a quiet no-op.
  await page.evaluate(() => { window.recorded = []; window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' } }, invoke: async (command, args) => { window.recorded.push({ command, args }); const state = JSON.parse(localStorage.getItem('personal-workbench-library-v2')); if (command === 'library_export_markdown') return false; if (command === 'library_list_documents') return state.documents.filter(doc => !state.organization.trash[doc.id]); if (command === 'library_organization') return state.organization; return null; } }; });
  await toolbar.getByRole('button', { name: '文档更多操作', exact: true }).click(); await page.getByRole('menuitem', { name: '导出 Markdown', exact: true }).click();
  await page.waitForFunction(() => window.recorded.some(call => call.command === 'library_export_markdown'));
  assert.deepEqual((await page.evaluate(() => window.recorded.find(call => call.command === 'library_export_markdown'))).args, { id: 'notes/documents/2026/10/one' });
  assert.equal(await page.locator('.library-feedback').textContent(), '');
  await toolbar.getByRole('heading', { name: '资料库', exact: true }).dispatchEvent('mousedown', { button: 0, detail: 1 });
  await toolbar.getByRole('button', { name: '搜索 Nooki (⌘ K)', exact: true }).dispatchEvent('mousedown', { button: 0, detail: 1 });
  assert.deepEqual(await page.evaluate(() => window.recorded.filter(call => call.command.startsWith('plugin:window|')).map(call => call.command)), ['plugin:window|start_dragging']);
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__; });
  await page.screenshot({ path: '/private/tmp/nooki-rich-editor-light.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: WYSIWYG Markdown roundtrip, tables/tasks/code/nesting, inline tools/slash, uninterrupted autosave, drafts/retry/conflicts/history, .md export/cancel, folder attachment hierarchy and window dragging');
} catch (error) { await page.screenshot({ path: '/private/tmp/nooki-rich-edit-failure.png' }); throw error; }
finally { await browser.close(); }
