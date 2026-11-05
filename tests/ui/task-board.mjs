// Run with the same Vite server and PLAYWRIGHT_MODULE as the conversation UI suite.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, timezoneId: 'Asia/Shanghai' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    let tasks = []
    let board = JSON.parse(sessionStorage.getItem('board') || 'null') || { cards: [{ id: 'legacy', title: '旧任务示例', description: '旧说明', status: 'done' }] }
    let thread
    const callbacks = new Map()
    let callback = 0
    let turnCount = 0
    let capturedIds = []
    const documents = [
      { id: 'feedback', title: '试用反馈', collectionName: '用户研究', documentDate: '2026-11-05' },
      { id: 'brief', title: '产品说明', collectionName: '产品资料', documentDate: '2026-11-04' },
    ]
    window.qa = { get turnCount() { return turnCount }, get capturedIds() { return capturedIds } }
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(fn) { callbacks.set(++callback, fn); return callback },
      unregisterCallback(id) { callbacks.delete(id) },
      async invoke(command, args = {}) {
        if (command === 'plugin:event|listen') return args.handler
        if (command.startsWith('plugin:')) return null
        if (command === 'capability_broker_ready') return null
        if (command === 'agent_tools') return [{ id: 'codex', detected: true, signIn: { state: 'in' } }]
        if (command === 'capability_agent') return 'codex'
        if (command === 'tasks_read') return structuredClone(tasks)
        if (command === 'tasks_write') { tasks = structuredClone(args.records); return null }
        if (command === 'task_board_command') {
          const r = args.request
          if (r.op === 'add') board.cards.push({ ...r, engine: 'goals', status: 'queued', createdAt: Date.now() })
          else if (r.op === 'queue-pause') board.paused = r.paused
          else throw new Error('Unexpected goal operation ' + r.op)
          sessionStorage.setItem('board', JSON.stringify(board))
          return structuredClone(board)
        }
        if (command === 'task_board_read') return structuredClone(board)
        if (command === 'task_board_write') {
          board = structuredClone(args.board)
          sessionStorage.setItem('board', JSON.stringify(board))
          return null
        }
        if (command === 'list_capabilities') return []
        if (command === 'library_list_documents') return documents
        if (command === 'library_organization') return { topics: [], folders: [], origins: {}, trash: {} }
        if (command === 'library_capture_sources') {
          capturedIds = args.ids
          return args.ids.map(id => {
            const doc = documents.find(item => item.id === id)
            if (!doc) throw new Error('Missing Library document')
            return { reference: { kind: 'library-document', documentId: id, title: doc.title, snapshotId: args.id, revision: '1' }, documentDate: doc.documentDate, content: id === 'feedback' ? '文档正文：试用反馈原始记录' : '文档正文：产品定位与边界' }
          })
        }
        if (command === 'conversation_list') return { data: thread ? [thread] : [], nextCursor: null }
        if (command === 'conversation_create_board_thread') {
          assertTitle(args.title)
          thread = { id: 'board-thread', name: args.title, createdAt: 1, updatedAt: 1, turns: [] }
          return structuredClone(thread)
        }
        if (command === 'conversation_read') return structuredClone(thread)
        if (command === 'conversation_run') {
          if (!args.request.taskBoard || args.request.threadId !== thread.id) throw new Error('Invalid board execution')
          if (!args.request.context.includes('产品定位与边界')) throw new Error('Task Library references did not reach Codex')
          await new Promise(resolve => setTimeout(resolve, 180))
          const turn = {
            id: 'turn-' + ++turnCount, status: 'completed',
            items: [{ id: 'result', type: 'agentMessage', phase: 'final_answer', text: turnCount === 1
              ? '## NOOKI_QUESTION\n面向哪个团队？' : '草稿已完成。' }],
          }
          thread.turns.push(turn)
          return { threadId: thread.id, turnId: turn.id }
        }
        throw new Error('Unexpected ' + command)
      },
    }
    function assertTitle(title) { if (title !== '整理试用反馈，提出改进建议（修订）') throw new Error('Invalid board thread title') }
  })
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/')
  await page.getByRole('heading', { name: '任务板' }).waitFor()
  assert.equal(await page.locator('.task-board-agent [role="status"]').innerText(), '空闲')
  const expectedDate = await page.evaluate(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  assert.equal(await page.locator('.task-board-date').getAttribute('datetime'), expectedDate)
  assert.equal(await page.getByText('最近活动', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '添加待办', exact: true }).count(), 0)
  const legacy = page.locator('.task-board-card').filter({ hasText: '旧任务示例' })
  assert.equal(await legacy.locator('.task-board-card-date').innerText(), '—', 'Legacy tasks do not receive an invented date')
  const panel = page.locator('.task-board-panel')
  const columns = page.locator('.task-board-columns')
  const card = page.locator('.task-board-card').filter({ hasText: '整理试用反馈，提出改进建议' })
  await page.getByRole('button', { name: '新建任务' }).click()
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    for (const width of [980, 1240]) {
      await page.setViewportSize({ width, height: 820 })
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.page-frame')).opacity === '1')
      assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth))
      const createButton = panel.getByRole('button', { name: '创建任务', exact: true })
      const buttonBounds = await createButton.boundingBox()
      assert.ok(buttonBounds && buttonBounds.y >= 0 && buttonBounds.y + buttonBounds.height <= 820)
      assert.ok(buttonBounds.width < 180, 'Create action stays compact')
      assert.equal(await panel.locator('.task-board-compose-meta, .task-board-compose-note').count(), 0)
      if (process.env.NOOKI_TASK_BOARD_SCREENSHOTS) {
        await mkdir(process.env.NOOKI_TASK_BOARD_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: `${process.env.NOOKI_TASK_BOARD_SCREENSHOTS}/create-${theme}-${width}.png`, animations: 'disabled' })
      }
    }
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await panel.getByLabel('任务名称').fill('整理试用反馈，提出改进建议')
  const description = panel.getByLabel('任务要求或备注')
  await description.fill('联系 user@example.com')
  assert.equal(await panel.getByRole('listbox').count(), 0, 'Email addresses do not open the reference picker')
  await description.fill('整理反馈并给出草稿。 @不存在')
  await panel.getByText('没有找到匹配的文件').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await panel.isVisible(), true, 'Escape dismisses the mention menu before the task panel')
  await description.fill('整理反馈并给出草稿。')
  await panel.getByRole('button', { name: '引用文件', exact: true }).click()
  await panel.getByRole('option', { name: '试用反馈 用户研究' }).waitFor()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await panel.getByRole('button', { name: '移除引用 产品说明' }).click()
  await description.fill('整理反馈并给出草稿。 @试用')
  await panel.getByRole('option', { name: '试用反馈 用户研究' }).click()
  assert.equal(await description.inputValue(), '整理反馈并给出草稿。 ')
  if (process.env.NOOKI_TASK_BOARD_SCREENSHOTS) {
    await description.fill('整理反馈并给出草稿。 @')
    await panel.getByRole('option', { name: '产品说明 产品资料' }).waitFor()
    assert.equal(await panel.getByRole('option', { name: '试用反馈 用户研究' }).count(), 0, 'Already attached documents are excluded')
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      for (const width of [980, 1240]) {
        await page.setViewportSize({ width, height: 820 })
        assert.ok(await panel.evaluate(element => element.scrollWidth <= element.clientWidth))
        await page.screenshot({ path: `${process.env.NOOKI_TASK_BOARD_SCREENSHOTS}/reference-picker-${theme}-${width}.png`, animations: 'disabled' })
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await page.keyboard.press('Escape')
    await description.fill('整理反馈并给出草稿。')
  }
  await page.locator('.task-board-content').click({ position: { x: 12, y: 400 } })
  await panel.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '新建任务' }).click()
  assert.equal(await panel.getByLabel('任务名称').inputValue(), '整理试用反馈，提出改进建议', 'Dismissing a new task preserves its draft')
  await panel.getByRole('button', { name: '移除引用 试用反馈' }).waitFor()
  await panel.getByRole('button', { name: '创建任务' }).click()
  await panel.waitFor({ state: 'hidden' })
  await card.waitFor()
  const createdAt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('board')).cards.find(card => card.id !== 'legacy').createdAt)
  assert.equal(await card.locator('time').getAttribute('datetime'), new Date(createdAt).toISOString())
  assert.equal(await card.locator('time').innerText(), await page.evaluate(date => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date), createdAt))
  assert.equal(await card.locator(':scope > *').count(), 3, 'New tasks show their queue status')
  assert.equal((await card.innerText()).includes('创建'), false)
  if (process.env.NOOKI_TASK_BOARD_SCREENSHOTS) await page.screenshot({ path: `${process.env.NOOKI_TASK_BOARD_SCREENSHOTS}/board-light.png`, animations: 'disabled' })
  const before = await columns.boundingBox()
  // Load a legacy todo fixture to retain coverage for editing and the original draft-only delegation.
  await page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('board'))
    const task = saved.cards.find(card => card.id !== 'legacy')
    delete task.engine; task.status = 'todo'
    sessionStorage.setItem('board', JSON.stringify(saved))
  })
  await page.reload()
  await card.click()
  await panel.getByRole('button', { name: '交给 Agent' }).waitFor()
  assert.equal(await panel.locator('.task-board-sheet').count(), 1)
  assert.equal(await panel.getByText('自己处理', { exact: true }).count(), 0)
  assert.equal(await panel.getByText('任务要求', { exact: true }).count(), 0)
  assert.equal(await panel.locator('.task-board-progress, .task-board-sources').count(), 0)
  assert.deepEqual(await columns.boundingBox(), before)
  if (process.env.NOOKI_TASK_BOARD_SCREENSHOTS) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.screenshot({ path: `${process.env.NOOKI_TASK_BOARD_SCREENSHOTS}/detail-${theme}.png`, animations: 'disabled' })
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  }
  const revisedTitle = '整理试用反馈，提出改进建议（修订）'
  await panel.getByRole('button', { name: '编辑任务', exact: true }).click()
  assert.equal(await panel.getByLabel('任务名称').inputValue(), '整理试用反馈，提出改进建议')
  await panel.getByLabel('任务名称').fill(revisedTitle)
  await description.fill('根据产品说明整理改进建议。')
  await panel.getByRole('button', { name: '移除引用 试用反馈' }).click()
  await panel.getByRole('button', { name: '引用文件', exact: true }).click()
  await panel.getByRole('option', { name: '产品说明 产品资料' }).click()
  await page.locator('.task-board-content').click({ position: { x: 12, y: 400 } })
  await panel.waitFor({ state: 'hidden' })
  await card.click()
  assert.equal(await panel.getByLabel('任务名称').inputValue(), revisedTitle, 'Dismissal preserves the unsaved edit')
  await panel.getByRole('button', { name: '移除引用 产品说明' }).waitFor()
  await description.focus()
  assert.equal(await description.evaluate(element => getComputedStyle(element).outlineStyle), 'none', 'Body input blends into the paper')
  if (process.env.NOOKI_TASK_BOARD_SCREENSHOTS) {
    await description.focus()
    await page.screenshot({ path: `${process.env.NOOKI_TASK_BOARD_SCREENSHOTS}/edit-light.png`, animations: 'disabled' })
  }
  await panel.getByRole('button', { name: '保存修改', exact: true }).click()
  await panel.getByRole('heading', { name: revisedTitle, exact: true }).waitFor()
  await panel.getByText('根据产品说明整理改进建议。', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '编辑任务', exact: true }).click()
  await panel.getByLabel('任务名称').fill('不应保存的标题')
  await panel.getByRole('button', { name: '取消', exact: true }).click()
  await panel.getByRole('heading', { name: revisedTitle, exact: true }).waitFor()
  await card.click()
  await panel.waitFor({ state: 'hidden' })
  await card.click()
  await page.keyboard.press('Escape')
  await page.reload()
  await card.click()
  assert.equal(await card.locator('time').getAttribute('datetime'), new Date(createdAt).toISOString(), 'Creation date survives reload')
  await panel.locator('.task-board-references').getByText('产品说明', { exact: true }).waitFor()
  await card.click()
  await page.getByRole('button', { name: '自动接取 · 开启', exact: true }).click()
  assert.equal(await page.locator('.task-board-agent [role="status"]').innerText(), '接取已暂停')
  await card.click()
  await panel.getByRole('button', { name: '交给 Agent' }).click()
  await card.getByText('排队中', { exact: true }).waitFor()
  assert.equal(await page.locator('.task-board-agent [role="status"]').innerText(), '接取已暂停 · 1 项待执行')
  assert.equal(await card.locator('time').getAttribute('datetime'), new Date(createdAt).toISOString())
  await card.click()
  await page.getByRole('button', { name: '自动接取 · 暂停', exact: true }).click()
  await page.getByRole('region', { name: '待我处理' }).locator('.task-board-card').filter({ hasText: revisedTitle }).waitFor()
  assert.equal(await card.getByText('排队中', { exact: true }).count(), 0)
  await card.click()
  await panel.getByText('面向哪个团队？').waitFor()
  assert.equal(await panel.getByRole('button', { name: '编辑任务', exact: true }).count(), 0, 'Delegated tasks cannot be edited as todos')
  assert.deepEqual(await page.evaluate(() => window.qa.capturedIds), ['brief'])
  await page.locator('.sidebar').getByRole('button', { name: revisedTitle, exact: true }).waitFor()
  await panel.getByLabel('补充信息').fill('面向内部产品团队')
  await panel.getByRole('button', { name: '提交并继续' }).click()
  await panel.locator('.task-board-status.review').waitFor()
  assert.equal(await panel.getByText('草稿已完成。', { exact: true }).count(), 0, 'Delivery stays in the execution conversation')
  assert.equal(await panel.getByText('交付物', { exact: true }).count(), 0)
  assert.equal(await panel.locator('.task-board-sheet').getByRole('button', { name: '打开执行会话' }).count(), 0)
  const conversationLink = panel.locator('footer').getByRole('button', { name: '打开执行会话' })
  const linkBounds = await conversationLink.boundingBox()
  const acceptBounds = await panel.getByRole('button', { name: '验收通过' }).boundingBox()
  assert.ok(linkBounds.x < acceptBounds.x && Math.abs(linkBounds.y - acceptBounds.y) < 20, 'Conversation action sits at the bottom left')
  if (process.env.NOOKI_TASK_BOARD_SCREENSHOTS) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.screenshot({ path: `${process.env.NOOKI_TASK_BOARD_SCREENSHOTS}/review-${theme}.png`, animations: 'disabled' })
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  }
  await panel.getByRole('button', { name: '验收通过' }).click()
  await page.getByRole('region', { name: '已完成' }).locator('.task-board-card').filter({ hasText: '整理试用反馈，提出改进建议' }).waitFor()
  assert.equal(await page.evaluate(() => window.qa.turnCount), 2)
  await panel.getByRole('button', { name: '打开执行会话' }).click()
  await page.locator('.conversation-thread-title').getByText(revisedTitle).waitFor()
  await page.getByRole('button', { name: '任务板', exact: true }).click()
  await card.click()
  await panel.getByRole('button', { name: '删除任务', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await page.reload()
  await page.getByRole('heading', { name: '任务板' }).waitFor()
  assert.equal(await card.count(), 0, 'Deleted cards stay removed after reload')
  await page.evaluate(() => {
    const board = JSON.parse(sessionStorage.getItem('board'))
    board.cards = Array.from({ length: 36 }, (_, index) => ({ id: `overflow-${index}`, title: `任务 ${index + 1}`, description: '', status: index < 18 ? 'todo' : 'done', createdAt: Date.now() }))
    sessionStorage.setItem('board', JSON.stringify(board))
  })
  await page.reload()
  await page.locator('.task-board-card').first().waitFor()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.page-frame')).opacity === '1')
  let compactHeight
  for (const [width, height] of [[1240, 680], [1240, 1120], [980, 820], [760, 820]]) {
    await page.setViewportSize({ width, height })
    const bounds = await columns.boundingBox()
    assert.ok(bounds.y + bounds.height <= height, 'The board fits the available window height')
    assert.ok(await page.locator('.task-board-content').evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'Task counts do not make the whole page scroll')
    if (height === 680) compactHeight = bounds.height
    if (height === 1120) assert.ok(bounds.height > compactHeight + 300, 'Taller windows increase the board height')
    const doneList = page.locator('.task-board-lane.done .task-board-lane-cards')
    const todoList = page.locator('.task-board-lane.todo .task-board-lane-cards')
    assert.ok(await doneList.evaluate(element => element.scrollHeight > element.clientHeight), 'Overflow belongs to the card list')
    const heading = page.locator('.task-board-lane.done .task-board-lane-heading')
    const headingBefore = await heading.boundingBox()
    await doneList.evaluate(element => { element.scrollTop = element.scrollHeight })
    assert.ok(await doneList.evaluate(element => element.scrollTop > 0))
    assert.equal(await todoList.evaluate(element => element.scrollTop), 0, 'Each column scrolls independently')
    assert.deepEqual(await heading.boundingBox(), headingBefore, 'The column heading stays fixed')
    const last = await doneList.locator('.task-board-card').last().boundingBox()
    const listBounds = await doneList.boundingBox()
    assert.ok(last.y >= listBounds.y && last.y + last.height <= listBounds.y + listBounds.height, 'The last task remains reachable')
    if (process.env.NOOKI_TASK_BOARD_SCREENSHOTS) await page.screenshot({ path: `${process.env.NOOKI_TASK_BOARD_SCREENSHOTS}/overflow-${width}-${height}.png`, animations: 'disabled' })
    await doneList.evaluate(element => { element.scrollTop = 0 })
  }
  await page.setViewportSize({ width: 1240, height: 820 })
  await page.clock.install({ time: new Date('2026-11-05T15:59:00Z') })
  await page.reload()
  await page.getByRole('heading', { name: '任务板' }).waitFor()
  await page.clock.runFor(500)
  assert.equal(await page.locator('.task-board-date').getAttribute('datetime'), '2026-11-05')
  await page.clock.fastForward('01:01')
  assert.equal(await page.locator('.task-board-date').getAttribute('datetime'), '2026-11-06', 'The local date updates at midnight')
  assert.equal(await page.getByText('星期五', { exact: true }).count(), 1)
  assert.deepEqual(errors, [])
  console.log('Task board todo editing, cancel, references, Library mentions, persisted references, dates, overlay dismissal, draft persistence, deletion, Codex handoff and acceptance passed')
} finally {
  await browser.close()
}
