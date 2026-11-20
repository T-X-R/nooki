import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskBoard } from '../src/features/task-board/task-board-store.ts'

const reference = { kind: 'library-document' as const, documentId: 'example.notes/notes/2026/11/minutes', title: 'Selected minutes', grantId: 'selected', revision: 'original' }

test('editing caller-owned source objects cannot change the saved selected reference', async () => {
  const board = createTaskBoard({ read: async () => null, write: async () => {} })
  const source = { id: reference.documentId, title: reference.title, reference: { ...reference } }
  const id = await board.add('Task', '', [source])
  source.reference.grantId = 'replacement'
  assert.equal(board.snapshot().cards.find(card => card.id === id)!.sources![0].reference!.grantId, 'selected')
})

test('native delegation sends the complete reviewed task and capture errors leave it idle', async () => {
  const card = { id: 'task', title: 'Task', description: 'Use original', status: 'todo', sources: [{ id: reference.documentId, title: reference.title, reference }] }
  let saved = { cards: [card] }, fail = true
  const requests: any[] = []
  Object.assign(globalThis, { window: { __TAURI_INTERNALS__: { invoke: async (command: string, args: any) => {
    assert.equal(command, 'task_board_command'); requests.push(structuredClone(args.request))
    if (fail) throw new Error('Snapshot unavailable')
    saved = { cards: [{ ...card, status: 'queued', authorization: { snapshotId: args.request.snapshotId, documentIds: [reference.documentId] } }] } as any
    return structuredClone(saved)
  } } } })
  const { taskBoard } = await import('../src/features/task-board/task-board.ts')
  taskBoard.replace(structuredClone(saved) as any)
  await assert.rejects(taskBoard.delegateDraft('task'), /Snapshot unavailable/)
  assert.equal(taskBoard.snapshot().cards[0].status, 'todo')
  assert.equal(taskBoard.snapshot().cards[0].authorization, undefined)
  fail = false; await taskBoard.delegateDraft('task')
  assert.equal(requests[1].op, 'delegate')
  assert.deepEqual(requests[1].expected, { title: card.title, description: card.description, sources: card.sources })
  assert.equal(taskBoard.snapshot().cards[0].status, 'queued')
  await assert.rejects(taskBoard.delegateDraft('task'), /todo/i)
  assert.equal(requests.length, 2)
})
