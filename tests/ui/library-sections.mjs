// Folder migration and management against the real browser store in an isolated profile.
import assert from 'node:assert/strict';
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(15000);
try {
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    if (!localStorage.getItem('personal-workbench-preferences')) localStorage.setItem('personal-workbench-preferences', JSON.stringify({ state: { view: 'library', language: 'zh', theme: 'light' }, version: 4 }));
    if (!localStorage.getItem('personal-workbench-library-v2')) {
      const doc = { id: 'com.personal.notes/notes/2026/10/entry', key: 'entry', capabilityId: 'com.personal.notes', capabilityName: '笔记', collectionKey: 'notes', collectionName: 'Notes', title: '项目观察', content: '# 观察\n\n保留这份文档。keyword', documentDate: '2026-10-16', createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z', revision: 'original', format: 'markdown', sizeBytes: 64 };
      const section = { id: 'custom-reading', name: '阅读笔记', topicId: 'meta' };
      localStorage.setItem('personal-workbench-library-v2', JSON.stringify({ documents: [doc, { ...doc, id: 'com.personal.notes/notes/2026/10/deleted', key: 'deleted', title: '回收站资料' }], history: {}, organization: { topics: [{ id: 'meta', name: 'MetaDrive', documentIds: [doc.id] }, { id: 'test', name: '测试', documentIds: [doc.id] }], trash: { 'com.personal.notes/notes/2026/10/deleted': '2026-10-16' }, origins: {}, sections: { [doc.id]: section }, customSections: [section, { id: 'custom-other', name: '其他文件夹' }] } }));
    }
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'personal-workbench-library-v2' && window.failSave) throw new Error('Disk full'); return setItem.call(this, key, value); };
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const directory = page.getByRole('navigation', { name: '资料目录', exact: true });
  const actions = async (name, action) => { await directory.getByRole('button', { name: `文件夹操作 ${name}`, exact: true }).click(); await page.getByRole('menuitem', { name: action, exact: true }).click(); };
  await directory.getByRole('button', { name: '阅读笔记', exact: true }).waitFor();
  assert.equal(await directory.getByRole('button', { name: '项目观察', exact: true }).count(), 2, 'Legacy shared entries reference the same document');
  assert.equal(await directory.getByRole('button', { name: '回收站资料', exact: true }).count(), 0);
  await actions('阅读笔记', '重命名');
  const rename = directory;
  const field = directory.getByRole('textbox', { name: '文件夹名称', exact: true });
  assert.equal(await page.getByRole('dialog').count(), 0, 'Rename stays inside the folder row');
  assert.equal(await field.evaluate(el => el === document.activeElement), true);
  await field.fill(' '); await page.keyboard.press('Enter'); await directory.getByRole('alert').filter({ hasText: '请输入文件夹名称' }).waitFor();
  await field.fill('长期阅读'); await page.evaluate(() => { window.failSave = true; }); await page.keyboard.press('Enter');
  await rename.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor();
  assert.equal(await field.inputValue(), '长期阅读');
  await page.evaluate(() => { window.failSave = false; }); await page.keyboard.press('Enter');
  await field.waitFor({ state: 'hidden' });
  await page.reload(); await directory.getByRole('button', { name: '长期阅读', exact: true }).waitFor();
  await actions('长期阅读', '重命名'); await field.fill('不保存'); await page.keyboard.press('Escape');
  await directory.getByRole('button', { name: '长期阅读', exact: true }).waitFor();
  await actions('MetaDrive', '移动到…');
  const folderMove = page.getByRole('dialog', { name: '移动文件夹', exact: true });
  await folderMove.getByRole('button', { name: /^移动到 / }).click();
  const choices = await folderMove.getByRole('option').allTextContents();
  assert.ok(choices.every(name => !name.includes('MetaDrive') && !name.includes('长期阅读')), 'Cannot move a folder inside itself or descendants');
  await page.keyboard.press('Escape'); await folderMove.getByRole('button', { name: '取消', exact: true }).click();
  await actions('长期阅读', '移动到…');
  await folderMove.getByRole('button', { name: /^移动到 / }).click();
  await folderMove.getByRole('option', { name: '我的资料', exact: true }).click();
  await folderMove.getByRole('button', { name: '保存', exact: true }).click(); await folderMove.waitFor({ state: 'hidden' });
  await actions('长期阅读', '重命名'); await field.fill('其他文件夹'); await page.keyboard.press('Enter');
  await rename.getByRole('alert').filter({ hasText: 'Folder already exists' }).waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(async () => {
    const { createLibraryStore } = await import('/src/platform/library-store.ts'); const store = createLibraryStore(localStorage);
    store.change({ kind: 'move-documents', ids: [store.list()[0].id], folderId: 'topic-test' });
    window.dispatchEvent(new Event('workbench:library-changed'));
  });
  await actions('长期阅读', '删除文件夹');
  const deletion = page.getByRole('dialog', { name: '删除文件夹', exact: true });
  await deletion.getByText(/所有子文件夹、文档及版本历史都会永久删除/).waitFor();
  await deletion.getByRole('button', { name: '取消', exact: true }).click();
  await actions('长期阅读', '删除文件夹');
  await deletion.getByRole('button', { name: '删除文件夹', exact: true }).click(); await deletion.waitFor({ state: 'hidden' });
  assert.equal(await directory.getByRole('button', { name: '项目观察', exact: true }).count(), 1);
  await directory.getByRole('button', { name: '测试', exact: true }).click();
  await page.locator('.library-folder-list').getByRole('button', { name: '文档操作 项目观察', exact: true }).click();
  await page.getByRole('menuitem', { name: '移动到…', exact: true }).click();
  const move = page.getByRole('dialog', { name: '移动资料', exact: true });
  await move.getByRole('button', { name: /^文件夹 / }).click(); await move.getByRole('option', { name: '我的资料', exact: true }).click();
  await move.getByRole('button', { name: '移动', exact: true }).click(); await move.waitFor({ state: 'hidden' });
  await directory.getByRole('button', { name: '我的资料', exact: true }).click();
  if (await directory.getByRole('button', { name: '我的资料', exact: true }).getAttribute('aria-expanded') === 'false') await directory.getByRole('button', { name: '我的资料', exact: true }).click();
  await page.locator('.library-folder-list').getByRole('button', { name: '文档操作 项目观察', exact: true }).waitFor();
  await page.getByRole('searchbox').fill('keyword');
  await page.getByRole('heading', { name: '搜索结果', exact: true }).waitFor();
  await page.locator('.library-folder-item-label').filter({ hasText: '项目观察' }).waitFor();
  await page.getByRole('searchbox').fill('');
  // Contextual import goes to the clicked folder and does not create a source folder.
  const chooser = page.waitForEvent('filechooser');
  await directory.getByRole('button', { name: '添加到 其他文件夹', exact: true }).click(); await page.getByRole('menuitem', { name: '导入资料', exact: true }).click();
  await (await chooser).setFiles({ name: '导入测试.md', mimeType: 'text/markdown', buffer: Buffer.from('# Imported\n\nContent') });
  await page.getByRole('textbox', { name: '文档标题', exact: true }).waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents.some(doc => doc.title === '导入测试'));
  assert.equal(await page.getByRole('dialog', { name: '导入资料', exact: true }).count(), 0);
  assert.equal(await page.getByText('资料已导入当前文件夹。', { exact: true }).count(), 0);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')));
  const imported = state.documents.find(doc => doc.title === '导入测试');
  assert.ok(state.organization.folders.find(folder => folder.name === '其他文件夹').documentIds.includes(imported.id));
  assert.equal(state.documents.find(doc => doc.key === 'entry').revision, 'original');
  // Deleting a nonempty tree removes all descendant folders and documents atomically.
  await page.evaluate(async () => {
    const { createLibraryStore } = await import('/src/platform/library-store.ts'); const store = createLibraryStore(localStorage);
    for (const folder of [{ id: 'delete-tree', name: '待删除项目', parentId: 'topic-meta' }, { id: 'delete-child', name: '待删除子目录', parentId: 'delete-tree' }, { id: 'delete-empty', name: '待删除空目录', parentId: 'delete-child' }]) store.change({ kind: 'save-folder', folder: { ...folder, documentIds: [] } });
    for (const [key, title, folderId] of [['direct', '待删除直接文档', 'delete-tree'], ['deep', '待删除深层文档', 'delete-child']]) store.change({ kind: 'create', folderId, document: { key, title, content: 'Delete with folder', documentDate: '2026-10-16', collectionKey: 'documents', collectionName: 'Documents' } });
    window.dispatchEvent(new Event('workbench:library-changed'));
  });
  await directory.getByRole('button', { name: '待删除深层文档', exact: true }).click();
  const beforeDeletion = await page.evaluate(() => localStorage.getItem('personal-workbench-library-v2'));
  await actions('待删除项目', '删除文件夹'); await deletion.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('personal-workbench-library-v2')), beforeDeletion);
  await actions('待删除项目', '删除文件夹'); await page.evaluate(() => { window.failSave = true; });
  await deletion.getByRole('button', { name: '删除文件夹', exact: true }).click(); await deletion.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('personal-workbench-library-v2')), beforeDeletion);
  await page.evaluate(() => { window.failSave = false; }); await deletion.getByRole('button', { name: '删除文件夹', exact: true }).click(); await deletion.waitFor({ state: 'hidden' });
  assert.equal(await directory.getByRole('button', { name: /^待删除/ }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '文档正文', exact: true }).count(), 0, 'Deleting an open descendant returns to the parent folder');
  await page.reload(); assert.equal(await directory.getByRole('button', { name: /^待删除/ }).count(), 0);
  assert.equal(await directory.getByRole('button', { name: '回收站', exact: true }).count(), 0);
  const deletedState = await page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')));
  assert.ok(deletedState.documents.every(doc => !doc.title.startsWith('待删除') && doc.title !== '回收站资料'));
  assert.deepEqual(deletedState.organization.trash, {});
  assert.ok(deletedState.organization.folders.every(folder => !folder.id.startsWith('delete-')));
  await directory.getByRole('button', { name: '我的资料', exact: true }).click();
  if (await directory.getByRole('button', { name: '我的资料', exact: true }).getAttribute('aria-expanded') === 'false') await directory.getByRole('button', { name: '我的资料', exact: true }).click();
  // Document deletion is irreversible, removes versions and drafts, and has no Trash step.
  await directory.getByRole('button', { name: '项目观察', exact: true }).click();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await body.fill('待删除的编辑内容'); await page.keyboard.press('Meta+Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents.find(doc => doc.key === 'entry').content.includes('待删除的编辑内容'));
  const beforeDocumentDeletion = await page.evaluate(() => localStorage.getItem('personal-workbench-library-v2'));
  await directory.getByRole('button', { name: '文档操作 项目观察', exact: true }).click(); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  const documentDeletion = page.getByRole('dialog', { name: '删除资料', exact: true });
  await documentDeletion.getByText(/删除后不可恢复/).waitFor(); await documentDeletion.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('personal-workbench-library-v2')), beforeDocumentDeletion);
  await directory.getByRole('button', { name: '文档操作 项目观察', exact: true }).click(); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.evaluate(() => { window.failSave = true; }); await documentDeletion.getByRole('button', { name: '永久删除', exact: true }).click();
  await documentDeletion.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('personal-workbench-library-v2')), beforeDocumentDeletion);
  await page.evaluate(() => { window.failSave = false; }); await documentDeletion.getByRole('button', { name: '永久删除', exact: true }).click(); await documentDeletion.waitFor({ state: 'hidden' });
  await page.waitForTimeout(1000);
  assert.equal(await directory.getByRole('button', { name: '项目观察', exact: true }).count(), 0);
  const removedId = 'com.personal.notes/notes/2026/10/entry';
  assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).history[id], removedId), undefined);
  assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem('personal-workbench-library-drafts-v1') || '{}')[id], removedId), undefined);
  await page.reload(); assert.equal(await directory.getByRole('button', { name: '项目观察', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '回收站', exact: true }).count(), 0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1240, 800, 640]) { await page.setViewportSize({ width, height: 820 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: `/private/tmp/nooki-folders-${theme}-${width}.png` }); }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: legacy/shared migration, nested rename/move/delete, duplicate/cycle prevention, save failure, keyboard document move, content search, contextual import, permanent subtree deletion, legacy Trash cleanup, revision preservation, reload and responsive themes');
} catch (error) { await page.screenshot({ path: '/private/tmp/nooki-folders-management-failure.png' }).catch(() => {}); throw error; }
finally { await browser.close(); }
