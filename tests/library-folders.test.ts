import test from 'node:test'
import assert from 'node:assert/strict'
import { createLibraryStore, libraryStorageKey } from '../src/platform/library-store.ts'

const publication = { key: 'first', title: 'First', content: '# Original', documentDate: '2026-10-16', collectionKey: 'documents', collectionName: 'Documents' }
function setup(saved?: unknown) {
  let value = saved ? JSON.stringify(saved) : null
  const storage = { getItem: (key: string) => key === libraryStorageKey ? value : null, setItem: (_key: string, next: string) => { value = next } }
  return { store: createLibraryStore(storage), storage }
}
test('migrates legacy topics and owned sections without duplicating or rewriting shared documents', () => {
  const { store, storage } = setup()
  const doc = store.change({ kind: 'create', document: publication })!
  const state = JSON.parse(storage.getItem(libraryStorageKey)!)
  delete state.organization.folders
  state.organization.topics = [{ id: 'one', name: 'One', documentIds: [doc.id] }, { id: 'two', name: 'Two', documentIds: [doc.id] }]
  state.organization.customSections = [{ id: 'custom-notes', name: 'Notes', topicId: 'one' }, { id: 'custom-empty', name: 'Empty' }]
  state.organization.sections = { [doc.id]: state.organization.customSections[0] }
  storage.setItem(libraryStorageKey, JSON.stringify(state))
  const folders = store.organization().folders!
  assert.equal(folders.find(f => f.id === 'topic-one')?.documentIds.length, 0)
  assert.deepEqual(folders.find(f => f.id === 'topic-two')?.documentIds, [doc.id])
  assert.deepEqual(folders.find(f => f.id === 'section-custom-notes'), { id: 'section-custom-notes', name: 'Notes', parentId: 'topic-one', documentIds: [doc.id] })
  assert.ok(folders.some(f => f.name === 'Empty'))
  assert.equal(store.read(doc.id).revision, doc.revision)
  store.change({ kind: 'save-folder', folder: { id: 'new', name: 'New', documentIds: [] } })
  assert.equal(store.organization().folders!.length, 5)
})
test('contextual creation, atomic moves, nesting and deletion preserve document revisions', () => {
  const { store } = setup()
  assert.throws(() => store.change({ kind: 'delete-folder', id: '' }), /Folder not found/)
  store.change({ kind: 'save-folder', folder: { id: 'a', name: 'A', documentIds: [] } })
  store.change({ kind: 'save-folder', folder: { id: 'b', name: 'B', parentId: 'a', documentIds: [] } })
  const doc = store.change({ kind: 'create', document: publication, folderId: 'b' })!
  assert.deepEqual(store.organization().folders!.find(f => f.id === 'b')!.documentIds, [doc.id])
  assert.throws(() => store.change({ kind: 'save-folder', folder: { id: 'a', name: 'A', parentId: 'b', documentIds: [] } }), /cycle|循环/i)
  assert.throws(() => store.change({ kind: 'save-folder', folder: { id: 'c', name: ' b ', parentId: 'a', documentIds: [] } }), /exists|存在/i)
  assert.throws(() => store.change({ kind: 'move-documents', ids: [doc.id, 'missing'], folderId: 'a' }), /not found|不存在/i)
  assert.deepEqual(store.organization().folders!.find(f => f.id === 'b')!.documentIds, [doc.id])
  store.change({ kind: 'delete-folder', id: 'b' })
  assert.deepEqual(store.organization().folders!.find(f => f.id === 'a')!.documentIds, [])
  assert.equal(store.list().length, 0)
  assert.throws(() => store.read(doc.id), /Trash/)
  store.change({ kind: 'restore', ids: [doc.id] })
  store.change({ kind: 'move-documents', ids: [doc.id] })
  assert.ok(store.organization().folders!.every(f => !f.documentIds.includes(doc.id)))
  assert.equal(store.read(doc.id).revision, doc.revision)
  assert.equal(store.history(doc.id).length, 1)
  assert.throws(() => store.change({ kind: 'create', document: { ...publication, key: 'second' }, folderId: 'gone' }), /not found|不存在/i)
  assert.equal(store.list().length, 1)
})
test('folder deletion removes the entire subtree and trashes its unique documents without lifting contents', () => {
  const { store, storage } = setup()
  for (const folder of [{ id: 'outer', name: 'Outer' }, { id: 'parent', name: 'Parent', parentId: 'outer' }, { id: 'child', name: 'Notes', parentId: 'parent' }, { id: 'empty', name: 'Empty', parentId: 'child' }, { id: 'sibling', name: 'Notes', parentId: 'outer' }]) store.change({ kind: 'save-folder', folder: { ...folder, documentIds: [] } })
  const keep = store.change({ kind: 'create', document: { ...publication, key: 'keep' }, folderId: 'sibling' })!
  const direct = store.change({ kind: 'create', document: publication, folderId: 'parent' })!
  const deep = store.change({ kind: 'create', document: { ...publication, key: 'deep' }, folderId: 'child' })!
  const old = store.change({ kind: 'create', document: { ...publication, key: 'old' }, folderId: 'child' })!
  store.change({ kind: 'origin', id: deep.id, origin: { threadId: 'thread', messageId: 'message' } })
  store.change({ kind: 'edit', id: deep.id, title: deep.title, content: 'Revised', expected: deep.revision! })
  store.change({ kind: 'trash', ids: [old.id] })
  const previousTrashDate = store.organization().trash[old.id]
  const state = JSON.parse(storage.getItem(libraryStorageKey)!)
  state.organization.folders.find((folder: { id: string }) => folder.id === 'child').documentIds.push(direct.id)
  storage.setItem(libraryStorageKey, JSON.stringify(state))
  store.change({ kind: 'delete-folder', id: 'parent' })
  assert.deepEqual(store.organization().folders!.map(folder => folder.id), ['outer', 'sibling'])
  assert.deepEqual(store.organization().folders![0].documentIds, [])
  assert.deepEqual(store.list().map(doc => doc.id), [keep.id])
  assert.equal(store.list(true).length, 3)
  assert.equal(store.organization().trash[old.id], previousTrashDate)
  assert.equal(store.history(deep.id).length, 2)
  store.change({ kind: 'restore', ids: [direct.id, deep.id] })
  assert.equal(store.read(direct.id).revision, direct.revision)
  assert.equal(store.read(deep.id).content, 'Revised')
  assert.deepEqual(store.organization().origins[deep.id], { threadId: 'thread', messageId: 'message' })
  assert.ok(store.organization().folders!.every(folder => !folder.documentIds.includes(deep.id)))
})
test('failed subtree deletion leaves folders, documents and Trash unchanged', () => {
  const { store, storage } = setup()
  store.change({ kind: 'save-folder', folder: { id: 'parent', name: 'Parent', documentIds: [] } })
  store.change({ kind: 'create', document: publication, folderId: 'parent' })
  const before = storage.getItem(libraryStorageKey)
  const failing = createLibraryStore({ getItem: storage.getItem, setItem: () => { throw new Error('Disk full') } })
  assert.throws(() => failing.change({ kind: 'delete-folder', id: 'parent' }), /Disk full/)
  assert.equal(storage.getItem(libraryStorageKey), before)
})
