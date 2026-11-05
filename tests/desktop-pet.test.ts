import assert from 'node:assert/strict'
import test from 'node:test'
import { petActivity, type PetTask } from '../src/features/desktop-pet/pet-activity.ts'

const task = (id: string, status: PetTask['status'], extra: Partial<PetTask> = {}): PetTask => ({ id, title: id, status, ...extra })

test('attention precedes blocked, review and running; archived and accepted tasks stay quiet', () => {
  const activity = petActivity({ paused: false, cards: [task('run', 'running'), task('done', 'done'), task('archived', 'question', { archived: true }), task('review', 'review'), task('blocked', 'blocked'), task('ask', 'question')] })
  assert.equal(activity.status, 'question')
  assert.deepEqual(activity.tasks.map(t => t.id), ['ask', 'blocked', 'review', 'run'])
})

test('actual requests and active turns override a previously accepted status', () => {
  assert.equal(petActivity({ cards: [task('done', 'done', { activeTurn: true })] }).status, 'running')
  assert.equal(petActivity({ cards: [task('done', 'done', { needsInput: true })] }).status, 'question')
  assert.equal(petActivity({ cards: [task('done', 'done', { goalActive: true })] }).status, 'running')
})

test('queue pause is distinct from running work and per-task pause/stop transitions', () => {
  assert.equal(petActivity({ paused: true, cards: [task('run', 'running')] }).status, 'running')
  assert.equal(petActivity({ paused: true, cards: [task('queue', 'queued')] }).status, 'queuePaused')
  for (const status of ['pausing', 'stopping', 'paused', 'stopped', 'usageLimited', 'budgetLimited'] as const) {
    assert.equal(petActivity({ cards: [task(status, status, { activeTurn: status.endsWith('ing') })] }).status, status)
  }
  assert.equal(petActivity({ cards: [task('draft', 'todo'), task('done', 'done')] }).status, 'idle')
})
