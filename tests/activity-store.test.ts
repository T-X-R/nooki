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


test('legacy diary edits coalesce by entry ID across renamed titles and new event keys after reload', () => {
  const old = { id: 'old', title: 'Original title', type: 'diary.entry.saved', source: 'com.personal.diary', payload: { entryId: 'entry-1' }, occurredAt: '2026-09-01' }
  const updated = { ...old, id: 'updated', title: 'Renamed', key: 'diary-entry-1', occurredAt: '2026-09-02' }
  const other = { ...old, id: 'other', title: 'Renamed', payload: { entryId: 'entry-2' } }
  const store = createActivityStore({ getItem: () => JSON.stringify([old, updated, other]), setItem: () => undefined }); store.load()
  assert.deepEqual(todayFeed(store.getSnapshot(), []).events, [updated, other])
  assert.equal(store.getSnapshot().length, 3, 'retains persisted history')
})

test('document identity joins different event keys and keeps only the latest visible fact', () => {
  const target = { kind: 'library-document' as const, documentId: 'cap/collection/2026/09/doc', title: 'Same title' }
  const first = { id: 'first', key: 'created', target, title: 'Same title', type: 'created', source: 'cap', occurredAt: '2026-09-01' }
  const second = { ...first, id: 'second', key: 'updated', type: 'saved', occurredAt: '2026-09-02' }
  const latest = { ...second, id: 'latest', target: undefined, taskId: 'task', occurredAt: '2026-09-03' }
  const unrelated = { ...first, id: 'other', key: undefined, target: { ...target, documentId: 'cap/collection/2026/09/other' } }
  assert.deepEqual(todayFeed([first, latest, unrelated, second], []).events, [latest, unrelated])
  assert.deepEqual(todayFeed([first, latest, unrelated, second], [{ id: 'task', status: 'running' } as TaskRecord]).events, [unrelated])
})
