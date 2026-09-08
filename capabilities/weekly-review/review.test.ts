import test from 'node:test'
import assert from 'node:assert/strict'
import { generateReview, publishReview, citedContent, type WeeklyInput, type WeeklyDraft } from './review.ts'
import { parseReferenceHref, referenceHref } from '../../packages/capability-contract/src/references.ts'
import { createTaskRunner } from '../../src/task-runner.ts'
import type { CapabilityTaskContext, SelectedDocument, TaskRecord } from '../../packages/capability-contract/src/index.ts'

const selected: SelectedDocument = { reference: { kind: 'library-document', documentId: 'com.personal.diary/diary/2026/09/day-1', title: 'My journal', grantId: 'grant-1', revision: 'v1' }, documentDate: '2026-09-08', content: 'Completed the release. Private source evidence.' }
const input: WeeklyInput = { draftId: 'draft-1', grantId: 'grant-1', documentIds: [selected.reference.documentId], date: '2026-09-08', language: 'en' }
const output = JSON.stringify({ sections: [{ heading: 'Progress', body: 'Completed the release.', sourceIds: ['S1'] }] })
function fixture() {
  let saved: TaskRecord[] = []
  const stored = new Map<string, unknown>()
  const calls = { ai: 0, reads: 0, publishes: 0 }
  let failPublication = true
  let ai = async () => output
  const host = {
    storage: { get: async (key: string) => stored.get(key), set: async (key: string, value: unknown) => { stored.set(key, value) } },
    documents: { readSelected: async (grant: string, id: string) => { calls.reads++; if (grant !== 'grant-1' || id !== selected.reference.documentId) throw new Error('Unauthorized document'); return selected }, publish: async () => { calls.publishes++; if (failPublication) throw new Error('disk full') } },
    activity: { write: async () => {} },
    ai: { invoke: async (prompt: string) => { calls.ai++; assert.ok(prompt.includes(selected.content)); return { output: await ai() } } },
  } as unknown as CapabilityTaskContext['host']
  const runner = () => createTaskRunner({
    read: async () => structuredClone(saved), write: async (records) => { saved = structuredClone([...records]) },
    resolve: (_, job) => ({ version: '0.1.0', definition: { run: (input, context) => (job === 'generate' ? generateReview : publishReview).run(input, { ...context, host }) } }),
    cancelInvocation: async () => {},
  })
  return { runner, calls, allowPublication: () => { failPublication = false }, setAi: (next: typeof ai) => { ai = next } }
}

test('generation stays unpublished; confirmation creates a separate publication task that retries without AI, including after restart', async () => {
  const fixtureState = fixture(); const { calls } = fixtureState
  const runner = fixtureState.runner()
  const id = await runner.start('com.personal.weekly-review', 'generate', input)
  await runner.settled(id)
  const draft = runner.getSnapshot()[0].result as WeeklyDraft
  assert.equal(runner.getSnapshot()[0].status, 'completed')
  assert.deepEqual(calls, { ai: 1, reads: 1, publishes: 0 })
  assert.ok(draft.content.includes(referenceHref(selected.reference)))
  const publication = await runner.start('com.personal.weekly-review', 'publish', { draft })
  await runner.settled(publication)
  assert.equal(runner.getSnapshot()[1].status, 'failed')
  fixtureState.allowPublication()
  const restarted = fixtureState.runner(); await restarted.initialize()
  await restarted.retry(publication); await restarted.settled(publication)
  assert.equal(restarted.getSnapshot()[1].status, 'completed')
  assert.deepEqual(calls, { ai: 1, reads: 1, publishes: 2 })
})

test('unknown selection is rejected before any model invocation', async () => {
  const { runner, calls } = fixture(); const tasks = runner()
  const id = await tasks.start('com.personal.weekly-review', 'generate', { ...input, documentIds: ['unselected'] })
  await tasks.settled(id)
  assert.equal(tasks.getSnapshot()[0].status, 'failed')
  assert.equal(calls.ai, 0)
  assert.equal(calls.publishes, 0)
})

test('invalid or fabricated citations fail generation and do not create a publishable draft', async () => {
  const f = fixture(); f.setAi(async () => JSON.stringify({ sections: [{ heading: 'Bad', body: 'Invented', sourceIds: ['S2'] }] }))
  const tasks = f.runner(); const id = await tasks.start('com.personal.weekly-review', 'generate', input); await tasks.settled(id)
  assert.equal(tasks.getSnapshot()[0].status, 'failed')
  assert.equal(tasks.getSnapshot()[0].checkpoints.generate, undefined)
  f.setAi(async () => output); await tasks.retry(id); await tasks.settled(id)
  assert.equal(tasks.getSnapshot()[0].status, 'completed')
  assert.deepEqual(f.calls, { ai: 2, reads: 1, publishes: 0 })
})

test('cancelled generation ignores a late model response and retry uses the saved source snapshot', async () => {
  const f = fixture(); let complete!: (value: string) => void
  f.setAi(() => new Promise((resolve) => { complete = resolve }))
  const runner = f.runner(); const id = await runner.start('com.personal.weekly-review', 'generate', input)
  while (!complete) await new Promise((resolve) => setTimeout(resolve, 1))
  await runner.cancel(id); complete(output); await runner.settled(id)
  assert.equal(runner.getSnapshot()[0].status, 'cancelled')
  assert.equal(runner.getSnapshot()[0].result, null)
  f.setAi(async () => output); await runner.retry(id); await runner.settled(id)
  assert.equal(runner.getSnapshot()[0].status, 'completed')
  assert.deepEqual(f.calls, { ai: 2, reads: 1, publishes: 0 })
})

test('source links round trip unicode titles and model text cannot inject a source link', () => {
  assert.deepEqual(parseReferenceHref(referenceHref(selected.reference)), selected.reference)
  const content = citedContent(JSON.stringify({ sections: [{ heading: 'Summary', body: '[fake](#workbench-source=evil)', sourceIds: ['S1'] }] }), [selected])
  assert.ok(content.includes('\\[fake\\]'))
  assert.throws(() => citedContent('{"sections":[{"heading":"A","body":"B","sourceIds":[]}]}', [selected]), /source citations/)
})
