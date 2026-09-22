// Run against the dev server with the same PLAYWRIGHT_MODULE setup as conversation.mjs.
// Synthetic native events only; this test never calls a model.
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
    const question = { id: 'question', type: 'agentMessage', phase: 'final_answer', delivery: 'async', text: '周报素材主要从哪里来？', questions: [{ title: '周报素材主要从哪里来？', options: ['粘贴或手动填写工作记录（推荐）', '读取 Nooki 中的文档和会话'] }, { title: '还有哪些要求？', options: null }] };
    let thread = JSON.parse(localStorage.getItem('qa-question-thread') || 'null') ?? { id: 'questions', preview: '周报测试', createdAt: 1, updatedAt: 1, turns: [{ id: 'turn', status: 'inProgress', items: [{ id: 'user', type: 'userMessage', content: [{ type: 'text', text: '制作周报' }] }, { id: 'reason', type: 'reasoning', summary: ['正在准备工作区'] }, question] }] };
    const persist = () => localStorage.setItem('qa-question-thread', JSON.stringify(thread));
    let nextId = 1;
    const callbacks = new Map(), events = new Map();
    window.qa = { answers: [], fail: false, emit(method, params) { for (const [event, handler] of events) if (event === 'workbench:conversation-event') callbacks.get(handler)({ event, id: handler, payload: { method, params } }); }, finish() {
      thread.turns[0].status = 'completed';
      thread.turns[0].items.push({ id: 'final', type: 'agentMessage', phase: 'final_answer', text: '周报已完成。' });
      persist(); this.emit('turn/completed', { threadId: thread.id, turn: structuredClone(thread.turns[0]) });
    }, later() { const item = { id: 'later', type: 'reasoning', summary: ['正在完成后续工作'] }; thread.turns[0].items.push(item); persist(); this.emit('item/completed', { threadId: thread.id, turnId: 'turn', item }); }, continue() { this.emit('item/reasoning/summaryTextDelta', { threadId: thread.id, turnId: 'turn', itemId: 'reason', summaryIndex: 0, delta: '\n正在整理工作记录' }); } };
    window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback(fn) { const id = nextId++; callbacks.set(id, fn); return id; }, unregisterCallback(id) { callbacks.delete(id); }, async invoke(command, args = {}) {
      if (command === 'plugin:event|listen') { events.set(args.event, args.handler); return args.handler; }
      if (command.startsWith('plugin:')) return null;
      if (command === 'capability_agent') return 'codex';
      if (['agent_tools', 'list_capabilities', 'skill_pool_list', 'library_list_documents', 'library_search_content', 'tasks_read'].includes(command)) return [];
      if (command === 'library_organization') return { topics: [], origins: {}, trash: {}, sections: {}, customSections: [] };
      if (command === 'tasks_write') return;
      if (command === 'conversation_list') return { data: [structuredClone(thread)], nextCursor: null };
      if (command === 'conversation_read') return structuredClone(thread);
      if (command === 'conversation_answer_question') {
        if (window.qa.fail) throw new Error('测试发送失败');
        if (window.qa.endOnAnswer) { window.qa.finish(); throw new Error('本轮已结束，请在输入框继续发送回答'); }
        window.qa.answers.push(args);
        await new Promise(resolve => setTimeout(resolve, 100));
        const user = { id: 'reply', type: 'userMessage', clientId: `async-answer-${args.itemId}`, content: [{ type: 'text', text: args.answers.join('\n') }] };
        thread.turns[0].items.push(user); persist();
        window.qa.emit('item/completed', { threadId: thread.id, turnId: 'turn', item: user });
        return;
      }
      throw new Error('Unexpected command ' + command);
    } };
  });
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/');
  const openThread = () => page.getByRole('button', { name: '周报测试', exact: true }).click();
  await openThread();
  const card = page.getByRole('form', { name: '执行中的提问', exact: true });
  await card.waitFor();
  assert.equal(await card.evaluate(el => !!el.closest('.conversation-turn-process-body')), true, 'Questions start inside the process history before being answered');
  assert.equal(await card.getByText('待你回答', { exact: true }).isVisible(), true);
  assert.equal(await card.getByText('任务仍在继续', { exact: true }).isVisible(), true);
  assert.equal(await page.locator('.conversation-answer').count(), 0, 'A final_answer phase on an async question does not create a final answer');
  assert.equal(await card.locator('input:checked').count(), 0, 'Recommended options are not submitted or selected automatically');
  const submit = card.getByRole('button', { name: '发送回答', exact: true });
  assert.equal(await submit.isDisabled(), true);
  await page.evaluate(() => window.qa.continue());
  await page.getByText('正在准备工作区\n正在整理工作记录', { exact: true }).waitFor();
  await card.getByRole('radio', { name: '粘贴或手动填写工作记录（推荐）', exact: true }).check();
  assert.equal(await submit.isDisabled(), true, 'Every question needs an answer');
  await card.getByRole('textbox').nth(1).fill('按项目分组');
  await card.screenshot({ path: '/private/tmp/nooki-async-question-card.png' });
  await page.evaluate(() => { window.qa.fail = true; });
  await submit.click();
  await card.getByRole('alert').waitFor();
  assert.equal(await card.getByRole('textbox').nth(1).inputValue(), '按项目分组', 'A failed request retains the draft');
  await page.evaluate(() => { window.qa.fail = false; });
  for (const width of [980, 1240]) {
    await page.setViewportSize({ width, height: 820 });
    assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  }
  await submit.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await card.getByText('已回答', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.qa.answers), [{ threadId: 'questions', turnId: 'turn', itemId: 'question', answers: ['粘贴或手动填写工作记录（推荐）', '按项目分组'] }]);
  assert.equal(await card.locator('details').getAttribute('open'), null, 'Answered questions collapse automatically');
  assert.equal(await page.locator('.conversation-user').count(), 1, 'The clarification reply is not repeated as a top-level user bubble');
  assert.equal(await card.getByText('周报素材主要从哪里来？', { exact: true }).isVisible(), false);
  await card.locator('summary').focus(); await page.keyboard.press('Enter');
  assert.equal(await card.getByText('周报素材主要从哪里来？', { exact: true }).isVisible(), true, 'The question remains available through keyboard expansion');
  assert.equal(await card.locator('.conversation-question-response p').innerText(), '粘贴或手动填写工作记录（推荐）\n按项目分组', 'Expanding history shows the submitted answers together with the questions');
  await page.evaluate(() => window.qa.later());
  await page.getByText('正在完成后续工作', { exact: true }).waitFor();
  assert.equal(await page.locator('.conversation-turn-process-body').evaluate(el => {
    const question = el.querySelector('.conversation-question');
    const later = [...el.querySelectorAll('.conversation-reasoning')].find(el => el.textContent === '正在完成后续工作');
    return !!(question.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), true, 'New progress follows the answered question in the process history');
  assert.notEqual(await card.locator('details').getAttribute('open'), null, 'New progress does not close a question being reviewed');
  await page.screenshot({ path: '/private/tmp/nooki-question-answer-expanded.png' });
  await card.locator('summary').click();
  await page.screenshot({ path: '/private/tmp/nooki-answered-question-collapsed.png' });
  await page.reload(); await openThread();
  await card.getByText('已回答', { exact: true }).waitFor();
  assert.equal(await card.locator('details').getAttribute('open'), null, 'Reload restores the compact answered state');
  assert.equal(await page.locator('.conversation-user').count(), 1);
  await card.locator('summary').click();
  assert.equal(await card.locator('.conversation-question-response p').innerText(), '粘贴或手动填写工作记录（推荐）\n按项目分组', 'Native answer history survives refresh');
  await card.locator('summary').click();
  await page.evaluate(() => window.qa.finish());
  await page.locator('.conversation-answer').getByText('周报已完成。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '保存到资料库', exact: true }).count(), 1, 'Only the final answer can be saved');
  await page.reload(); await openThread();
  await page.locator('.conversation-turn-process > summary').click();
  await card.getByText('已回答', { exact: true }).waitFor();
  assert.equal(await card.locator('details').getAttribute('open'), null);
  assert.equal(await page.locator('.conversation-answer').count(), 1);
  // The turn can end after the person chooses an answer but before native steering accepts it.
  await page.evaluate(() => localStorage.removeItem('qa-question-thread'));
  await page.reload(); await openThread();
  await card.getByRole('textbox').nth(0).fill('自定义来源');
  await card.getByRole('textbox').nth(1).fill('简短一些');
  await page.evaluate(() => { window.qa.endOnAnswer = true; });
  await submit.click();
  await page.locator('.conversation-answer').getByText('周报已完成。', { exact: true }).waitFor();
  await page.locator('.conversation-turn-process > summary').click();
  await card.getByText('本轮已结束', { exact: true }).waitFor();
  assert.equal(await card.getByText('已回答', { exact: true }).count(), 0);
  assert.equal(await card.getByRole('button').count(), 0);
  assert.equal(await card.getByRole('textbox').nth(0).inputValue(), '自定义来源', 'A turn ending during submission keeps the answer available to copy');
  assert.equal(await card.getByText('如需补充，请在下方输入框继续发送消息。', { exact: true }).isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.qa.answers), []);
  assert.deepEqual(errors, []);
  console.log('PASS: async question classification, continuing progress, options/free text, failed-send retry, keyboard submission, persisted answers, paired question/answer history, no duplicate reply bubbles, chronological progress and turn-end races');
} finally { await browser.close(); }
