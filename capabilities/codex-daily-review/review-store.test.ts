import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityTaskContext, TaskRecord } from '../../packages/capability-contract/src/index.ts'
import { createTaskRunner } from '../../src/task-runner.ts'
import { dailyReviewJob, dailyReviewSnapshot } from './review-store.ts'

function fixture(empty = false) {
  const calls = { read: 0, ai: 0, documents: 0 }
  let failPublication = false
  let saved: TaskRecord[] = []
  const host: CapabilityTaskContext['host'] = {
    environment: { getSnapshot: () => ({ language: 'zh', locale: 'zh-CN', theme: 'light' }), subscribe: () => () => {} },
    ai: { invoke: async () => { calls.ai++; return { output: 'report', provider: 'fake', model: 'fake' } } },
    codex: { sessions: { readTodayFiles: async () => {
      calls.read++
      return { date: '2026-09-08', files: empty ? [] : [{ name: 'root.jsonl', archived: false, content: [
        { type: 'session_meta', payload: { id: 'root', cwd: '/work/project', source: 'cli' } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix navigation' }] } },
        { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'Completed' } },
      ].map((event) => JSON.stringify(event)).join('\n') }] }
    } } },
    storage: { get: async () => null, set: async () => {}, remove: async () => {} },
    documents: { listGrants: async () => [], readSelected: async () => { throw new Error('not granted') }, open: () => {}, publish: async () => { calls.documents++; if (failPublication) throw new Error('publication failed') } },
    activity: { write: async () => {} },
  }
  const runner = createTaskRunner({
    read: async () => saved, write: async (records) => { saved = structuredClone([...records]) },
    resolve: () => ({ manifest: { id: 'test.review', version: '0.3.0', name: 'Review', entrypoints: ['page', 'job'], permissions: [], minPlatformVersion: '0.2.0' }, definition: dailyReviewJob }),
    host: () => host, cancelInvocation: async () => {},
  })
  return { runner, calls, failPublication: (fail: boolean) => { failPublication = fail } }
}

test('daily review uses platform checkpoints and retries publication without rescanning or regenerating', async () => {
  const { runner, calls, failPublication } = fixture()
  failPublication(true)
  const id = await runner.start('test.review', 'daily-review', { date: '2026-09-08', language: 'zh' })
  await runner.settled(id)
  assert.equal(runner.getSnapshot()[0].status, 'failed')
  assert.equal(dailyReviewSnapshot(runner.getSnapshot()[0], null).summary?.output, 'report')
  failPublication(false)
  await runner.retry(id)
  await runner.settled(id)
  assert.deepEqual(calls, { read: 1, ai: 1, documents: 2 })
  assert.equal(dailyReviewSnapshot(runner.getSnapshot()[0], null).phase, 'ready')
})

test('empty source completes without invoking AI or publishing', async () => {
  const { runner, calls } = fixture(true)
  const id = await runner.start('test.review', 'daily-review', { date: '2026-09-08', language: 'zh' })
  await runner.settled(id)
  assert.equal(dailyReviewSnapshot(runner.getSnapshot()[0], null).phase, 'empty')
  assert.deepEqual(calls, { read: 1, ai: 0, documents: 0 })
})

test('an interrupted old-date scan cannot silently summarize a new day', async () => {
  const { runner, calls } = fixture()
  const id = await runner.start('test.review', 'daily-review', { date: '2026-09-07', language: 'zh' })
  await runner.settled(id)
  assert.equal(runner.getSnapshot()[0].status, 'failed')
  assert.equal(calls.ai, 0)
})
