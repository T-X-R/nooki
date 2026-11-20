import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CapabilityManifest } from '../packages/capability-contract/src/index.ts'
import { createPreviewHost } from '../skills/workbench-capability-dev/assets/starter/preview/host.ts'

const manifest: CapabilityManifest = {
  id: 'org.example.preview', version: '1.0.0', name: 'Preview',
  minPlatformVersion: '0.3.2', entrypoints: ['page'], permissions: ['storage'],
}

test('preview storage starts empty, isolates instances and copies JSON values', async () => {
  const { host } = createPreviewHost(manifest)
  const other = createPreviewHost(manifest).host
  assert.equal(await host.storage.get('note'), null)
  const input = { text: 'synthetic' }
  await host.storage.set('note', input)
  input.text = 'changed'
  const saved = await host.storage.get<typeof input>('note')
  assert.deepEqual(saved, { text: 'synthetic' })
  saved!.text = 'mutated'
  assert.deepEqual(await host.storage.get('note'), { text: 'synthetic' })
  assert.equal(await other.storage.get('note'), null)
  await host.storage.remove('note')
  assert.equal(await host.storage.get('note'), null)
  const denied = createPreviewHost({ ...manifest, permissions: [] }).host
  await assert.rejects(denied.storage.get('note'), /storage permission/)
  await assert.rejects(denied.storage.set('note', 'text'), /storage permission/)
  await assert.rejects(denied.storage.remove('note'), /storage permission/)
})

test('preview environment snapshots are stable and subscriptions can be released', () => {
  const preview = createPreviewHost(manifest)
  const environment = preview.host.environment
  const initial = environment.getSnapshot()
  assert.deepEqual(initial, { language: 'zh', locale: 'zh-CN', theme: 'light' })
  assert.equal(initial, environment.getSnapshot())
  assert.ok(Object.isFrozen(initial))
  let updates = 0
  const unsubscribe = environment.subscribe(() => { updates++ })
  preview.setEnvironment({ language: 'en', locale: 'en-US', theme: 'dark' })
  assert.equal(environment.getSnapshot().language, 'en')
  assert.equal(updates, 1)
  unsubscribe()
  preview.setEnvironment(initial)
  assert.equal(updates, 1)
})

test('desktop-only preview operations fail instead of reporting empty or successful results', async () => {
  const { host } = createPreviewHost(manifest)
  for (const [name, operation] of [
    ['ai.invoke', () => host.ai.invoke('synthetic')],
    ['codex.sessions.readTodayFiles', () => host.codex.sessions.readTodayFiles()],
    ['documents.listGrants', () => host.documents.listGrants()],
    ['documents.readSelected', () => host.documents.readSelected('grant', 'doc')],
    ['documents.publish', () => host.documents.publish({ key: 'test', title: 'Test', collectionKey: 'test', collectionName: 'Test', documentDate: '2026-11-20', content: 'Synthetic' })],
    ['activity.write', () => host.activity.write({ type: 'test', title: 'Test' })],
    ['tasks.start', () => host.tasks.start('test', {})],
    ['tasks.cancel', () => host.tasks.cancel('test')],
    ['tasks.retry', () => host.tasks.retry('test')],
  ] as const) {
    await assert.rejects(operation(), (error: Error) => error.message.includes(name) && error.message.includes('desktop Nooki'))
  }
  await assert.rejects(host.board.create({ title: 'Preview' }, { idempotencyKey: 'preview' }), { code: 'UNSUPPORTED_SERVICE' })
  assert.throws(() => host.documents.open({ kind: 'library-document', documentId: 'test', title: 'Test' }), /documents.open.*desktop Nooki/)
  assert.throws(() => host.tasks.getSnapshot(), /tasks.getSnapshot.*desktop Nooki/)
  assert.throws(() => host.tasks.subscribe(() => {}), /tasks.subscribe.*desktop Nooki/)
})
