// Start Vite on port 5193. Set PLAYWRIGHT_MODULE for an external Playwright installation.
// Native IPC is mocked; this suite never mutates real conversations or Library data.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(() => {
    localStorage.setItem('personal-workbench-preferences', JSON.stringify({ state: { view: 'library', language: localStorage.getItem('qa-language') || 'zh', theme: 'light', providerKind: 'codex-api' }, version: 0 }));
    const data = JSON.parse(localStorage.getItem('qa-organization') || 'null') || {
      docs: [{ id: 'diary/notes/2026/09/entry', capabilityId: 'diary', capabilityName: '日记', collectionKey: 'notes', collectionName: '笔记', title: '周末的阅读计划', content: '# 阅读计划\n\n整理想读的书，以及接下来想了解的问题。', documentDate: '2026-09-09', createdAt: '2026-09-09T10:00:00Z', updatedAt: '2026-09-09T10:00:00Z', revision: 'first', format: 'markdown', sizeBytes: 120 }],
      organization: { topics: [{ id: 'research', name: '阅读与思考', documentIds: ['diary/notes/2026/09/entry'] }, { id: 'empty', name: '旅行灵感', documentIds: [] }], customSections: [], sections: {}, origins: {}, trash: {} },
      sessions: [{ id: 'current', name: '整理本周的想法', preview: '整理本周的想法', updatedAt: 1788948000, turns: [] }, ...Array.from({ length: 43 }, (_, i) => ({ id: `archived-${i}`, name: `往期对话 ${i + 1}`, preview: '', updatedAt: 1788948000 - i * 86400, archived: true, turns: [] }))],
    };
    const persist = () => localStorage.setItem('qa-organization', JSON.stringify(data));
    window.qa = { data, failDelete: '', loseDeleteResponse: '', failArchive: false, failList: false, deleted: [], pages: [] };
    let callbackId = 0;
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => ++callbackId, unregisterCallback: () => {}, invoke: async (command, args = {}) => {
      if (command.startsWith('plugin:')) return null;
      if (command === 'get_selected_provider') return 'codex-api';
      if (command === 'provider_status') return { kind: 'codex-api', state: 'ready', label: 'Codex', detail: 'Fixture' };
      if (['list_capabilities', 'library_search_content'].includes(command)) return [];
      if (command === 'tasks_read') return [{ id: 'task-current', capabilityId: 'workbench.conversations', capabilityVersion: '1', job: 'respond', input: { threadId: 'current', message: '整理本周的想法' }, status: 'completed', result: { threadId: 'current', turnId: 'turn' }, stage: null, attempt: 1, checkpoints: {}, error: null, createdAt: '2026-09-09T10:00:00Z', updatedAt: '2026-09-09T10:00:00Z' }];
      if (command === 'tasks_write') return;
      if (command === 'library_organization') return structuredClone(data.organization);
      if (command === 'library_list_documents') return structuredClone(data.docs);
      if (command === 'library_read_document') return structuredClone(data.docs.find(doc => doc.id === args.id));
      if (command === 'library_change') {
        const change = args.change, org = data.organization;
        if (change.kind === 'create-section') {
          if (org.customSections.some(section => section.name.toLowerCase() === change.section.name.trim().toLowerCase())) throw new Error('Section already exists');
          org.customSections.push({ ...change.section, name: change.section.name.trim() });
        } else if (change.kind === 'save-topic') org.topics = org.topics.some(topic => topic.id === change.topic.id) ? org.topics.map(topic => topic.id === change.topic.id ? change.topic : topic) : [...org.topics, change.topic];
        else if (change.kind === 'delete-topic') org.topics = org.topics.filter(topic => topic.id !== change.id);
        else if (change.kind === 'place') org.sections[change.id] = change.section;
        else throw new Error(`Unexpected change ${change.kind}`);
        persist(); return null;
      }
      if (command === 'conversation_list') {
        if (window.qa.failList) throw new Error('Archive unavailable');
        const rows = data.sessions.filter(session => !!session.archived === !!args.archived), offset = Number(args.cursor || 0);
        if (args.archived) window.qa.pages.push(offset);
        return { data: structuredClone(rows.slice(offset, offset + 40)), nextCursor: rows.length > offset + 40 ? String(offset + 40) : null };
      }
      if (command === 'conversation_read') return structuredClone(data.sessions.find(session => session.id === args.id));
      if (command === 'conversation_change') {
        const session = data.sessions.find(session => session.id === args.id);
        if (!session) throw new Error('Missing conversation');
        if (args.action === 'archive' && window.qa.failArchive) throw new Error('Archive failed');
        if (args.action === 'delete') {
          if (window.qa.failDelete === args.id) throw new Error('Delete failed');
          assertArchived(session);
          window.qa.deleted.push(args.id);
          data.sessions = data.sessions.filter(row => row.id !== args.id);
        } else session.archived = args.action === 'archive';
        persist();
        if (args.action === 'delete' && window.qa.loseDeleteResponse === args.id) throw new Error('Delete response lost');
        return;
      }
      throw new Error(`Unexpected IPC ${command}`);
    } };
    function assertArchived(session) { if (!session.archived) throw new Error('Cannot delete active conversation'); }
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const topics = page.locator('#sidebar-library-topics');
  await topics.getByRole('button', { name: '阅读与思考', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '管理专题', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '切换专题', exact: true }).count(), 0);
  await topics.getByRole('button', { name: '旅行灵感', exact: true }).click();
  await page.getByText('这里还没有资料', { exact: true }).waitFor();
  assert.equal(await page.locator('.library-reader-content').count(), 0);
  await topics.getByRole('button', { name: '新建专题', exact: true }).click();
  await topics.getByRole('textbox', { name: '专题名称' }).fill('项目笔记');
  await page.keyboard.press('Enter');
  await topics.getByRole('button', { name: '项目笔记', exact: true }).waitFor();
  await topics.getByRole('button', { name: '重命名专题：项目笔记', exact: true }).click();
  await topics.getByRole('textbox', { name: '专题名称' }).fill('长期观察');
  await page.keyboard.press('Enter');
  await topics.getByRole('button', { name: '长期观察', exact: true }).click();
  await topics.getByRole('button', { name: '删除专题：长期观察', exact: true }).click();
  await topics.getByRole('button', { name: '删除专题', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#sidebar-library-topics > button')?.getAttribute('aria-current') === 'page');
  await page.getByRole('button', { name: '新建栏目', exact: true }).click();
  await page.getByRole('textbox', { name: '栏目名称', exact: true }).fill('我的收藏');
  await page.getByRole('button', { name: '创建栏目', exact: true }).click();
  await page.locator('.library-capability-heading').filter({ hasText: '我的收藏' }).waitFor();
  await page.reload();
  await page.locator('.library-capability-heading').filter({ hasText: '我的收藏' }).waitFor();
  await page.getByRole('button', { name: '新建栏目', exact: true }).click();
  await page.getByRole('textbox', { name: '栏目名称', exact: true }).fill('我的收藏');
  await page.keyboard.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Section already exists' }).waitFor();
  await page.getByRole('textbox', { name: '栏目名称', exact: true }).press('Escape');
  await page.getByRole('checkbox', { name: '选择 周末的阅读计划', exact: true }).check();
  await page.getByRole('button', { name: '移至栏目', exact: true }).click();
  const move = page.getByRole('dialog', { name: '移至栏目', exact: true });
  await move.getByRole('button', { name: /^栏目 / }).click();
  await move.getByRole('option', { name: '我的收藏', exact: true }).click();
  await move.getByRole('button', { name: '移动资料', exact: true }).click();
  await move.waitFor({ state: 'hidden' });
  await page.locator('.library-capability-node').filter({ hasText: '我的收藏' }).locator('.library-document-link').filter({ hasText: '周末的阅读计划' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.qa.data.organization.topics[0].documentIds), ['diary/notes/2026/09/entry']);
  await page.screenshot({ path: '/private/tmp/nooki-library-topics.png', animations: 'disabled' });
  await topics.getByRole('button', { name: '阅读与思考', exact: true }).click();
  await topics.getByRole('button', { name: '删除专题：阅读与思考', exact: true }).click();
  await topics.getByRole('button', { name: '删除专题', exact: true }).click();
  await page.waitForFunction(() => window.qa.data.organization.topics.length === 1);
  assert.equal(await page.evaluate(() => window.qa.data.docs.length), 1);
  await page.screenshot({ path: '/private/tmp/nooki-library-light.png' });
  for (const width of [800, 640]) {
    await page.setViewportSize({ width, height: 820 });
    await page.screenshot({ path: `/private/tmp/nooki-library-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal page overflow at ${width}`);
    assert.ok(await topics.getByRole('button', { name: '旅行灵感', exact: true }).isVisible());
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/private/tmp/nooki-library-dark.png' });
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page.getByRole('button', { name: '整理本周的想法', exact: true }).click();
  await page.evaluate(() => window.qa.failArchive = true);
  await page.getByRole('button', { name: '归档会话：整理本周的想法', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Archive failed' }).waitFor();
  assert.ok(await page.getByRole('button', { name: '整理本周的想法', exact: true }).isVisible());
  await page.evaluate(() => window.qa.failArchive = false);
  await page.getByRole('button', { name: '归档会话：整理本周的想法', exact: true }).click();
  await page.getByRole('button', { name: '整理本周的想法', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  const archive = page.getByRole('dialog');
  await archive.getByRole('button', { name: '恢复会话：整理本周的想法', exact: true }).waitFor();
  assert.equal(await archive.locator('.conversation-archive-row').count(), 44);
  await page.screenshot({ path: '/private/tmp/nooki-archives.png', animations: 'disabled' });
  assert.ok((await page.evaluate(() => window.qa.pages)).includes(40));
  await archive.getByRole('button', { name: '恢复会话：整理本周的想法', exact: true }).click();
  await archive.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '整理本周的想法', exact: true }).waitFor();
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  await archive.getByRole('button', { name: '删除会话：往期对话 1', exact: true }).click();
  await archive.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.evaluate(() => window.qa.deleted.length), 0);
  await archive.getByRole('button', { name: '删除会话：往期对话 1', exact: true }).click();
  await archive.getByRole('button', { name: '永久删除', exact: true }).click();
  await archive.getByRole('button', { name: '清空归档', exact: true }).waitFor();
  assert.equal(await archive.locator('.conversation-archive-row').count(), 42);
  await page.evaluate(() => window.qa.loseDeleteResponse = 'archived-1');
  await archive.getByRole('button', { name: '删除会话：往期对话 2', exact: true }).click();
  await archive.getByRole('button', { name: '永久删除', exact: true }).click();
  await archive.getByRole('alert').filter({ hasText: 'Delete response lost' }).waitFor();
  await archive.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.conversation-archive-row').length === 41);
  await page.evaluate(() => window.qa.failDelete = 'archived-3');
  await archive.getByRole('button', { name: '清空归档', exact: true }).click();
  await archive.getByRole('button', { name: '永久删除', exact: true }).click();
  await archive.getByRole('alert').filter({ hasText: 'Delete failed' }).waitFor();
  assert.equal(await page.evaluate(() => window.qa.deleted.length), 3);
  await page.evaluate(() => window.qa.failDelete = '');
  await archive.getByRole('button', { name: '永久删除', exact: true }).click();
  await archive.getByText('还没有归档会话', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.qa.deleted.length), 43);
  assert.equal(await page.evaluate(() => window.qa.data.sessions[0].id), 'current');
  await page.screenshot({ path: '/private/tmp/nooki-archive-empty.png' });
  await archive.getByRole('button', { name: '完成', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('qa-language', 'en'));
  await page.reload();
  await page.getByRole('button', { name: 'New section', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New topic', exact: true }).click();
  await page.getByRole('textbox', { name: 'Topic name', exact: true }).fill('English topic');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'English topic', exact: true }).waitFor();
  await page.setViewportSize({ width: 800, height: 820 });
  await page.screenshot({ path: '/private/tmp/nooki-library-english.png', animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('PASS: inline topics, empty scope, section persistence, duplicate validation, moving documents, theme/viewport QA, archive failure, restore, pagination, cancel, single deletion and partial bulk retry');
} finally { await browser.close(); }
