import test from 'node:test'
import assert from 'node:assert/strict'
import type { TaskRecord } from '../packages/capability-contract/src/index.ts'
import { groupTasks } from '../src/task-groups.ts'
import { CONVERSATION_OWNER } from '../src/conversation-model.ts'

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return { id, ownerKind: 'platform', capabilityId: CONVERSATION_OWNER, capabilityVersion: '1', job: 'respond', input: { threadId: 'one', message: 'First question' }, status: 'completed', stage: null, attempt: 1, checkpoints: {}, result: null, error: null, createdAt: '2026-09-08T01:00:00Z', updatedAt: '2026-09-08T01:00:00Z', ...overrides }
}

test('groups reply and publication executions by conversation without changing task records', () => {
  const reply = task('reply')
  const save = task('save', { job: 'save-answer', input: { threadId: 'one', title: 'Saved answer' }, status: 'failed', updatedAt: '2026-09-08T02:00:00Z' })
  const group = groupTasks([reply, save])[0]
  assert.equal(group.kind, 'conversation')
  if (group.kind !== 'conversation') return
  assert.deepEqual(group.records, [save, reply])
  assert.equal(group.records[0], save)
  assert.equal(group.attention, 1)
  assert.equal(group.fallbackTitle, 'First question')
  assert.equal(group.updatedAt, save.updatedAt)
})

test('keeps distinct sessions, capability tasks, and historical records without session IDs separate', () => {
  const groups = groupTasks([
    task('a'), task('b', { input: { threadId: 'two' } }),
    task('legacy', { input: null }), task('empty', { input: { threadId: '' } }),
    task('capability', { ownerKind: undefined }), task('other-platform', { capabilityId: 'other' }),
  ])
  assert.equal(groups.length, 6)
  assert.equal(groups.filter((group) => group.kind === 'task').length, 4)
})

test('orders by latest update including retries and retains outstanding failures beside running executions', () => {
  const earlier = task('failed', { status: 'failed' })
  const latest = task('running', { status: 'running', updatedAt: '2026-09-08T03:00:00Z' })
  const other = task('other', { input: { threadId: 'two' }, updatedAt: '2026-09-08T02:00:00Z' })
  const group = groupTasks([earlier, latest, other])[0]
  assert.equal(group.kind, 'conversation')
  if (group.kind !== 'conversation') return
  assert.equal(group.threadId, 'one')
  assert.equal(group.running, 1)
  assert.equal(group.attention, 1)
  const retried = groupTasks([{ ...earlier, status: 'completed', attempt: 2, updatedAt: '2026-09-08T04:00:00Z' }, latest, other])[0]
  assert.equal(retried.kind, 'conversation')
  if (retried.kind !== 'conversation') return
  assert.equal(retried.attention, 0)
  assert.equal(retried.records[0].id, earlier.id)
})

test('a cancelled execution does not leave an attention badge after a later completed response', () => {
  const group = groupTasks([task('cancelled', { status: 'cancelled' }), task('done', { updatedAt: '2026-09-08T02:00:00Z' })])[0]
  assert.equal(group.kind, 'conversation')
  if (group.kind !== 'conversation') return
  assert.equal(group.attention, 0)
  assert.equal(group.records[0].status, 'completed')
})
