import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskBoard } from '../src/features/task-board/task-board-store.ts'

test('task cards validate, survive reload and retain personal completion', async () => {
  let saved = null
  const create = () => createTaskBoard({ read: async () => saved, write: async (state) => { saved = structuredClone(state) } })
  const board = create()
  await assert.rejects(board.add('  ', ''))
  const [first, second] = await Promise.all([board.add('  First  ', ' notes '), board.add('Second', '')])
  await board.complete(first)
  const reopened = create()
  await reopened.initialize()
  assert.deepEqual(reopened.snapshot().cards.map(({ id, title, description, status }) => ({ id, title, description, status })), [
    { id: first, title: 'First', description: 'notes', status: 'done' },
    { id: second, title: 'Second', description: '', status: 'todo' },
  ])
})

test('an unsuccessful write leaves the last saved board visible', async () => {
  const board = createTaskBoard({ read: async () => null, write: async () => { throw new Error('disk error') } })
  await assert.rejects(board.add('First', ''), /disk error/)
  assert.deepEqual(board.snapshot().cards, [])
})

test('dispatcher claims one authorized card, persists the thread and reuses it for revisions', async () => {
  const { createBoardDispatcher } = await import('../src/features/task-board/task-board-dispatch.ts')
  const board = createTaskBoard({ read: async () => null, write: async () => {} })
  const personal = await board.add('Personal', '')
  const first = await board.add('First delegated', 'Requirements')
  const next = await board.add('Second delegated', '')
  await board.delegate(first, { snapshotId: 'snapshot-first', documentIds: ['source'] })
  await board.delegate(next, { snapshotId: 'snapshot-next', documentIds: [] })
  const records = new Map()
  const dispatched = []
  let created = 0
  const dispatcher = createBoardDispatcher(board, {
    find: id => records.get(id),
    createThread: async () => `thread-${++created}`,
    start: async (card, runId) => {
      assert.equal(board.snapshot().cards.find(item => item.id === card.id).threadId, card.threadId)
      dispatched.push([card.id, card.threadId, card.followUp, card.authorization.snapshotId])
      records.set(runId, { status: 'running' })
    },
    delivery: async () => ({ text: 'Draft', artifacts: [] }),
    stop: async () => {},
  })
  await board.setPaused(true)
  await dispatcher.reconcile(true)
  assert.equal(created, 0)
  await board.setPaused(false)
  await Promise.all([dispatcher.reconcile(true), dispatcher.reconcile(true)])
  assert.equal(created, 1)
  assert.equal(board.snapshot().cards.find(card => card.id === personal).status, 'todo')
  const running = board.snapshot().cards.find(card => card.id === first)
  records.set(running.runId, { status: 'completed' })
  await dispatcher.reconcile(true)
  assert.equal(board.snapshot().cards.find(card => card.id === first).status, 'review')
  await board.continue(first, 'Please expand the evidence')
  await dispatcher.stop(next)
  await dispatcher.reconcile(true)
  assert.deepEqual(dispatched, [
    [first, 'thread-1', undefined, 'snapshot-first'],
    [next, 'thread-2', undefined, 'snapshot-next'],
    [first, 'thread-1', 'Please expand the evidence', 'snapshot-first'],
  ])
  const resumed = board.snapshot().cards.find(card => card.id === first)
  records.set(resumed.runId, { status: 'completed' })
  await dispatcher.reconcile(true)
  await board.complete(first)
  assert.equal(board.snapshot().cards.find(card => card.id === first).status, 'done')
})

test('an interrupted claim with no persisted execution requires a user decision', async () => {
  const { createBoardDispatcher } = await import('../src/features/task-board/task-board-dispatch.ts')
  const saved = { cards: [{ id: 'card', title: 'Claim', description: '', status: 'running', runId: 'lost', authorization: { snapshotId: 'snapshot', documentIds: [] } }] }
  const board = createTaskBoard({ read: async () => saved, write: async () => {} })
  await board.initialize()
  const dispatcher = createBoardDispatcher(board, {
    find: () => undefined,
    createThread: async () => assert.fail('uncertain claims should not start another thread'),
    start: async () => assert.fail('uncertain claims should not dispatch again'),
    delivery: async () => assert.fail('there is no delivery'),
    stop: async () => {},
  })
  await dispatcher.reconcile(true)
  assert.equal(board.snapshot().cards[0].status, 'stopped')
})
