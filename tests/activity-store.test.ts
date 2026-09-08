import test from 'node:test'
import assert from 'node:assert/strict'
import { activityStorageKey, createActivityStore, todayFeed } from '../src/activity-store.ts'
import type { TaskRecord } from '../packages/capability-contract/src/index.ts'

test('legacy activity survives restart and stable business keys update without duplicate rows', () => {
  const values = new Map([[activityStorageKey, JSON.stringify([{ id: 'old', title: 'Old diary', type: 'diary.entry.saved', source: 'diary', occurredAt: '2026-09-01' }])]])
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const first = createActivityStore(storage)
  first.load()
  first.write('diary', { key: 'entry-1', type: 'saved', title: 'First title' })
  first.write('diary', { key: 'entry-1', type: 'saved', title: 'Updated title' })
  first.write('other', { key: 'entry-1', type: 'saved', title: 'Other capability' })
  const restarted = createActivityStore(storage); restarted.load()
  assert.equal(restarted.getSnapshot().length, 3)
  assert.equal(restarted.getSnapshot()[1].title, 'Updated title')
})

test('failed persistence never acknowledges an event or changes subscribers', () => {
  const store = createActivityStore({ getItem: () => null, setItem: () => { throw new Error('disk full') } })
  let emitted = false
  store.subscribe(() => { emitted = true })
  assert.throws(() => store.write('cap', { title: 'not saved', type: 'saved' }), /disk full/)
  assert.equal(emitted, false)
  assert.equal(store.getSnapshot().length, 0)
})

test('attention tasks suppress their own activity, completed tasks leave only the business fact', () => {
  const event = { id: 'event', taskId: 'task', type: 'generated', title: 'Review', source: 'cap', occurredAt: '2026-09-08' }
  for (const status of ['running', 'failed', 'interrupted'] as const) {
    const task = { id: 'task', status } as TaskRecord
    assert.deepEqual(todayFeed([event], [task]), { tasks: [task], events: [] })
  }
  assert.deepEqual(todayFeed([event], [{ id: 'task', status: 'completed' } as TaskRecord]), { tasks: [], events: [event] })
})
