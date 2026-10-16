import test from 'node:test'
import assert from 'node:assert/strict'
import { createLibraryStore, libraryStorageKey } from '../src/platform/library-store.ts'

const values = new Map<string, string>()
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
Object.defineProperty(globalThis, 'window', { value: { localStorage: storage, dispatchEvent: () => true }, configurable: true })
const { saveAnswer } = await import('../src/features/conversation/conversation-jobs.ts')
const input = { messageId: 'answer-one', title: 'Saved answer', content: 'Answer content', date: '2026-10-16', language: 'en' }
const context = { signal: new AbortController().signal, executionId: 'run:attempt', step: async (_name: string, run: () => Promise<unknown>) => run() }

test('conversation saving files directly into a folder and rejects stale destinations before publishing', async () => {
  values.clear()
  const store = createLibraryStore(storage)
  store.change({ kind: 'save-folder', folder: { id: 'notes', name: 'Notes', documentIds: [] } })
  await saveAnswer.run({ ...input, destination: { folderId: 'notes' } }, context)
  const doc = store.list()[0]
  assert.deepEqual(store.organization().folders![0].documentIds, [doc.id])
  const before = storage.getItem(libraryStorageKey)
  await assert.rejects(saveAnswer.run({ ...input, messageId: 'new-answer', destination: { folderId: 'deleted' } }, context), /Folder not found/)
  assert.equal(storage.getItem(libraryStorageKey), before)
})
test('queued topic/section saves resolve their migrated folder and never recreate a deleted folder', async () => {
  values.clear()
  storage.setItem(libraryStorageKey, JSON.stringify({ documents: [], history: {}, organization: { topics: [{ id: 'project', name: 'Project', documentIds: [] }], customSections: [{ id: 'custom-notes', name: 'Notes', topicId: 'project' }], trash: {}, origins: {} } }))
  const destination = { topicId: 'project', section: { id: 'custom-notes', name: 'Notes' } }
  await saveAnswer.run({ ...input, destination }, context)
  const store = createLibraryStore(storage)
  assert.deepEqual(store.organization().folders!.find(folder => folder.id === 'section-custom-notes')!.documentIds, [store.list()[0].id])
  store.change({ kind: 'delete-folder', id: 'section-custom-notes' })
  const before = storage.getItem(libraryStorageKey)
  await assert.rejects(saveAnswer.run({ ...input, messageId: 'new-answer', destination }, context), /Folder not found/)
  assert.equal(storage.getItem(libraryStorageKey), before)
})

test('permanent deletion also removes a retained inline draft for the deleted document', async () => {
  values.clear()
  const { changeLibrary } = await import('../src/platform/document-library.ts')
  const { createLibraryDrafts } = await import('../src/platform/library-drafts.ts')
  const store = createLibraryStore(storage)
  await saveAnswer.run(input, context)
  const document = store.list()[0]
  const drafts = createLibraryDrafts(storage)
  drafts.save(document.id, { title: document.title, content: 'Unsaved text', revision: document.revision! })
  await changeLibrary({ kind: 'delete-documents', ids: [document.id] })
  assert.equal(drafts.get(document), null)
  assert.equal(store.list().length, 0)
})
