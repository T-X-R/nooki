import test from 'node:test'
import assert from 'node:assert/strict'
import { applyConversationEvent, libraryContext, type Conversation } from '../src/conversation-model.ts'
import { createTaskRunner } from '../src/task-runner.ts'
import { parseReferenceHref, referenceHref } from '../packages/capability-contract/src/references.ts'

test('Codex events preserve turn/item order, stream summaries and replace deltas with authoritative completed items', () => {
  let thread: Conversation = { id: 'session-a', preview: '', updatedAt: 0, turns: [] }
  const apply = (method: string, params: any) => { thread = applyConversationEvent(thread, { method, params: { threadId: thread.id, turnId: 't1', ...params } }) }
  apply('turn/started', { turn: { id: 't1', status: 'inProgress', items: [] } })
  apply('item/started', { item: { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'Hello' }] } })
  apply('item/reasoning/summaryTextDelta', { itemId: 'r1', summaryIndex: 0, delta: 'Checking ' })
  apply('item/reasoning/summaryTextDelta', { itemId: 'r1', summaryIndex: 0, delta: 'sources' })
  apply('item/agentMessage/delta', { itemId: 'a1', delta: 'partial' })
  apply('item/completed', { item: { id: 'a1', type: 'agentMessage', text: 'Final answer', phase: 'final_answer' } })
  apply('turn/completed', { turn: { id: 't1', status: 'completed', items: [] } })
  assert.deepEqual(thread.turns[0].items.map((i) => i.id), ['u1', 'r1', 'a1'])
  assert.deepEqual(thread.turns[0].items[1].summary, ['Checking sources'])
  assert.equal(thread.turns[0].items[2].text, 'Final answer')
  assert.equal(thread.turns[0].status, 'completed')
  const before = thread
  apply('item/reasoning/textDelta', { itemId: 'r1', delta: 'raw' })
  assert.equal(thread, before)
  assert.equal(applyConversationEvent(thread, { method: 'turn/started', params: { threadId: 'other', turn: { id: 't2', items: [], status: 'inProgress' } } }), thread)
})

test('document context carries exact retained references and supports ordinary conversations without documents', () => {
  const reference = { kind: 'library-document' as const, documentId: 'test.diary/entries/2026/09/id', title: '本周 & [原文]', snapshotId: 'snapshot-1', revision: 'r1' }
  const context = libraryContext([{ reference, content: 'Evidence', documentDate: '2026-09-08' }])
  assert.ok(context.includes('Evidence'))
  assert.deepEqual(parseReferenceHref(referenceHref(reference)), reference)
  assert.match(libraryContext([]), /No new Library documents/)
})

test('platform tasks share the existing runner, isolate concurrent sessions and keep publication retry independent', async () => {
  let unblock!: () => void
  const blocked = new Promise<void>((resolve) => { unblock = resolve })
  let saves = 0
  const runner = createTaskRunner({ read: async () => [], write: async () => {}, cancelInvocation: async () => {}, resolve: (_, job) => ({ ownerKind: 'platform', version: '1', scope: (value) => (value as { threadId: string }).threadId, definition: { run: async (_, { step }) => job === 'respond' ? step('codex-turn', () => blocked) : step('publish', async () => { if (++saves === 1) throw new Error('disk full'); return 'saved' }) } }) })
  const a = await runner.start('workbench.conversations', 'respond', { threadId: 'a' })
  const b = await runner.start('workbench.conversations', 'respond', { threadId: 'b' })
  await assert.rejects(runner.start('workbench.conversations', 'respond', { threadId: 'a' }), /already running/)
  await runner.cancel(a)
  unblock(); await runner.settled(b)
  assert.equal(runner.getSnapshot().find((t) => t.id === a)?.status, 'cancelled')
  assert.equal(runner.getSnapshot().find((t) => t.id === b)?.status, 'completed')
  const save = await runner.start('workbench.conversations', 'save-answer', { threadId: 'b' })
  await runner.settled(save); await runner.retry(save); await runner.settled(save)
  assert.equal(saves, 2)
  assert.equal(runner.getSnapshot().find((t) => t.id === save)?.result, 'saved')
})
