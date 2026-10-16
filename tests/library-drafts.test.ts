import test from 'node:test'
import assert from 'node:assert/strict'
import { createLibraryDrafts } from '../src/platform/library-drafts.ts'
import type { LibraryDocument } from '../src/platform/library-store.ts'
import { folderDocumentIds } from '../src/platform/library-folders.ts'

test('inline drafts survive remounts without changing the original revision used for conflict checks', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const document = { id: 'notes/one', title: 'Notes', content: 'Original', revision: 'base' } as LibraryDocument
  const drafts = createLibraryDrafts(storage)
  drafts.save(document.id, { title: 'Notes', content: '# Unsaved', revision: 'base' })
  const restored = createLibraryDrafts(storage).get({ ...document, content: 'Changed remotely', revision: 'newer' })!
  assert.equal(restored.content, '# Unsaved')
  assert.equal(restored.revision, 'base')
  assert.equal(drafts.get({ ...document, content: '# Unsaved' }), null)
  drafts.save('other', { title: 'Other', content: 'Keep', revision: 'other' })
  drafts.remove(document.id)
  assert.equal(drafts.get(document), null)
  assert.equal(drafts.get({ ...document, id: 'other' })!.content, 'Keep')
})
test('folder discussion includes descendants once and excludes missing or trashed documents', () => {
  const folders = [{ id: 'root', name: 'Root', documentIds: ['a', 'shared', 'trashed'] }, { id: 'child', parentId: 'root', name: 'Child', documentIds: ['b', 'shared'] }, { id: 'other', name: 'Other', documentIds: ['c'] }]
  assert.deepEqual(folderDocumentIds(folders, ['a', 'b', 'shared', 'c', 'shared'], 'root'), ['a', 'b', 'shared'])
  assert.deepEqual(folderDocumentIds(folders, ['a', 'b', 'shared', 'c'], 'child'), ['b', 'shared'])
  assert.deepEqual(folderDocumentIds(folders, ['a'], 'missing'), [])
})
