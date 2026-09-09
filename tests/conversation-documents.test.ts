import test from 'node:test'
import assert from 'node:assert/strict'
import { artifactTitle, decodeAttachment, validateAttachments } from '../src/conversation-documents.ts'
import { createLibraryStore } from '../src/library-store.ts'

const bytes = (text: string) => new TextEncoder().encode(text).buffer
test('attachments preserve UTF-8 text and identity, and reject unsupported, binary or oversized inputs', () => {
  const first = decodeAttachment('方案.MD', bytes('# 方案\n\n原文'))
  const second = decodeAttachment('方案.MD', bytes('# 另一份'))
  assert.equal(first.content, '# 方案\n\n原文')
  assert.notEqual(first.id, second.id)
  assert.equal(artifactTitle(first.name), '方案')
  assert.throws(() => decodeAttachment('../notes.md', bytes('text')))
  assert.throws(() => decodeAttachment('notes.docx', bytes('text')))
  assert.throws(() => decodeAttachment('notes.txt', new Uint8Array([255]).buffer))
  assert.throws(() => decodeAttachment('notes.txt', bytes('one\0two')))
  assert.throws(() => decodeAttachment('notes.txt', new ArrayBuffer(2_000_001)))
  assert.throws(() => validateAttachments([first], 50))
  assert.throws(() => validateAttachments(Array.from({ length: 5 }, () => ({ ...first, content: 'x'.repeat(2_000_000) })), 0))
})

test('saving a document draft retains original history and refuses a stale confirmed revision', () => {
  const records = new Map<string, string>()
  const library = createLibraryStore({ getItem: (key) => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value) } })
  const original = library.publish('workbench.imports', 'Imports', { key: 'notes', collectionKey: 'imports', collectionName: 'Imports', documentDate: '2026-09-09', title: 'Original', content: 'Original content' })
  const draft = decodeAttachment('notes.md', bytes('Revised content'))
  assert.equal(library.read(original.id).content, 'Original content')
  library.change({ kind: 'edit', id: original.id, title: original.title, content: draft.content, expected: original.revision! })
  assert.equal(library.history(original.id)[1].content, 'Original content')
  assert.throws(() => library.change({ kind: 'edit', id: original.id, title: original.title, content: 'Stale draft', expected: original.revision! }), /Document changed/)
  assert.equal(library.read(original.id).content, 'Revised content')
})
