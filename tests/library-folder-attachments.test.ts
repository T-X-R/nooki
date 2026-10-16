import assert from 'node:assert/strict'
import test from 'node:test'
import { captureFolderAttachment, attachmentDocumentIds, folderAttachmentContext } from '../src/features/conversation/library-folder-attachments.ts'
import type { LibraryDocumentMetadata } from '../src/platform/library-store.ts'

test('folder attachments preserve the entire hierarchy, empty folders and shared document references', () => {
  const folders = [{ id: 'root', name: 'Project', documentIds: ['one'] }, { id: 'nested', name: 'Notes', parentId: 'root', documentIds: ['one', 'two', 'trashed'] }, { id: 'empty', name: 'Empty', parentId: 'nested', documentIds: [] }, { id: 'other', name: 'Other', documentIds: ['three'] }]
  const docs = ['one', 'two', 'three'].map(id => ({ id, title: id })) as LibraryDocumentMetadata[]
  const attachment = captureFolderAttachment(folders, docs, 'root')
  assert.equal(attachment.name, 'Project')
  assert.equal(attachment.folders[0].folders[0].name, 'Empty')
  assert.deepEqual(attachmentDocumentIds([attachment]), ['one', 'two'])
  assert.deepEqual(attachment.folders[0].documents.map(doc => doc.id), ['one', 'two'])
  assert.equal(attachment.folders.some(folder => folder.id === 'other'), false)
  const restored = JSON.parse(JSON.stringify(attachment))
  assert.deepEqual(restored, attachment)
  assert.ok(folderAttachmentContext([restored]).includes(JSON.stringify(attachment)))
  assert.equal(folderAttachmentContext([]), '')
  assert.throws(() => captureFolderAttachment(folders, docs, 'missing'), /Folder not found/)
  assert.throws(() => captureFolderAttachment([{ id: 'cycle', name: 'Cycle', parentId: 'cycle', documentIds: [] }], docs, 'cycle'), /invalid hierarchy/)
})

test('conversation jobs capture every folder document and retain directory identity in agent context', async () => {
  const values = new Map<string, string>()
  const requests: { command: string; args: any }[] = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, __TAURI_INTERNALS__: { invoke: async (command: string, args: any) => {
    requests.push({ command, args })
    if (command === 'library_capture_sources') return args.ids.map((id: string) => ({ reference: { kind: 'library-document', documentId: id, title: id, snapshotId: args.id }, content: `Contents of ${id}`, documentDate: '2026-10-16' }))
    if (command === 'conversation_run') return { threadId: 'thread', turnId: 'turn' }
    throw new Error(`Unexpected ${command}`)
  } } } })
  const { respond } = await import('../src/features/conversation/conversation-jobs.ts')
  const folder = { id: 'project', name: 'Project', documents: [{ id: 'one', title: 'One' }], folders: [{ id: 'empty', name: 'Empty', documents: [], folders: [] }, { id: 'notes', name: 'Notes', documents: [{ id: 'two', title: 'Two' }], folders: [] }] }
  const input = { threadId: 'thread', message: 'Review the entire folder', snapshotId: 'snapshot', documentIds: ['one', 'two'], folders: [folder] }
  const context = { executionId: 'run:attempt', signal: new AbortController().signal, step: async (_: string, run: () => Promise<unknown>) => run() }
  assert.deepEqual(await respond.run(input, context), { threadId: 'thread', turnId: 'turn' })
  assert.deepEqual(requests[0], { command: 'library_capture_sources', args: { id: 'snapshot', ids: ['one', 'two'] } })
  const request = requests.find(call => call.command === 'conversation_run')!.args.request
  assert.ok(request.context.includes(JSON.stringify(folder)))
  assert.ok(request.context.includes('snapshot'))
  assert.equal(request.snapshotId, 'snapshot')
  requests.length = 0
  await assert.rejects(respond.run({ ...input, documentIds: ['one'] }, context), /incomplete/)
  assert.equal(requests.length, 0, 'Incomplete folders are rejected before any native work or agent submission')
})
