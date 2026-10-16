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
  assert.deepEqual(store.organization().folders!.find(f => f.id === 'a')!.documentIds, [doc.id])
  store.change({ kind: 'move-documents', ids: [doc.id] })
  assert.ok(store.organization().folders!.every(f => !f.documentIds.includes(doc.id)))
  assert.equal(store.read(doc.id).revision, doc.revision)
  assert.equal(store.history(doc.id).length, 1)
  assert.throws(() => store.change({ kind: 'create', document: { ...publication, key: 'second' }, folderId: 'gone' }), /not found|不存在/i)
  assert.equal(store.list().length, 1)
})
test('deleting a folder lifts children with unique names and preserves trashed entries and origins', () => {
  const { store } = setup()
  for (const folder of [{ id: 'parent', name: 'Parent' }, { id: 'child', name: 'Notes', parentId: 'parent' }, { id: 'sibling', name: 'Notes' }]) store.change({ kind: 'save-folder', folder: { ...folder, documentIds: [] } })
  const doc = store.change({ kind: 'create', document: publication, folderId: 'parent' })!
  store.change({ kind: 'origin', id: doc.id, origin: { threadId: 'thread', messageId: 'message' } })
  store.change({ kind: 'trash', ids: [doc.id] })
  store.change({ kind: 'delete-folder', id: 'parent' })
  assert.equal(store.organization().folders!.find(f => f.id === 'child')!.parentId, undefined)
  assert.equal(store.organization().folders!.find(f => f.id === 'child')!.name, 'Notes (2)')
  assert.equal(store.list().length, 0)
  store.change({ kind: 'restore', ids: [doc.id] })
  assert.equal(store.read(doc.id).revision, doc.revision)
  assert.deepEqual(store.organization().origins[doc.id], { threadId: 'thread', messageId: 'message' })
  assert.ok(store.organization().folders!.every(folder => !folder.documentIds.includes(doc.id)))
})
