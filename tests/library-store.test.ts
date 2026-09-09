import assert from 'node:assert/strict'
import test from 'node:test'
import { createLibraryStore, libraryStorageKey } from '../src/library-store.ts'
const input = (key: string, content = 'Original evidence') => ({ key, title: key, content, documentDate: '2026-09-09', collectionKey: 'notes', collectionName: 'Notes' })
const setup = () => {
  const data = new Map<string, string>()
  return { data, store: createLibraryStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }) }
}
test('imports and cross-source topics keep document identity through editing and reversible trash', () => {
  const { data, store } = setup()
  const first = store.change({ kind: 'import', document: input('first') })!
  const other = store.publish('com.personal.diary', 'Diary', input('other'))
  store.change({ kind: 'save-topic', topic: { id: 'topic', name: 'Project', documentIds: [first.id, other.id, first.id] } })
  assert.equal(store.organization().topics[0].documentIds.length, 2)
  store.change({ kind: 'edit', id: first.id, expected: first.revision!, title: 'Revised', content: 'New evidence' })
  assert.equal(store.read(first.id).content, 'New evidence')
  assert.equal(store.history(first.id)[1].content, 'Original evidence')
  assert.throws(() => store.change({ kind: 'edit', id: first.id, expected: first.revision!, title: 'Stale', content: 'Stale' }), /Document changed/)
  store.change({ kind: 'trash', ids: [first.id] })
  assert.equal(store.list().length, 1)
  assert.equal(store.list(true).length, 1)
  assert.throws(() => store.publish('workbench.imports', 'Imports', { ...input('first'), collectionKey: 'imports' }), /Trash/)
  assert.throws(() => store.read(first.id), /Trash/)
  assert.deepEqual(store.organization().topics[0].documentIds, [first.id, other.id])
  store.change({ kind: 'restore', ids: [first.id] })
  const current = store.read(first.id)
  store.change({ kind: 'restore-version', id: first.id, expected: current.revision!, revision: first.revision! })
  assert.equal(store.read(first.id).content, 'Original evidence')
  assert.equal(store.history(first.id).length, 3)
  const afterRestart = createLibraryStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } })
  assert.equal(afterRestart.read(first.id).content, 'Original evidence')
  store.change({ kind: 'delete-topic', id: 'topic' })
  assert.equal(store.list().length, 2)
})
test('permanent deletion requires trash and cleans topic associations but leaves citation snapshots alone', () => {
  const { store, data } = setup()
  const doc = store.publish('com.personal.diary', 'Diary', input('entry'))
  data.set('workbench-source-snapshot:old', JSON.stringify(doc))
  store.change({ kind: 'save-topic', topic: { id: 'project', name: 'Project', documentIds: [doc.id] } })
  assert.throws(() => store.change({ kind: 'purge', ids: [doc.id] }), /Trash/)
  store.change({ kind: 'trash', ids: [doc.id] })
  store.change({ kind: 'purge', ids: [doc.id] })
  assert.equal(store.list(true).length, 0)
  assert.equal(store.organization().topics[0].documentIds.length, 0)
  assert.equal(JSON.parse(data.get('workbench-source-snapshot:old')!).content, doc.content)
})
test('legacy data stays readable and failed persistence never acknowledges an edit', () => {
  const { data, store } = setup()
  const doc = store.publish('com.personal.diary', 'Diary', input('entry'))
  data.set('personal-workbench-document-library', JSON.stringify([doc])); data.delete(libraryStorageKey)
  assert.equal(store.read(doc.id).content, doc.content)
  const failing = createLibraryStore({ getItem: (k) => data.get(k) ?? null, setItem: () => { throw new Error('disk full') } })
  assert.throws(() => failing.change({ kind: 'edit', id: doc.id, expected: doc.revision!, title: 'Changed', content: 'Unsaved' }), /disk full/)
  assert.equal(store.read(doc.id).content, doc.content)
})

test('renaming a topic retains its documents and deleting it leaves their revisions intact', () => {
  const { store } = setup()
  const doc = store.change({ kind: 'import', document: input('topic-document') })!
  store.change({ kind: 'save-topic', topic: { id: 'topic', name: 'Before', documentIds: [doc.id] } })
  store.change({ kind: 'edit', id: doc.id, expected: doc.revision!, title: 'Revised', content: 'New content' })
  store.change({ kind: 'save-topic', topic: { ...store.organization().topics[0], name: 'After' } })
  assert.deepEqual(store.organization().topics, [{ id: 'topic', name: 'After', documentIds: [doc.id] }])
  store.change({ kind: 'delete-topic', id: 'topic' })
  assert.equal(store.organization().topics.length, 0)
  assert.equal(store.read(doc.id).title, 'Revised')
  assert.equal(store.history(doc.id).length, 2)
})

test('placing a conversation result preserves its source and existing topic members across retries', () => {
  const { store } = setup()
  const existing = store.publish('diary', 'Diary', input('diary'))
  const answer = store.publish('workbench.conversations', 'Conversations', input('answer'))
  store.change({ kind: 'save-topic', topic: { id: 'research', name: 'Research', documentIds: [existing.id] } })
  const placement = { kind: 'place' as const, id: answer.id, topicId: 'research', section: { id: 'diary', name: '日记' } }
  store.change(placement); store.change(placement)
  assert.deepEqual(store.organization().topics[0].documentIds, [existing.id, answer.id])
  assert.equal(store.organization().sections?.[answer.id].id, 'diary')
  assert.equal(store.read(answer.id).capabilityId, 'workbench.conversations')
  assert.throws(() => store.change({ ...placement, topicId: 'deleted', section: { id: 'other', name: 'Other' } }), /Topic no longer exists/)
  assert.equal(store.organization().sections?.[answer.id].id, 'diary')
  store.change({ kind: 'trash', ids: [answer.id] }); store.change({ kind: 'purge', ids: [answer.id] })
  assert.equal(store.organization().sections?.[answer.id], undefined)
})
