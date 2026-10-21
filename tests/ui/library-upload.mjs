import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
try {
  await page.addInitScript(() => {
    localStorage.setItem('personal-workbench-preferences', JSON.stringify({ state: { view: 'library', language: 'zh', theme: 'light' }, version: 4 }));
    if (!localStorage.getItem('personal-workbench-library-v2')) localStorage.setItem('personal-workbench-library-v2', JSON.stringify({ documents: [], history: {}, organization: { folders: [{ id: 'project', name: '项目', documentIds: [] }], topics: [], origins: {}, trash: {} } }));
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'personal-workbench-library-v2' && window.failSave) throw new Error('Disk full'); return set.call(this, key, value); };
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const directory = page.getByRole('navigation', { name: '资料目录', exact: true });
  const project = directory.getByRole('button', { name: '项目', exact: true }).locator('..');
  await project.waitFor();
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('personal-workbench-library-v2')));
  const waitForTitle = title => page.waitForFunction(title => JSON.parse(localStorage.getItem('personal-workbench-library-v2')).documents.some(doc => doc.title === title), title);
  const dropFiles = async (target, files) => {
    const transfer = await page.evaluateHandle(files => { const data = new DataTransfer(); for (const file of files) data.items.add(new File([file.content], file.name)); return data; }, files);
    await target.dispatchEvent('dragover', { dataTransfer: transfer });
    await target.dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
  };
  // External files can target a tree folder without selecting that folder first.
  await dropFiles(project, [{ name: '拖入文档.md', content: '# 正文标题\n\n从本地上传。' }, { name: '第二份.TXT', content: '第二份正文。' }]);
  await waitForTitle('第二份');
  let snapshot = await state();
  assert.equal(snapshot.documents.length, 2);
  assert.deepEqual(new Set(snapshot.organization.folders[0].documentIds), new Set(snapshot.documents.map(doc => doc.id)));
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByText('资料已导入当前文件夹。', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: '文档标题', exact: true }).inputValue(), '第二份');
  // Dropping on the open editor imports into its folder instead of inserting file contents.
  await dropFiles(page.getByRole('textbox', { name: '文档正文', exact: true }), [{ name: '当前文件夹.md', content: '导入到当前文件夹。' }]);
  await waitForTitle('当前文件夹');
  snapshot = await state(); assert.equal(snapshot.organization.folders[0].documentIds.length, 3);
  assert.equal(snapshot.documents.find(doc => doc.title === '第二份').content, '第二份正文。');
  // Root and folder rows in the right-hand list accept external files too.
  await dropFiles(directory.locator('.library-directory-root'), [{ name: '根目录.md', content: '留在根目录。' }]);
  await waitForTitle('根目录');
  snapshot = await state(); assert.equal(snapshot.organization.folders[0].documentIds.length, 3);
  await directory.getByRole('button', { name: '我的资料', exact: true }).click();
  await dropFiles(page.locator('.library-folder-item').filter({ hasText: '项目' }), [{ name: '列表文件夹.md', content: '指定文件夹。' }]);
  await waitForTitle('列表文件夹');
  assert.equal((await state()).organization.folders[0].documentIds.length, 4);
  // File chooser uses the same immediate import, including contextual placement.
  const chooser = page.waitForEvent('filechooser');
  await directory.getByRole('button', { name: '添加到 我的资料', exact: true }).click();
  await page.getByRole('menuitem', { name: '导入资料', exact: true }).click();
  await (await chooser).setFiles({ name: '直接上传.md', mimeType: 'text/markdown', buffer: Buffer.from('# 正文\n\n内容。') });
  await waitForTitle('直接上传');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByText('资料已导入当前文件夹。', { exact: true }).count(), 0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const divider = await page.locator('.library-inline-document .library-reader-header').evaluate(el => { const style = getComputedStyle(el); return { width: style.borderBottomWidth, style: style.borderBottomStyle, color: style.borderBottomColor }; });
    assert.equal(divider.width, '1px'); assert.equal(divider.style, 'solid'); assert.notEqual(divider.color, 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `/private/tmp/nooki-library-upload-${theme}.png` });
  }
  // A second drop during an in-flight import is rejected visibly instead of silently lost.
  await page.evaluate(() => {
    const text = File.prototype.text;
    File.prototype.text = function() { return this.name === '导入中.md' ? new Promise(resolve => { window.finishUpload = () => resolve('慢速读取内容。'); }) : text.call(this); };
  });
  await dropFiles(page.locator('.library-folder-content'), [{ name: '导入中.md', content: 'pending' }]);
  await page.getByRole('status').filter({ hasText: '导入中' }).waitFor();
  await dropFiles(page.locator('.library-folder-content'), [{ name: '稍后重试.md', content: 'retry' }]);
  await page.getByRole('alert').filter({ hasText: '请完成后重试' }).waitFor();
  await page.evaluate(() => window.finishUpload());
  await waitForTitle('导入中');
  assert.equal((await state()).documents.some(doc => doc.title === '稍后重试'), false);
  // Reject a mixed invalid batch before publishing anything; failures remain visible.
  const count = (await state()).documents.length;
  const root = directory.getByRole('button', { name: '我的资料', exact: true });
  if (await root.getAttribute('aria-expanded') === 'false') await root.click();
  await dropFiles(project, [{ name: '不应导入.md', content: 'valid' }, { name: 'unsupported.pdf', content: 'invalid' }]);
  await page.getByRole('alert').filter({ hasText: 'Markdown/TXT' }).waitFor();
  assert.equal((await state()).documents.length, count);
  await dropFiles(project, [{ name: 'empty.md', content: '' }]);
  await page.getByRole('alert').filter({ hasText: '不能为空' }).waitFor();
  await dropFiles(project, [{ name: 'large.md', content: 'a'.repeat(2_000_001) }]);
  await page.getByRole('alert').filter({ hasText: 'Markdown/TXT' }).waitFor();
  await page.evaluate(() => { window.failSave = true; });
  await dropFiles(project, [{ name: '写入失败.md', content: 'No write' }]);
  await page.getByRole('alert').filter({ hasText: 'Disk full' }).waitFor();
  assert.equal((await state()).documents.length, count);
  await page.evaluate(() => { window.failSave = false; });
  await page.reload(); await directory.getByRole('button', { name: '列表文件夹', exact: true }).waitFor();
  assert.equal((await state()).documents.length, count);
  assert.deepEqual(errors, []);
  console.log('PASS: immediate picker/batch import, external file drops to tree/root/list/editor, folder placement, persistence, divider in both themes, validation and write failure');
} catch (error) { await page.screenshot({ path: '/private/tmp/nooki-library-upload-failure.png' }).catch(() => {}); throw error; }
finally { await browser.close(); }
