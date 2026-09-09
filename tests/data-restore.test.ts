import assert from 'node:assert/strict'
import test from 'node:test'
import { createDataRestore, restoreJournalKey } from '../src/data-restore.ts'
const setup = () => {
  const data = new Map([['user:notes', 'old'], ['unrelated', 'keep']])
  const storage = { get length() { return data.size }, key: (i: number) => [...data.keys()][i] ?? null, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
  return { data, storage, owned: (key: string) => key.startsWith('user:') }
}
test('failed restore rolls back local data while a lost acknowledgement preserves committed data', async () => {
  const { storage, owned, data } = setup()
  const failed = createDataRestore(storage, owned, { commit: async () => { throw new Error('write failed') }, committedId: async () => null })
  await assert.rejects(failed.restore({ 'user:notes': 'new' }), /write failed/)
  assert.equal(data.get('user:notes'), 'old'); assert.equal(data.get('unrelated'), 'keep')
  let committed: string | null = null
  const lost = createDataRestore(storage, owned, { commit: async (id) => { committed = id; throw new Error('connection lost') }, committedId: async () => committed })
  await lost.restore({ 'user:notes': 'new' })
  assert.equal(data.get('user:notes'), 'new'); assert.equal(data.has(restoreJournalKey), false)
})
test('unknown native outcome retains journal and startup reconciles it before the app opens', async () => {
  const { storage, owned, data } = setup()
  let committed: string | null = null
  const unknown = createDataRestore(storage, owned, { commit: async (id) => { committed = id; throw new Error('connection lost') }, committedId: async () => { throw new Error('offline') } })
  await assert.rejects(unknown.restore({ 'user:notes': 'new' }), /offline/)
  assert.ok(data.has(restoreJournalKey))
  await createDataRestore(storage, owned, { commit: async () => {}, committedId: async () => committed }).recover()
  assert.equal(data.get('user:notes'), 'new'); assert.equal(data.has(restoreJournalKey), false)
})
test('storage exhaustion before native commit preserves existing data', async () => {
  const { storage, owned, data } = setup()
  let invoked = false
  const failing = { ...storage, get length() { return data.size }, setItem: (k: string, v: string) => { if (v === 'new') throw new Error('quota'); storage.setItem(k, v) } }
  await assert.rejects(createDataRestore(failing, owned, { commit: async () => { invoked = true }, committedId: async () => null }).restore({ 'user:notes': 'new' }), /quota/)
  assert.equal(invoked, false); assert.equal(data.get('user:notes'), 'old')
})
