import assert from 'node:assert/strict'
import test from 'node:test'
import { createCapabilityInvocationStore } from '../src/features/conversation/capability-invocations.ts'

function memoryStorage(initial?: string) {
  let value = initial ?? null
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
    value: () => value,
  }
}

const proposal = {
  invocationId: 'call-1',
  command: {
    capabilityId: 'test.notes', capabilityName: 'Notes', commandId: 'publish', title: 'Publish notes', description: 'Publish notes.',
    effect: 'external' as const, confirmation: 'always' as const, inputSchema: { type: 'object' },
  },
  input: { id: 'note-1' },
  context: { threadId: 'thread-1', turnId: 'turn-1', agent: 'claude' },
}

test('persists invocation lifecycle records and settles confirmation from the UI decision', async () => {
  const storage = memoryStorage()
  const store = createCapabilityInvocationStore(storage)
  const confirmation = store.requestConfirmation(proposal)
  assert.equal(store.getSnapshot()[0]?.status, 'awaiting_confirmation')
  assert.equal(store.getSnapshot()[0]?.context?.agent, 'claude')
  store.decide('call-1', true)
  assert.equal(await confirmation, true)

  store.update({ ...proposal, status: 'running', taskId: 'task-1' })
  store.update({ ...proposal, status: 'completed', taskId: 'task-1', result: { published: true } })
  assert.deepEqual(store.getSnapshot()[0]?.result, { published: true })

  const restored = createCapabilityInvocationStore(memoryStorage(storage.value() ?? undefined))
  assert.equal(restored.getSnapshot()[0]?.status, 'completed')
})

test('marks unresolved confirmations interrupted after a reload', async () => {
  const storage = memoryStorage()
  const store = createCapabilityInvocationStore(storage)
  void store.requestConfirmation(proposal)
  const restored = createCapabilityInvocationStore(memoryStorage(storage.value() ?? undefined))
  assert.equal(restored.getSnapshot()[0]?.status, 'interrupted')
  assert.match(restored.getSnapshot()[0]?.error ?? '', /closed/)
})

test('rejects decisions for records that are not awaiting confirmation', () => {
  const store = createCapabilityInvocationStore(memoryStorage())
  assert.throws(() => store.decide('missing', true), /not awaiting confirmation/)
  store.update({ ...proposal, status: 'running', taskId: 'task-1' })
  assert.throws(() => store.decide('call-1', true), /not awaiting confirmation/)
})
