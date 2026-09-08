import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityHost, DocumentPublication } from '../../packages/capability-contract/src/index.ts'
import { migrateDiaryEntriesToLibrary, persistDiaryEntry, type DiaryEntry } from './diary-store.ts'

function entry(id: string, date: string, title: string, content: string): DiaryEntry {
  return { id, date, title, content, updatedAt: `${date}T12:00:00+08:00` }
}

function createHost() {
  const stored = new Map<string, unknown>()
  const documents: DocumentPublication[] = []
  const host: CapabilityHost = {
    tasks: {
      getSnapshot: () => [], subscribe: () => () => {},
      start: async () => { throw new Error('Diary does not start tasks') },
      cancel: async () => {}, retry: async () => {},
    },
    environment: {
      getSnapshot: () => ({ language: 'zh', locale: 'zh-CN', theme: 'light' }),
      subscribe: () => () => undefined,
    },
    ai: { invoke: async () => ({ provider: 'test', model: 'test', output: '' }) },
    codex: { sessions: { readTodayFiles: async () => ({ date: '2026-09-04', files: [] }) } },
    storage: {
      get: async <T>(key: string) => stored.get(key) as T ?? null,
      set: async <T>(key: string, value: T) => { stored.set(key, value) },
      remove: async (key: string) => { stored.delete(key) },
    },
    documents: {
      publish: async (document) => {
        documents.push(document)
      },
    },
    activity: { write: async () => undefined },
  }
  return { host, stored, documents }
}

test('saving a diary entry publishes the same stable entry to the document library', async () => {
  const { host, documents } = createHost()
  const saved = entry('1725422400000', '2026-09-04', '今天', '完成了资料库接入。')

  await persistDiaryEntry(host, [], saved, '无题')

  assert.deepEqual(documents, [{
    key: '1725422400000',
    title: '今天',
    collectionKey: 'diary',
    collectionName: '日记',
    documentDate: '2026-09-04',
    content: '# 今天\n\n完成了资料库接入。',
  }])
})

test('existing diary entries migrate once and keep their entry ids as document keys', async () => {
  const { host, stored, documents } = createHost()
  const entries = [
    entry('1725336000000', '2026-09-03', '昨天', '旧记录'),
    entry('1725422400000', '2026-09-04', '', '没有标题'),
  ]

  await migrateDiaryEntriesToLibrary(host, entries, 'zh')
  await migrateDiaryEntriesToLibrary(host, entries, 'zh')

  assert.deepEqual(documents.map((document) => document.key), ['1725336000000', '1725422400000'])
  assert.equal(stored.get('document-library-migration-v1'), true)
})
