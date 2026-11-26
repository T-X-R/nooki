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

test('handoff turns expose retained snapshots and only their additional selected documents', () => {
  const handoffId='a'.repeat(64)
  const offered=task({ input:{threadId:'thread-1',message:'Review',documentIds:['extra'],snapshotId:'snapshot-1',handoffId},
    checkpoints:{sources:[
      {reference:{kind:'library-document',documentId:'original',title:'Retained',snapshotId:'snapshot-1',handoffId},content:'Retained original'},
      {reference:{kind:'library-document',documentId:'extra',title:'Extra',snapshotId:'snapshot-1'},content:'Additional user selection'},
    ]} })
  assert.deepEqual(currentConversationSources([offered],context).map(source=>source.content),['Retained original','Additional user selection'])
  for(const patch of [{handoffId:'b'.repeat(64)},{documentIds:[]},{snapshotId:'another'}]) {
    assert.throws(()=>currentConversationSources([{...offered,input:{...(offered.input as object),...patch}}],context))
  }
  const corrupt=structuredClone(offered);(corrupt.checkpoints.sources as any[])[1].reference.handoffId='b'.repeat(64)
  assert.throws(()=>currentConversationSources([corrupt],context))
})
