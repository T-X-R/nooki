import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const url = process.env.CONVERSATION_TEST_URL || 'http://127.0.0.1:5193/'
try {
  const page = await browser.newPage({ viewport: { width: 160, height: 108 } })
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text() + " " + message.location().url) })
  await page.addInitScript(() => {
    const listeners = new Map(), callbacks = new Map(); let counter = 1
    const state = {
      calls: [], failed: false, placement: { right: 0, bottom: 0, below: false }, preferences: { enabled: false, language: 'zh', theme: 'light' },
      board: { cards: [
        { id: 'run', title: '整理调研资料', status: 'running', threadId: 'thread-run' },
        { id: 'ask', title: '等待确认的文档任务', status: 'question', threadId: 'thread-ask' },
        { id: 'queue', title: '稍后执行的任务', status: 'queued' },
        { id: 'done', title: '已经验收', status: 'done', threadId: 'thread-done' },
        { id: 'archive', title: '已经归档', status: 'review', threadId: 'thread-archive', archived: true },
      ] },
      emit(event) { for (const [id, name] of listeners) if (name === event) callbacks.get(id)?.({ event, id, payload: null }) },
    }
    window.qaPet = state
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, id) { listeners.delete(id) } }
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'desktop-pet' }, currentWebview: { label: 'desktop-pet' } },
      transformCallback(fn) { const id = counter++; callbacks.set(id, fn); return id }, unregisterCallback(id) { callbacks.delete(id) },
      async invoke(command, args = {}) {
        state.calls.push([command, args])
        if (command === 'plugin:event|listen') { listeners.set(args.handler, args.event); return args.handler }
        if (command.startsWith('plugin:')) return null
        if (command === 'desktop_pet_snapshot') { if (state.failed) throw new Error('Read failed'); return structuredClone({ board: state.board, preferences: state.preferences }) }
        if (command === 'desktop_pet_expand') return state.placement
        if (['desktop_pet_ready', 'desktop_pet_expand', 'desktop_pet_save_position', 'desktop_pet_open_conversation'].includes(command)) return null
        throw new Error('Pet must not call ' + command)
      },
    }
  })
  await page.goto(url + '?desktop-pet')
  await page.getByRole('button', { name: /查看任务状态：需要你处理/ }).waitFor()
  assert.equal(await page.locator('.app-shell').count(), 0)
  assert.equal(await page.locator('.pet-status').count(), 0)
  assert.equal(await page.locator('.pet-animated').evaluate(img => img.complete && img.naturalWidth > 0), true)
  assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth))
  await mkdir('/tmp/nooki-pet-ui', { recursive: true })
  await page.screenshot({ path: '/tmp/nooki-pet-ui/collapsed.png', omitBackground: true })
  // Native resizing also emits move events; only a user drag may persist a new anchor.
  await page.evaluate(() => window.qaPet.emit('tauri://move'))
  await page.waitForTimeout(400)
  assert.equal(await page.evaluate(() => window.qaPet.calls.filter(([name]) => name === 'desktop_pet_save_position').length), 0)
  const avatar = page.getByRole('button', { name: /^查看任务状态：/ })
  await avatar.dispatchEvent('pointerdown', { button: 0, clientX: 50, clientY: 50 })
  await avatar.dispatchEvent('pointermove', { clientX: 65, clientY: 65 })
  await avatar.dispatchEvent('pointercancel')
  await page.evaluate(() => window.qaPet.emit('tauri://move'))
  await page.waitForFunction(() => window.qaPet.calls.some(([name]) => name === 'desktop_pet_save_position'))
  await page.getByRole('button', { name: /^查看任务状态：/ }).click()
  await page.setViewportSize({ width: 320, height: 386 })
  await page.getByRole('region', { name: '任务状态' }).waitFor()
  assert.deepEqual(await page.locator('.pet-activity li strong').allTextContents(), ['等待确认的文档任务', '整理调研资料', '稍后执行的任务'])
  assert.equal(await page.getByRole('button', { name: /稍后执行的任务/ }).isDisabled(), true)
  assert.equal(await page.getByRole('textbox').count(), 0)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { window.qaPet.preferences.theme = theme }, theme)
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme)
    await page.screenshot({ path: `/tmp/nooki-pet-ui/${theme}.png`, omitBackground: true })
  }
  await page.getByRole('button', { name: /等待确认的文档任务/ }).click()
  assert.deepEqual(await page.evaluate(() => window.qaPet.calls.filter(([name]) => name === 'desktop_pet_open_conversation').at(-1)), ['desktop_pet_open_conversation', { id: 'ask' }])
  assert.equal(await page.locator('.pet-activity').count(), 0)
  const saves = await page.evaluate(() => window.qaPet.calls.filter(([name]) => name === 'desktop_pet_save_position').length)
  await page.evaluate(() => window.qaPet.emit('tauri://move'))
  await page.waitForTimeout(400)
  assert.equal(await page.evaluate(() => window.qaPet.calls.filter(([name]) => name === 'desktop_pet_save_position').length), saves)
  await page.getByRole('button', { name: /^查看任务状态：/ }).click()
  await page.evaluate(() => window.qaPet.emit('desktop-pet:collapsed'))
  await page.locator('.pet-activity').waitFor({ state: 'detached' })
  for (const right of [0, 160]) for (const below of [false, true]) {
    await page.evaluate(placement => { window.qaPet.placement = placement }, { right, bottom: below ? 278 : 0, below })
    await avatar.click()
    const cat = await page.locator('.pet-companion').boundingBox()
    const panel = await page.locator('.pet-activity').boundingBox()
    assert.equal(cat.x, 160 - right)
    assert.equal(cat.y, below ? 0 : 278)
    assert.ok(panel.x >= 0 && panel.x + panel.width <= 320 && panel.y >= 0 && panel.y + panel.height <= 386)
    assert.ok(below ? panel.y >= cat.y + cat.height : panel.y + panel.height <= cat.y)
    await page.screenshot({ path: `/tmp/nooki-pet-ui/corner-${right}-${below}.png`, omitBackground: true })
    await page.getByRole('button', { name: '收起任务列表' }).click()
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.locator('.pet-still').isVisible(), true)
  assert.equal(await page.locator('.pet-animated').isVisible(), false)
  await page.evaluate(() => { window.qaPet.failed = true })
  await page.getByRole('button', { name: /查看任务状态：状态暂不可用/ }).waitFor()
  await page.evaluate(() => { window.qaPet.failed = false; window.qaPet.board = { paused: true, cards: [] }; window.qaPet.preferences.language = 'en' })
  await page.getByRole('button', { name: /View task activity: Auto-pickup paused/ }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Pet rendering, priority, navigation, collapse, themes, reduced motion and read recovery passed')

  const main = await browser.newPage({ viewport: { width: 1240, height: 820 } })
  await main.route('**/favicon.ico', route => route.fulfill({ status: 204 }))
  const mainErrors = []
  main.on('pageerror', e => mainErrors.push(e.message))
  main.on('console', m => { if (m.type() === 'error') mainErrors.push(m.text()) })
  await main.addInitScript(() => {
    localStorage.setItem('personal-workbench-preferences', JSON.stringify({ version: 4, state: { view: 'settings', theme: 'light', language: 'zh' } }))
    const callbacks = new Map(), listeners = new Map(); let next = 1, enabled = false, target = null
    window.qaPetMain = { jump() { target = 'existing-thread'; for (const [id, event] of listeners) if (event === 'desktop-pet:navigate') callbacks.get(id)?.({ event, id, payload: null }) }, pending() { return target } }
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, id) { listeners.delete(id) } }
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback(fn) { const id = next++; callbacks.set(id, fn); return id }, unregisterCallback(id) { callbacks.delete(id) },
      async invoke(command, args = {}) {
        if (command === 'plugin:event|listen') { listeners.set(args.handler, args.event); return args.handler }
        if (command.startsWith('plugin:')) return null
        if (command === 'desktop_pet_preferences') return { enabled }
        if (command === 'desktop_pet_set_enabled') { enabled = args.enabled; return { enabled } }
        if (command === 'desktop_pet_navigation') return target
        if (command === 'desktop_pet_navigation_ack') { if (target === args.id) target = null; return null }
        if (['desktop_pet_appearance', 'capability_broker_ready', 'tasks_write'].includes(command)) return null
        if (command === 'task_board_read') return { cards: [] }
        if (['tasks_read', 'list_capabilities', 'library_list_documents'].includes(command)) return []
        if (command === 'agent_tools') return []
        if (command === 'capability_agent') return 'codex'
        if (command === 'library_organization') return { topics: [], folders: [], origins: {}, trash: {} }
        if (command === 'conversation_list') return { data: [], nextCursor: null }
        if (command === 'conversation_read') return { id: args.id, name: '原来的执行会话', turns: [{ id: 't', status: 'completed', items: [{ id: 'answer', type: 'agentMessage', text: '同一个线程的执行结果', phase: 'final_answer' }] }] }
        throw new Error('Unexpected main command ' + command)
      },
    }
  })
  await main.goto(url)
  const toggle = main.getByRole('switch', { name: '唤醒桌宠' })
  await toggle.waitFor(); await main.waitForFunction(() => !document.querySelector('#desktop-pet-switch').disabled)
  assert.equal(await toggle.evaluate(el => el.closest('.settings-section').querySelector('h2').textContent), '外观')
  assert.equal(await main.locator('.pet-setting img').count(), 0)
  assert.equal(await main.getByRole('heading', { name: '桌宠', exact: true }).count(), 0)
  assert.equal(await toggle.getAttribute('aria-checked'), 'false')
  await toggle.click(); await main.waitForFunction(() => document.querySelector('#desktop-pet-switch').getAttribute('aria-checked') === 'true')
  await main.screenshot({ path: '/tmp/nooki-pet-ui/settings.png' })
  await toggle.click(); await main.waitForFunction(() => document.querySelector('#desktop-pet-switch').getAttribute('aria-checked') === 'false')
  await main.evaluate(() => window.qaPetMain.jump())
  await main.getByText('同一个线程的执行结果', { exact: true }).waitFor()
  assert.equal(await main.evaluate(() => window.qaPetMain.pending()), null)
  assert.deepEqual(mainErrors, [])
  console.log('Settings placement, toggle and pending conversation navigation passed')
} finally { await browser.close() }
