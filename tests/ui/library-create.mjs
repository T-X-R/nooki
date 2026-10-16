import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(15000);
try {
  await page.addInitScript(() => {
    if (!localStorage.getItem('personal-workbench-preferences')) localStorage.setItem('personal-workbench-preferences', JSON.stringify({ state: { view: 'library', language: 'zh', theme: 'light' }, version: 4 }));
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'personal-workbench-library-v2' && window.failSave) throw new Error('Disk full'); return set.call(this, key, value); };
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const directory = page.getByRole('navigation', { name: '资料目录', exact: true });
  const add = async (action, folder = '我的资料') => { await directory.getByRole('button', { name: `添加到 ${folder}`, exact: true }).click(); await page.getByRole('menuitem', { name: action, exact: true }).click(); };
  await add('新建文档');
  await page.getByRole('textbox', { name: '文档标题', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: '文档标题', exact: true }).inputValue(), '未命名文档');
  assert.equal(await page.getByRole('dialog').count(), 0);
  const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')));
  let state = await readState();
  const rootId = state.documents[0].id;
  assert.equal(state.documents[0].content, ''); assert.equal(state.documents[0].sizeBytes, 0); assert.equal(state.organization.folders.length, 0);
  const editor = page.getByRole('textbox', { name: '文档正文', exact: true });
  await editor.fill('直接开始写作。'); await page.keyboard.press('Meta+Enter');
  await page.waitForFunction(id => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents.find(doc => doc.id === id).content === '直接开始写作。', rootId);
  await add('新建文件夹');
  const folderName = directory.getByRole('textbox', { name: '文件夹名称', exact: true });
  await folderName.waitFor(); assert.equal(await folderName.inputValue(), '未命名文件夹'); assert.equal(await page.getByRole('dialog').count(), 0);
  await page.keyboard.press('Enter');
  await add('新建文档', '未命名文件夹');
  await editor.waitFor(); state = await readState();
  const child = state.documents.find(doc => doc.id !== rootId);
  assert.equal(child.title, '未命名文档'); assert.equal(child.content, '');
  assert.deepEqual(state.organization.folders[0].documentIds, [child.id]);
  await add('新建文件夹'); await folderName.waitFor(); assert.equal(await folderName.inputValue(), '未命名文件夹 (2)'); await page.keyboard.press('Enter'); await folderName.waitFor({ state: 'hidden' });
  // Document drag to root and folder drag into a sibling preserve IDs and revisions.
  const drag = async (source, target) => { const data = await page.evaluateHandle(() => new DataTransfer()); await source.dispatchEvent('dragstart', { dataTransfer: data }); await target.dispatchEvent('dragover', { dataTransfer: data }); await target.dispatchEvent('drop', { dataTransfer: data }); await source.dispatchEvent('dragend', { dataTransfer: data }).catch(() => {}); await data.dispose(); };
  await drag(directory.getByRole('button', { name: '未命名文件夹', exact: true }).locator('..').locator('..').getByRole('button', { name: '未命名文档', exact: true }), directory.locator('.library-directory-root'));
  await page.waitForFunction(id => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).organization.folders.every(folder => !folder.documentIds.includes(id)), child.id);
  await drag(directory.getByRole('button', { name: '未命名文件夹', exact: true }), directory.getByRole('button', { name: '未命名文件夹 (2)', exact: true }).locator('..'));
  await page.waitForFunction(() => { const f = JSON.parse(localStorage.getItem('personal-workbench-library-v2')).organization.folders; return f.find(x => x.name === '未命名文件夹').parentId === f.find(x => x.name === '未命名文件夹 (2)').id; });
  const before = JSON.stringify((await readState()).organization.folders);
  await drag(directory.getByRole('button', { name: '未命名文件夹 (2)', exact: true }), directory.getByRole('button', { name: '未命名文件夹', exact: true }).locator('..'));
  assert.equal(JSON.stringify((await readState()).organization.folders), before, 'A parent cannot be dropped into its descendant');
  await page.reload(); await directory.getByRole('button', { name: '未命名文档', exact: true }).first().waitFor();
  assert.equal((await readState()).documents.find(doc => doc.id === child.id).revision, child.revision);
  // Failed immediate creation reports an error without publishing a partial document or opening a modal.
  await page.evaluate(() => { window.failSave = true; }); await add('新建文档');
  await page.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor(); assert.equal((await readState()).documents.length, 2); assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.locator('.library-batch-actions').count(), 0); assert.equal(await page.locator('.library-folder-list input[type=checkbox]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: immediate empty document/folder creation, contextual placement, unique names, document/folder drag, cycle rejection, durable identity and write failure');
} catch (error) { await page.screenshot({ path: '/private/tmp/nooki-rich-create-failure.png' }); throw error; }
finally { await browser.close(); }
