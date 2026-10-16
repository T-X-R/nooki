import assert from 'node:assert/strict'
import test from 'node:test'
import { createLibraryStore, libraryStorageKey } from '../src/platform/library-store.ts'
const input = (key: string, content = 'Original evidence') => ({ key, title: key, content, documentDate: '2026-09-09', collectionKey: 'notes', collectionName: 'Notes' })
const setup = () => {
  const data = new Map<string, string>()
  return { data, store: createLibraryStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } }) }
}
test('created documents persist without a section and join the current topic', () => {
  const { store, data } = setup()
  store.change({ kind: 'save-topic', topic: { id: 'research', name: 'Research', documentIds: [] } })
  const doc = store.change({ kind: 'create', document: input('created', '# Notes\n\n直接写作。'), topicId: 'research' })!
  assert.equal(doc.capabilityId, 'workbench.documents')
  assert.equal(doc.collectionKey, 'documents')
  const reopened = createLibraryStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } })
  assert.equal(reopened.read(doc.id).content, '# Notes\n\n直接写作。')
  assert.deepEqual(reopened.organization().topics[0].documentIds, [doc.id])
  assert.equal(reopened.organization().customSections?.length ?? 0, 0)
  assert.equal(reopened.organization().sections?.[doc.id], undefined)
  reopened.change({ kind: 'edit', id: doc.id, title: 'Revised', content: 'Updated', expected: doc.revision! })
  assert.equal(reopened.history(doc.id).length, 2)
})
test('creation rejects invalid content and stale topics without leaving documents', () => {
  const { store } = setup()
  assert.throws(() => store.change({ kind: 'create', document: { ...input('empty'), title: ' ' } }), /Invalid/)
  assert.throws(() => store.change({ kind: 'create', document: input('missing'), topicId: 'deleted' }), /Topic no longer exists/)
  assert.equal(store.list().length, 0)
  const first = store.change({ kind: 'create', document: input('first') })!
  const second = store.change({ kind: 'create', document: { ...input('second'), title: first.title } })!
  assert.notEqual(first.id, second.id)
  assert.equal(store.list().length, 2)
})
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

test('custom sections persist while empty and moving documents preserves history and topics', () => {
  const { store, data } = setup()
  const section = { id: 'custom-research', name: '  Research  ' }
  store.change({ kind: 'create-section', section })
  const reopened = createLibraryStore({ getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } })
  assert.deepEqual(reopened.organization().customSections, [{ ...section, name: 'Research' }])
  assert.throws(() => store.change({ kind: 'create-section', section: { id: 'custom-duplicate', name: 'research' } }), /already exists/)
  assert.throws(() => store.change({ kind: 'create-section', section: { ...section, name: '   ' } }), /Invalid/)
  assert.throws(() => store.change({ kind: 'create-section', section: { id: 'diary', name: 'Built in' } }), /Invalid/)
  const doc = store.publish('diary', 'Diary', input('move-me'))
  store.change({ kind: 'save-topic', topic: { id: 'topic', name: 'Topic', documentIds: [doc.id] } })
  store.change({ kind: 'place', id: doc.id, section: { ...section, name: 'Research' } })
  assert.equal(store.read(doc.id).revision, doc.revision)
  assert.deepEqual(store.organization().topics[0].documentIds, [doc.id])
  store.change({ kind: 'trash', ids: [doc.id] }); store.change({ kind: 'purge', ids: [doc.id] })
  assert.equal(store.organization().customSections?.length, 1)
})

test('renaming and deleting custom sections preserve documents, topics, revisions and trash', () => {
  const { store, data } = setup()
  const section = { id: 'custom-research', name: 'Research' }
  store.change({ kind: 'create-section', section })
  const active = store.publish('diary', 'Diary', input('active'))
  const trashed = store.publish('diary', 'Diary', input('trashed'))
  for (const doc of [active, trashed]) store.change({ kind: 'place', id: doc.id, section })
  store.change({ kind: 'save-topic', topic: { id: 'topic', name: 'Topic', documentIds: [active.id] } })
  store.change({ kind: 'trash', ids: [trashed.id] })
  store.change({ kind: 'rename-section', id: section.id, name: '  Reading  ' })
  assert.equal(store.organization().customSections?.[0].name, 'Reading')
  assert.equal(store.organization().sections?.[trashed.id].name, 'Reading')
  store.change({ kind: 'place', id: active.id, section }) // A stale destination uses the current name.
  assert.equal(store.organization().sections?.[active.id].name, 'Reading')
  store.change({ kind: 'delete-section', id: section.id })
  const reopened = createLibraryStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } })
  assert.equal(reopened.organization().customSections?.length, 0)
  assert.deepEqual(reopened.organization().sections, {})
  assert.equal(reopened.read(active.id).revision, active.revision)
  assert.equal(reopened.history(active.id).length, 1)
  assert.deepEqual(reopened.organization().topics[0].documentIds, [active.id])
  assert.equal(reopened.list(true)[0].id, trashed.id)
  reopened.change({ kind: 'restore', ids: [trashed.id] })
  assert.equal(reopened.read(trashed.id).revision, trashed.revision)
  assert.throws(() => reopened.change({ kind: 'place', id: active.id, section }), /Section no longer exists/)
})

