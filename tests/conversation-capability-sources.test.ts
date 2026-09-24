import assert from 'node:assert/strict'
import test from 'node:test'
import type { TaskRecord } from '../packages/capability-contract/src/index.ts'
import { currentConversationSources } from '../src/platform/conversation-capability-sources.ts'

const context = { threadId: 'thread-1', turnId: 'turn-1', agent: 'claude' }
function task(patch: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1', ownerKind: 'platform', scope: 'thread-1', capabilityId: 'workbench.conversations', capabilityVersion: '1', job: 'respond',
    input: { threadId: 'thread-1', message: 'Summarize', documentIds: ['doc-1'], snapshotId: 'snapshot-1', uploads: [{ id: 'upload-1', name: 'notes.md', content: 'upload body' }] },
    status: 'running', stage: 'codex-turn', attempt: 1,
    checkpoints: { sources: [{ reference: { kind: 'library-document', documentId: 'doc-1', title: 'Daily', snapshotId: 'snapshot-1' }, content: 'snapshot body', documentDate: '2026-09-23' }] },
    result: null, error: null, createdAt: '', updatedAt: '', ...patch,
  }
}

test('resolves exact captured Library snapshot and uploads from the current turn', () => {
  const sources = currentConversationSources([task()], context)
  assert.deepEqual(sources.map(({ kind, title, content }) => [kind, title, content]), [
    ['library', 'Daily', 'snapshot body'], ['upload', 'notes.md', 'upload body'],
  ])
  assert.equal(sources[0].reference?.snapshotId, 'snapshot-1')
})

test('never borrows sources from a previous or another conversation turn', () => {
  assert.throws(() => currentConversationSources([task({ status: 'completed' })], context))
  assert.throws(() => currentConversationSources([task({ scope: 'thread-2' })], context))
  assert.throws(() => currentConversationSources([task(), task({ id: 'task-2' })], context))
  assert.throws(() => currentConversationSources([task({ checkpoints: {} })], context))
  assert.throws(() => currentConversationSources([task({ input: { threadId: 'thread-1', documentIds: ['doc-1'], snapshotId: 'snapshot-2' } })], context))
})

test('an attachment-free turn provides no sources instead of borrowing history', () => {
  const empty = task({ input: { threadId: 'thread-1', message: 'Use my notes', documentIds: [], snapshotId: 'snapshot-2', uploads: [] },
    checkpoints: { sources: [] } })
  assert.deepEqual(currentConversationSources([task({ status: 'completed' }), empty], context), [])
})
