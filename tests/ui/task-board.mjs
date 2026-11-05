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
    let board = JSON.parse(sessionStorage.getItem('board') || 'null')
    let thread
    const callbacks = new Map()
    let callback = 0
    let turnCount = 0
    window.qa = { get turnCount() { return turnCount } }
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
        if (command === 'task_board_read') return board
        if (command === 'task_board_write') {
          board = structuredClone(args.board)
          sessionStorage.setItem('board', JSON.stringify(board))
          return null
        }
        if (command === 'list_capabilities' || command === 'library_list_documents') return []
        if (command === 'library_organization') return { topics: [], folders: [], origins: {}, trash: {} }
        if (command === 'library_capture_sources') return []
        if (command === 'conversation_list') return { data: thread ? [thread] : [], nextCursor: null }
        if (command === 'conversation_create_board_thread') {
          assertTitle(args.title)
          thread = { id: 'board-thread', name: args.title, createdAt: 1, updatedAt: 1, turns: [] }
          return structuredClone(thread)
        }
        if (command === 'conversation_read') return structuredClone(thread)
        if (command === 'conversation_run') {
          if (!args.request.taskBoard || args.request.threadId !== thread.id) throw new Error('Invalid board execution')
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
    function assertTitle(title) { if (title !== '整理试用反馈') throw new Error('Invalid board thread title') }
  })
  await page.goto(process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/')
  await page.getByRole('heading', { name: '任务板' }).waitFor()
  const expectedDate = await page.evaluate(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  assert.equal(await page.locator('.task-board-date').getAttribute('datetime'), expectedDate)
  assert.equal(await page.getByText('最近活动', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '添加待办', exact: true }).count(), 0)
  const panel = page.locator('.task-board-panel')
  const columns = page.locator('.task-board-columns')
  const card = page.locator('.task-board-card').filter({ hasText: '整理试用反馈' })
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
  await panel.getByLabel('任务名称').fill('整理试用反馈')
  await panel.getByLabel('任务要求或备注').fill('整理反馈并给出草稿。')
  await page.locator('.task-board-content').click({ position: { x: 12, y: 400 } })
  await panel.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '新建任务' }).click()
  assert.equal(await panel.getByLabel('任务名称').inputValue(), '整理试用反馈', 'Dismissing a new task preserves its draft')
  await panel.getByRole('button', { name: '创建任务' }).click()
  await panel.waitFor({ state: 'hidden' })
  await card.waitFor()
  if (process.env.NOOKI_TASK_BOARD_SCREENSHOTS) await page.screenshot({ path: `${process.env.NOOKI_TASK_BOARD_SCREENSHOTS}/board-light.png`, animations: 'disabled' })
  const before = await columns.boundingBox()
  await card.click()
  await panel.getByRole('button', { name: '交给 Agent' }).waitFor()
  assert.deepEqual(await columns.boundingBox(), before)
  if (process.env.NOOKI_TASK_BOARD_SCREENSHOTS) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.screenshot({ path: `${process.env.NOOKI_TASK_BOARD_SCREENSHOTS}/detail-${theme}.png`, animations: 'disabled' })
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  }
  await card.click()
  await panel.waitFor({ state: 'hidden' })
  await card.click()
  await page.keyboard.press('Escape')
  await page.reload()
  await card.click()
  await panel.getByRole('button', { name: '交给 Agent' }).click()
  await panel.getByText('面向哪个团队？').waitFor()
  await page.locator('.sidebar').getByRole('button', { name: '整理试用反馈', exact: true }).waitFor()
  await panel.getByLabel('补充信息').fill('面向内部产品团队')
  await panel.getByRole('button', { name: '提交并继续' }).click()
  await panel.getByText('草稿已完成。').waitFor()
  await panel.getByRole('button', { name: '验收通过' }).click()
  await page.getByRole('region', { name: '已完成' }).locator('.task-board-card').waitFor()
  assert.equal(await page.evaluate(() => window.qa.turnCount), 2)
  await panel.getByRole('button', { name: '打开执行会话' }).click()
  await page.locator('.conversation-thread-title').getByText('整理试用反馈').waitFor()
  await page.getByRole('button', { name: '任务板', exact: true }).click()
  await card.click()
  await panel.getByRole('button', { name: '删除任务', exact: true }).click()
  await panel.waitFor({ state: 'hidden' })
  await page.reload()
  await page.getByRole('heading', { name: '任务板' }).waitFor()
  assert.equal(await card.count(), 0, 'Deleted cards stay removed after reload')
  await page.clock.install({ time: new Date('2026-11-05T15:59:00Z') })
  await page.reload()
  await page.getByRole('heading', { name: '任务板' }).waitFor()
  await page.clock.runFor(500)
  assert.equal(await page.locator('.task-board-date').getAttribute('datetime'), '2026-11-05')
  await page.clock.fastForward('01:01')
  assert.equal(await page.locator('.task-board-date').getAttribute('datetime'), '2026-11-06', 'The local date updates at midnight')
  assert.equal(await page.getByText('星期五', { exact: true }).count(), 1)
  assert.deepEqual(errors, [])
  console.log('Task board dates, overlay dismissal, draft persistence, deletion, Codex handoff and acceptance passed')
} finally {
  await browser.close()
}
