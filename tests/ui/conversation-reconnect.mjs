// Synthetic desktop restart/reconnection checks; no model calls.
import assert from 'node:assert/strict';
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwright.chromium ? playwright : playwright.default;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript(() => {
    localStorage.setItem('personal-workbench-preferences', JSON.stringify({ state: { view: 'conversations', language: 'zh', theme: 'light' }, version: 0 }));
    const requestId = 'original-task';
    let thread = JSON.parse(localStorage.getItem('qa-reconnect-thread') || 'null') ?? { id: 'original-session', preview: '后台任务', createdAt: 1, updatedAt: 1, turns: [{ id: 'original-turn', status: 'inProgress', items: [{ id: 'user', type: 'userMessage', clientId: requestId, content: [{ type: 'text', text: '创建周报能力包' }] }, { id: 'reason', type: 'reasoning', summary: ['CLI 仍在整理工作记录'] }] }] };
    let tasks = JSON.parse(localStorage.getItem('qa-reconnect-tasks') || 'null') ?? [{ id: requestId, capabilityId: 'workbench.conversations', capabilityVersion: '1', ownerKind: 'platform', scope: thread.id, job: 'respond', input: { threadId: thread.id, message: '创建周报能力包', documentIds: [], snapshotId: 'sources' }, status: 'running', stage: 'codex-turn', attempt: 1, checkpoints: { sources: [] }, result: null, error: null, createdAt: '2026-09-22T10:00:00Z', updatedAt: '2026-09-22T10:00:00Z' }];
    let nextId = 1, complete;
    const callbacks = new Map(), events = new Map();
    const emit = (method, params) => { for (const [event, handler] of events) if (event === 'workbench:conversation-event') callbacks.get(handler)({ event, id: handler, payload: { method, params } }); };
    window.qa = { reconnects: [], sends: 0, cancellations: [], finish() {
      thread.turns[0].status = 'completed';
      thread.turns[0].items.push({ id: 'answer', type: 'agentMessage', phase: 'final_answer', text: '后台已完成周报能力包。' });
      localStorage.setItem('qa-reconnect-thread', JSON.stringify(thread));
      emit('turn/completed', { threadId: thread.id, turn: structuredClone(thread.turns[0]) });
      complete?.({ threadId: thread.id, turnId: thread.turns[0].id, artifacts: [] });
    } };
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback(fn) { const id = nextId++; callbacks.set(id, fn); return id; }, unregisterCallback(id) { callbacks.delete(id); }, async invoke(command, args = {}) {
      if (command === 'plugin:event|listen') { events.set(args.event, args.handler); return args.handler; }
      if (command.startsWith('plugin:')) return null;
      if (command === 'capability_agent') return 'codex';
      if (['agent_tools', 'list_capabilities', 'skill_pool_list', 'library_list_documents', 'library_search_content'].includes(command)) return [];
      if (command === 'library_organization') return { topics: [], origins: {}, trash: {}, sections: {}, customSections: [] };
      if (command === 'tasks_read') return tasks;
      if (command === 'tasks_write') { tasks = args.records; localStorage.setItem('qa-reconnect-tasks', JSON.stringify(tasks)); return; }
      if (command === 'conversation_list') return { data: [structuredClone(thread)], nextCursor: null };
      if (command === 'conversation_read') return structuredClone(thread);
      if (command === 'conversation_run') { window.qa.sends++; throw new Error('Must not resend the original prompt'); }
      if (command === 'conversation_reconnect') {
        window.qa.reconnects.push(args);
        if (thread.turns[0].status === 'completed') return { threadId: thread.id, turnId: 'original-turn', artifacts: [] };
        return new Promise(resolve => { complete = resolve; });
      }
      if (command === 'task_cancel_invocation') { window.qa.cancellations.push(args.id); return; }
      throw new Error('Unexpected command ' + command);
    } };
  });
  const openThread = () => page.getByRole('button', { name: '后台任务', exact: true }).click();
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  await openThread();
  await page.getByText('CLI 仍在整理工作记录', { exact: true }).waitFor();
  assert.equal(await page.locator('.conversation-user').count(), 1);
  assert.equal(await page.getByRole('button', { name: '重新连接', exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.qa.reconnects), [{ threadId: 'original-session', requestId: 'original-task', executionId: 'original-task:1' }]);
  await page.reload(); await openThread();
  await page.getByText('CLI 仍在整理工作记录', { exact: true }).waitFor();
  assert.equal(await page.locator('.conversation-user').count(), 1);
  assert.equal(await page.evaluate(() => window.qa.sends), 0);
  await page.evaluate(() => window.qa.finish());
  await page.getByText('后台已完成周报能力包。', { exact: true }).waitFor();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('qa-reconnect-tasks'))[0].status === 'completed');
  await page.reload(); await openThread();
  await page.getByText('后台已完成周报能力包。', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.qa.reconnects), []);
  // A stale disconnected task reconnects to the already-completed native turn.
  await page.evaluate(() => { const tasks = JSON.parse(localStorage.getItem('qa-reconnect-tasks')); tasks[0].status = 'failed'; tasks[0].error = '连接已断开'; delete tasks[0].checkpoints['codex-turn']; localStorage.setItem('qa-reconnect-tasks', JSON.stringify(tasks)); });
  await page.reload(); await openThread();
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('qa-reconnect-tasks'))[0].status === 'completed');
  assert.equal(await page.evaluate(() => window.qa.sends), 0);
  assert.equal(await page.locator('.conversation-user').count(), 1);
  assert.equal(await page.getByRole('button', { name: '重试', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: restart reattaches the original running task, completion survives reload, and manual reconnect never resends a prompt');
} finally { await browser.close(); }
