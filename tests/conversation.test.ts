import test from 'node:test'
import assert from 'node:assert/strict'
import { applyConversationEvent, libraryContext, isConversationProcessItem, waitingForInitialResponse, conversationDuration, type Conversation } from '../src/conversation-model.ts'
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
  const fileContext = libraryContext([{ reference, content: 'Evidence', documentDate: '2026-09-08' }], true)
  assert.ok(!fileContext.includes('Evidence'))
  assert.ok(fileContext.includes(referenceHref(reference)))
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

test('sparse completion events retain the public summary received while streaming', () => {
  let thread: Conversation = { id: 'summary-session', preview: '', updatedAt: 0, turns: [] }
  const apply = (method: string, params: any) => { thread = applyConversationEvent(thread, { method, params: { threadId: thread.id, turnId: 'turn', ...params } }) }
  apply('item/reasoning/summaryTextDelta', { itemId: 'reason', summaryIndex: 0, delta: 'Checking document sources' })
  apply('item/completed', { item: { id: 'reason', type: 'reasoning', summary: [], content: [] } })
  assert.deepEqual(thread.turns[0].items[0].summary, ['Checking document sources'])
  apply('turn/completed', { turn: { id: 'turn', status: 'completed', items: [{ id: 'reason', type: 'reasoning', summary: [] }] } })
  assert.deepEqual(thread.turns[0].items[0].summary, ['Checking document sources'])
  apply('item/completed', { item: { id: 'reason', type: 'reasoning', summary: ['Checked sources'] } })
  assert.deepEqual(thread.turns[0].items[0].summary, ['Checked sources'])
})


test('process grouping includes progress and public summaries while keeping final answers outside', () => {
  const items = [
    { id: 'user', type: 'userMessage' },
    { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Checking sources' },
    { id: 'summary', type: 'reasoning', summary: ['Public summary'] },
    { id: 'empty', type: 'reasoning', summary: ['  '] },
    { id: 'tool', type: 'commandExecution' },
    { id: 'final', type: 'agentMessage', phase: 'final_answer', text: 'Answer' },
    { id: 'legacy', type: 'agentMessage', text: 'Older answer without phase' },
  ]
  assert.deepEqual(items.filter(isConversationProcessItem).map((item) => item.id), ['progress', 'summary', 'tool'])
})


test('generation placeholder only covers the first turn before any visible process or answer', () => {
  const user = { id: 'u', type: 'userMessage' }
  const turn = { id: 't', status: 'inProgress', items: [user] }
  assert.equal(waitingForInitialResponse([]), true)
  assert.equal(waitingForInitialResponse([turn]), true)
  assert.equal(waitingForInitialResponse([{ ...turn, items: [user, { id: 'r', type: 'reasoning', summary: [] }] }]), true)
  for (const item of [
    { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Checking' },
    { id: 'summary', type: 'reasoning', summary: ['Public summary'] },
    { id: 'tool', type: 'commandExecution' },
    { id: 'answer', type: 'agentMessage', text: 'Answer' },
  ]) assert.equal(waitingForInitialResponse([{ ...turn, items: [user, item] }]), false)
  assert.equal(waitingForInitialResponse([{ ...turn, status: 'completed' }]), false)
  assert.equal(waitingForInitialResponse([{ ...turn, status: 'completed' }, { ...turn, id: 'follow-up' }]), false)
  assert.equal(waitingForInitialResponse([turn], true), false)
})


test('completed turn duration uses runtime timing and formats hours, minutes and seconds', () => {
  const turn = { id: 't', status: 'completed', items: [] }
  assert.equal(conversationDuration({ ...turn, durationMs: 999 }, true), '0秒')
  assert.equal(conversationDuration({ ...turn, durationMs: 65_999 }, true), '1分 5秒')
  assert.equal(conversationDuration({ ...turn, durationMs: 3_661_000 }, true), '1小时 1分 1秒')
  assert.equal(conversationDuration({ ...turn, durationMs: 90_000_000 }, false), '25h')
  assert.equal(conversationDuration({ ...turn, startedAt: 100, completedAt: 165 }, false), '1m 5s')
  assert.equal(conversationDuration({ ...turn, startedAt: 100, completedAt: 200, durationMs: 2_000 }, false), '2s')
  assert.equal(conversationDuration(turn, true), null)
  assert.equal(conversationDuration({ ...turn, startedAt: 200, completedAt: 100 }, true), null)
  assert.equal(conversationDuration({ ...turn, durationMs: Infinity }, true), null)
  assert.equal(conversationDuration({ ...turn, durationMs: 60_000 }, true), '1分')
  let live: Conversation = { id: 'timed', preview: '', updatedAt: 0, turns: [{ ...turn, status: 'inProgress', startedAt: 100 }] }
  live = applyConversationEvent(live, { method: 'turn/completed', params: { threadId: 'timed', turn: { ...turn, completedAt: 165 } } })
  assert.equal(conversationDuration(live.turns[0], true), '1分 5秒')
})
