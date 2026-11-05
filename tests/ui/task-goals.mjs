import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 820 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    let answered = false
    let messages = []
    let requests = []
    let board = JSON.parse(sessionStorage.getItem('goals-board') || '{"cards":[]}')
    const save = () => sessionStorage.setItem('goals-board', JSON.stringify(board))
    window.qaGoals = {
      patch(patch) { Object.assign(board.cards[0], patch); save() },
      state() { return board },
      requests() { return requests },
    }
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback() { return 1 }, unregisterCallback() {},
      async invoke(command, args = {}) {
        if (command.startsWith('plugin:') || command === 'capability_broker_ready') return null
        if (command === 'agent_tools') return [{ id: 'codex', detected: true, signIn: { state: 'in' } }]
        if (command === 'capability_agent') return 'codex'
        if (['tasks_read', 'list_capabilities', 'library_list_documents'].includes(command)) return []
        if (command === 'tasks_write') return null
        if (command === 'conversation_list') return { data: board.cards.filter(c => c.threadId).map(c => ({ id: c.threadId, name: c.title, createdAt: c.createdAt / 1000, taskId: c.id, turns: [] })), nextCursor: null }
        if (command === 'conversation_read') {
          const card = board.cards.find(c => c.threadId === args.id)
          if (!card) throw new Error('Task conversation missing')
          const items = [...messages]
          if (card.delivery) items.push({ id: 'answer', type: 'agentMessage', phase: 'final_answer', text: card.delivery.text })
          if (card.asyncQuestion) {
            items.push({ id: 'question-one', type: 'agentMessage', delivery: 'async', questions: [{ title: '选择语言', options: ['中文', 'English'] }] })
            if (answered) items.push({ id: 'question-reply', type: 'userMessage', clientId: 'async-answer-question-one', content: [{ type: 'text', text: '中文' }] })
          }
          return structuredClone({ id: card.threadId, name: card.title, taskId: card.id, task: { ...card, deliveryTurnId: 'turn-1' }, turns: [{ id: 'turn-1', status: card.activeTurn ? 'inProgress' : 'completed', items }] })
        }
        if (command === 'conversation_answer_question') { answered = true; requests.push(command); return null }
        if (command === 'library_organization') return { topics: [], folders: [], origins: {}, trash: {} }
        if (command === 'task_board_choose_directory') return '/tmp/goal-project'
        if (command === 'task_board_read') return structuredClone(board)
        if (command === 'task_board_write') throw new Error('Renderer must not dispatch Goal tasks')
        if (command === 'task_board_command') {
          const r = args.request; requests.push(r.op); const card = board.cards.find(c => c.id === r.id)
          if (r.op === 'add') board.cards.push({ id: r.id, title: r.title, description: r.description, cwd: r.cwd, sources: [], engine: 'goals', status: 'queued', createdAt: Date.now() })
          if (r.op === 'queue-pause') board.paused = r.paused
          if (r.op === 'pause') Object.assign(card, { status: 'pausing', goal: { status: 'paused', tokensUsed: 100 }, activeTurn: true })
          if (r.op === 'stop') Object.assign(card, { status: 'stopped', activeTurn: false, requests: [] })
          if (r.op === 'resume' || r.op === 'feedback') card.status = 'queued'
          if (r.op === 'reply') { card.requests = []; card.status = 'running' }
          if (r.op === 'message') messages.push({ id: r.messageId, clientId: r.messageId, type: 'userMessage', content: [{ type: 'text', text: r.message }] })
          if (r.op === 'accept') card.status = 'done'
          if (r.op === 'history') return { id: 'goal-thread', turns: [{ id: 'turn-1', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Native history retained' }] }] }
          save(); return structuredClone(board)
        }
        throw new Error('Unexpected ' + command)
      },
    }
  })
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/')
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  const panel = page.locator('.task-board-panel')
  await panel.getByLabel('任务名称').fill('验证原生 Goal')
  await panel.getByLabel('任务要求或备注').fill('生成报告并验证')
  await panel.getByRole('button', { name: '选择目录' }).click()
  assert.equal(await panel.getByLabel('工作目录（可选）').inputValue(), '/tmp/goal-project')
  assert.equal(await panel.locator('.task-board-composer .task-goal-workspace').count(), 0)
  assert.equal(await panel.getByText(/创建后自动排队/).count(), 0)
  await mkdir('/tmp/nooki-goals-ui/screenshots', { recursive: true })
  for (const width of [980, 1240]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 820 })
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth))
    await page.screenshot({ animations: 'disabled', path: `/tmp/nooki-goals-ui/screenshots/composer-${width}-${theme}.png` })
  }
  await panel.getByRole('button', { name: '创建任务', exact: true }).click()
  const card = page.locator('.task-board-card').filter({ hasText: '验证原生 Goal' })
  await card.getByText('排队中').waitFor()
  await page.evaluate(() => window.qaGoals.patch({ status: 'running', threadId: 'goal-thread', activeTurn: true, execution: { cwd: '/tmp/goal-project', model: 'fixture', sandbox: 'workspace-write', approvalPolicy: 'on-request', outputs: '/tmp/outputs' } }))
  await card.click()
  await panel.getByRole('button', { name: '暂停续跑' }).click()
  await panel.getByText('暂停中 · 等待本轮结束', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: '验收通过' }).count(), 0)
  await panel.getByRole('button', { name: '停止执行' }).click()
  await panel.getByText('已停止', { exact: true }).waitFor()
  await page.reload(); await card.click()
  await panel.getByRole('button', { name: '恢复执行' }).click()
  await panel.getByText('排队中', { exact: true }).waitFor()
  await page.evaluate(() => window.qaGoals.patch({ status: 'question', activeTurn: true, requests: [{ id: 9, method: 'item/commandExecution/requestApproval', params: { command: 'echo sample', reason: '需要批准此操作' } }] }))
  assert.equal(await panel.getByText('echo sample', { exact: true }).count(), 0, 'Approvals belong to the conversation')
  await panel.locator('footer').getByRole('button', { name: '打开执行会话' }).click()
  const conversation = page.locator('.conversation-page')
  await conversation.getByText('echo sample', { exact: true }).waitFor()
  await page.locator('.sidebar').getByRole('button', { name: '验证原生 Goal', exact: true }).waitFor()
  assert.equal(await page.locator('.sidebar').getByRole('button', { name: '归档会话：验证原生 Goal', exact: true }).count(), 0, 'Task ownership is not bypassed by ordinary archive actions')
  await conversation.getByRole('button', { name: '拒绝', exact: true }).click()
  await conversation.getByText('Codex 请求授权', { exact: true }).waitFor({ state: 'hidden' })
  await page.evaluate(() => window.qaGoals.patch({ status: 'question', requests: [{ id: 10, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'audience', question: '报告面向谁？', options: [{ label: '产品团队', description: '内部报告' }] }] } }] }))
  await conversation.getByRole('button', { name: '产品团队', exact: true }).click()
  await conversation.getByRole('button', { name: '提交回答' }).click()
  await conversation.getByText('Codex 需要你的输入', { exact: true }).waitFor({ state: 'hidden' })
  await page.evaluate(() => window.qaGoals.patch({ asyncQuestion: true, status: 'running', activeTurn: true }))
  await conversation.getByRole('radio', { name: '中文', exact: true }).check()
  await conversation.getByRole('button', { name: '发送回答', exact: true }).click()
  await conversation.getByText('已回答', { exact: true }).waitFor()
  await conversation.getByRole('textbox', { name: '消息', exact: true }).fill('请补充数据来源')
  await conversation.getByRole('button', { name: '发送消息', exact: true }).click()
  await conversation.locator('.conversation-user').getByText('请补充数据来源', { exact: true }).waitFor()
  assert.ok((await page.evaluate(() => window.qaGoals.requests())).includes('message'))
  await page.evaluate(() => window.qaGoals.patch({ status: 'review', activeTurn: false, goal: { status: 'complete', tokensUsed: 900 }, delivery: { text: '# 成果\n\n报告已验证。', artifacts: [{ id: 'report', name: 'report.md', content: '# 报告\n已完成', before: null, source: null }] } }))
  await conversation.getByText('报告已验证。', { exact: true }).waitFor()
  await conversation.getByRole('button', { name: '预览', exact: true }).click()
  await page.getByRole('dialog').getByRole('heading', { name: 'report.md' }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: /关闭|Close/ }).click()
  await mkdir('/tmp/nooki-goals-ui/screenshots', { recursive: true })
  for (const width of [980, 1240]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 820 })
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme)
    assert.ok(await conversation.evaluate(el => el.scrollWidth <= el.clientWidth), 'Conversation does not overflow')
    await page.screenshot({ animations: 'disabled', path: `/tmp/nooki-goals-ui/screenshots/conversation-${width}-${theme}.png` })
  }
  await page.locator('.sidebar').getByRole('button', { name: '任务板', exact: true }).click()
  await card.click()
  assert.equal(await panel.getByText('报告已验证。', { exact: true }).count(), 0, 'The board does not duplicate delivery or process UI')
  assert.equal(await panel.getByRole('button', { name: '查看执行过程', exact: true }).count(), 0)
  await panel.getByRole('button', { name: '验收通过' }).click()
  await panel.getByText('已完成', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '打开执行会话' }).click()
  assert.equal(await conversation.getByRole('textbox', { name: '消息', exact: true }).isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log('Goal UI: separate workspace block, board-to-conversation navigation, shared sidebar, native approvals/questions, messages and delivery passed')
} finally { await browser.close() }
