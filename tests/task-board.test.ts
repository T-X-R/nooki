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
