import assert from 'node:assert/strict'
import test from 'node:test'
import type { LibraryDocumentMetadata } from '../src/document-library.ts'
import { buildLibraryTree, filterLibraryTree, visibleLibrarySelection } from '../src/library-tree.ts'

function document(
  id: string,
  capabilityId: string,
  capabilityName: string,
  collectionKey: string,
  collectionName: string,
  documentDate: string,
  title: string,
): LibraryDocumentMetadata {
  return {
    id,
    capabilityId,
    capabilityName,
    collectionKey,
    collectionName,
    key: documentDate,
    title,
    documentDate,
    format: 'markdown',
    sizeBytes: 100,
    createdAt: `${documentDate}T12:00:00+08:00`,
    updatedAt: `${documentDate}T12:00:00+08:00`,
  }
}

test('groups documents by capability, collection and month without cross-capability collisions', () => {
  const documents = [
    document('first/daily/2026/09/a', 'first', 'First', 'daily', 'Daily', '2026-09-04', 'September'),
    document('first/daily/2026/08/a', 'first', 'First', 'daily', 'Daily', '2026-08-31', 'August'),
    document('other/daily/2026/09/a', 'other', 'Other snapshot', 'daily', 'Daily', '2026-09-04', 'Other'),
  ]
  const installedNames = new Map([['first', 'First installed']])

  const tree = buildLibraryTree(documents, installedNames)

  assert.equal(tree.length, 2)
  assert.deepEqual(tree[0], {
    capabilityId: 'first',
    capabilityName: 'First installed',
    installed: true,
    documentCount: 2,
    collections: [{
      key: 'daily',
      name: 'Daily',
      documentCount: 2,
      months: [
        { key: '2026-09', documents: [documents[0]] },
        { key: '2026-08', documents: [documents[1]] },
      ],
    }],
  })
  assert.equal(tree[1].capabilityId, 'other')
  assert.equal(tree[1].installed, false)
  assert.equal(tree[1].documentCount, 1)
})

test('filters titles, source capabilities, collections and dates without crossing tree branches', () => {
  const documents = [
    document('diary/diary/2026/09/1', 'diary', '日记', 'diary', '日记', '2026-09-04', '资料库改造'),
    document('diary/diary/2026/08/2', 'diary', '日记', 'diary', '日记', '2026-08-31', '八月记录'),
    document('review/daily/2026/09/3', 'review', 'Codex 总结', 'daily', '每日回顾', '2026-09-04', '资料库改造'),
  ]
  const tree = buildLibraryTree(documents, new Map())

  const titleMatch = filterLibraryTree(tree, '八月')
  assert.equal(titleMatch.length, 1)
  assert.equal(titleMatch[0].capabilityId, 'diary')
  assert.deepEqual(titleMatch[0].collections[0].months[0].documents.map((item) => item.id), [documents[1].id])

  const sourceMatch = filterLibraryTree(tree, 'Codex')
  assert.equal(sourceMatch.length, 1)
  assert.equal(sourceMatch[0].capabilityId, 'review')
  assert.equal(sourceMatch[0].documentCount, 1)

  const collectionMatch = filterLibraryTree(tree, '每日回顾')
  assert.equal(collectionMatch.length, 1)
  assert.equal(collectionMatch[0].capabilityId, 'review')

  const dateMatch = filterLibraryTree(tree, '2026-09-04')
  assert.deepEqual(dateMatch.map((item) => item.capabilityId), ['review', 'diary'])
  assert.deepEqual(dateMatch.map((item) => item.documentCount), [1, 1])
})

test('body search adds matching documents while retaining metadata matches', () => {
  const docs = [document('com.personal.diary/diary/2026/09/day-1', 'com.personal.diary', 'Diary', 'diary', 'Journal', '2026-09-08', 'Body only')]
  const tree = buildLibraryTree(docs, new Map())
  assert.equal(filterLibraryTree(tree, 'needle').length, 0)
  assert.equal(filterLibraryTree(tree, 'needle', new Set([docs[0].id]))[0].documentCount, 1)
})

test('empty topic and unmatched search clear the reader selection', () => {
  const doc = document('default/document', 'imports', 'Imports', 'notes', 'Notes', '2026-09-09', 'Default document')
  const ids = (tree: ReturnType<typeof buildLibraryTree>) => tree.flatMap((cap) => cap.collections.flatMap((collection) => collection.months.flatMap((month) => month.documents.map((item) => item.id))))
  assert.equal(visibleLibrarySelection(ids(buildLibraryTree([], new Map())), doc.id), null)
  assert.equal(visibleLibrarySelection(ids(filterLibraryTree(buildLibraryTree([doc], new Map()), 'unmatched')), doc.id), null)
})

test('switching views or deleting the open document selects only a visible document', () => {
  assert.equal(visibleLibrarySelection(['topic/a', 'topic/b'], 'default/a'), 'topic/a')
  assert.equal(visibleLibrarySelection(['topic/a', 'topic/b'], 'topic/b'), 'topic/b')
  assert.equal(visibleLibrarySelection(['topic/a'], 'topic/b'), 'topic/a')
  assert.equal(visibleLibrarySelection([], 'topic/a'), null)
})

test('saved section controls the library tree without changing document provenance', () => {
  const doc = { ...document('workbench.conversations/answers/2026/09/a', 'workbench.conversations', '对话', 'answers', '对话成果', '2026-09-09', 'Saved answer'), section: { id: 'diary', name: '日记' } }
  const tree = buildLibraryTree([doc], new Map())
  assert.equal(tree[0].capabilityId, 'diary')
  assert.equal(tree[0].capabilityName, '日记')
  const saved = tree[0].collections[0].months[0].documents[0]
  assert.equal(saved.capabilityId, 'workbench.conversations')
  assert.equal(saved.id, doc.id)
})

test('empty custom sections remain visible and searchable without inventing document selection', () => {
  const tree = buildLibraryTree([], new Map(), [{ id: 'custom-research', name: 'Research' }])
  assert.equal(tree.length, 1)
  assert.equal(tree[0].documentCount, 0)
  assert.deepEqual(tree[0].collections, [])
  assert.equal(filterLibraryTree(tree, 'research').length, 1)
  assert.equal(filterLibraryTree(tree, 'unmatched').length, 0)
})