test('section changes reject invalid names, duplicates and non-custom sections without changing state', () => {
  const { store } = setup()
  const section = { id: 'custom-research', name: 'Research' }
  store.change({ kind: 'create-section', section })
  store.change({ kind: 'create-section', section: { id: 'custom-reading', name: 'Reading' } })
  const before = store.organization()
  for (const name of [' ', 'a'.repeat(81), ' reading ']) assert.throws(() => store.change({ kind: 'rename-section', id: section.id, name }))
  for (const id of ['diary', 'custom-missing']) {
    assert.throws(() => store.change({ kind: 'rename-section', id, name: 'New' }), /Section no longer exists/)
    assert.throws(() => store.change({ kind: 'delete-section', id }), /Section no longer exists/)
  }
  assert.deepEqual(store.organization(), before)
  store.change({ kind: 'rename-section', id: section.id, name: 'RESEARCH' })
  store.change({ kind: 'delete-section', id: 'custom-reading' })
  assert.deepEqual(store.organization().customSections, [{ id: section.id, name: 'RESEARCH' }])
})

test('sections persist topic ownership and validate names and placement within that scope', () => {
  const { store, data } = setup()
  for (const id of ['meta', 'test']) store.change({ kind: 'save-topic', topic: { id, name: id, documentIds: [] } })
  const meta = { id: 'custom-meta', name: '栏目1', topicId: 'meta' }
  const other = { id: 'custom-test', name: '栏目1', topicId: 'test' }
  store.change({ kind: 'create-section', section: meta })
  store.change({ kind: 'create-section', section: other })
  store.change({ kind: 'create-section', section: { id: 'custom-all', name: '栏目1' } })
  assert.throws(() => store.change({ kind: 'create-section', section: { ...meta, id: 'custom-duplicate' } }), /already exists/)
  assert.throws(() => store.change({ kind: 'create-section', section: { ...meta, id: 'custom-missing', topicId: 'deleted' } }), /Topic no longer exists/)
  store.change({ kind: 'rename-section', id: other.id, name: '栏目2' })
  store.change({ kind: 'rename-section', id: other.id, name: meta.name })
  const doc = store.publish('notes', 'Notes', input('scoped'))
  assert.throws(() => store.change({ kind: 'place', id: doc.id, topicId: 'test', section: meta }), /different topic/)
  assert.deepEqual(store.organization().topics[1].documentIds, [])
  store.change({ kind: 'place', id: doc.id, section: { id: meta.id, name: meta.name } })
  const reopened = createLibraryStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } })
  assert.equal(reopened.organization().customSections?.[0].topicId, 'meta')
  assert.deepEqual(reopened.organization().topics[0].documentIds, [doc.id])
  reopened.change({ kind: 'delete-topic', id: 'meta' })
  assert.equal(reopened.organization().customSections?.[0].topicId, undefined)
  assert.equal(reopened.read(doc.id).revision, doc.revision)
})

test('creation saves directly to the chosen section and rejects stale or cross-topic destinations before publishing', () => {
  const { store, data } = setup()
  for (const id of ['meta', 'other']) store.change({ kind: 'save-topic', topic: { id, name: id, documentIds: [] } })
  const section = { id: 'custom-direction', name: '优化方向', topicId: 'meta' }
  store.change({ kind: 'create-section', section })
  assert.throws(() => store.change({ kind: 'create', document: input('wrong-topic'), topicId: 'other', section }), /different topic/)
  assert.throws(() => store.change({ kind: 'create', document: input('missing'), topicId: 'meta', section: { id: 'custom-missing', name: 'Deleted' } }), /Section no longer exists/)
  assert.equal(store.list().length, 0)
  const created = store.change({ kind: 'create', document: input('chosen'), topicId: 'meta', section: { id: section.id, name: 'Stale name' } })!
  const reopened = createLibraryStore({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) } })
  assert.deepEqual(reopened.organization().sections?.[created.id], section)
  assert.deepEqual(reopened.organization().topics[0].documentIds, [created.id])
  assert.equal(reopened.history(created.id).length, 1)
  assert.equal(reopened.read(created.id).content, 'Original evidence')
})

test('blank documents can be created and cleared without weakening capability publication validation', () => {
  const { store } = setup()
  const doc = store.change({ kind: 'create', document: input('blank', '') })!
  assert.equal(store.read(doc.id).content, '')
  assert.equal(store.organization().folders!.length, 0)
  const written = store.change({ kind: 'edit', id: doc.id, title: doc.title, content: 'Written', expected: doc.revision! })!
  store.change({ kind: 'edit', id: doc.id, title: doc.title, content: '', expected: written.revision! })
  assert.equal(store.read(doc.id).sizeBytes, 0)
  assert.equal(store.history(doc.id).length, 3)
  assert.throws(() => store.publish('com.personal.notes', 'Notes', input('invalid', '')), /Invalid/)
})

test('history retains current plus nine previous versions and only retained versions can be restored', () => {
  const { store, data } = setup()
  let doc = store.change({ kind: 'create', document: input('bounded', 'Version 0') })!
  const first = doc.revision!
  for (let index = 1; index <= 14; index++) doc = store.change({ kind: 'edit', id: doc.id, title: doc.title, content: `Version ${index}`, expected: doc.revision! })!
  const versions = store.history(doc.id)
  assert.equal(versions.length, 10)
  assert.deepEqual(versions.map(version => version.content), Array.from({ length: 10 }, (_, index) => `Version ${14 - index}`))
  assert.equal(JSON.parse(data.get(libraryStorageKey)!).history[doc.id].length, 9)
  assert.throws(() => store.change({ kind: 'restore-version', id: doc.id, revision: first, expected: doc.revision! }), /Version not found/)
  store.change({ kind: 'restore-version', id: doc.id, revision: versions[9].revision!, expected: doc.revision! })
  assert.equal(store.read(doc.id).content, 'Version 5')
  assert.equal(store.history(doc.id).length, 10)
})
