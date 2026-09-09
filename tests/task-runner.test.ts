import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskRunner, type TaskJob } from '../src/task-runner.ts'
import type { TaskRecord } from '../packages/capability-contract/src/index.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function fixture(definition: TaskJob, initial: TaskRecord[] = []) {
  let saved = initial
  let enabled = true
  let version = '0.1.0'
  const cancelled: string[] = []
  const runner = createTaskRunner({
    read: async () => structuredClone(saved),
    write: async (records) => { saved = structuredClone([...records]) },
    resolve: () => {
      if (!enabled) throw new Error('Disabled')
      return { version, definition }
    },
    cancelInvocation: async (id) => { cancelled.push(id) },
  })
  return { runner, saved: () => saved, cancelled, disable: () => { enabled = false }, upgrade: () => { version = '0.2.0' } }
}

test('tasks continue without subscribers and retry only the failed publication step', async () => {
  let generated = 0
  let published = 0
  const { runner } = fixture({ run: async (_, { step }) => {
    const summary = await step('generate', async () => { generated++; return 'report' })
    await step('publish', async () => { if (++published === 1) throw new Error('disk full'); return null })
    return summary
  } })
  const id = await runner.start('test.job', 'review', {})
  await runner.settled(id)
  assert.equal(runner.getSnapshot()[0].status, 'failed')
  await runner.retry(id)
  await runner.settled(id)
  assert.equal(runner.getSnapshot()[0].result, 'report')
  assert.equal(generated, 1)
  assert.equal(published, 2)
})

test('cancellation reaches native execution and late results cannot publish or complete', async () => {
  const pending = deferred<string>()
  const entered = deferred<void>()
  let published = false
  const { runner, cancelled } = fixture({ run: async (_, { step }) => {
    await step('generate', async () => { entered.resolve(); return pending.promise })
    await step('publish', async () => { published = true })
  } })
  const id = await runner.start('test.job', 'review', {})
  await entered.promise
  await runner.cancel(id)
  pending.resolve('late')
  await runner.settled(id)
  assert.deepEqual(cancelled, [`${id}:1`])
  assert.equal(published, false)
  assert.equal(runner.getSnapshot()[0].status, 'cancelled')
  assert.deepEqual(runner.getSnapshot()[0].checkpoints, {})
})

test('restart marks a running task interrupted without executing any business code', async () => {
  const pending = deferred<void>()
  const first = fixture({ run: async () => pending.promise })
  const id = await first.runner.start('test.job', 'review', {})
  let calls = 0
  const second = fixture({ run: async () => { calls++ } }, first.saved())
  await second.runner.initialize()
  assert.equal(second.runner.getSnapshot()[0].status, 'interrupted')
  assert.equal(calls, 0)
  await first.runner.cancel(id)
  pending.resolve()
})

test('concurrent starts cannot duplicate a running job and lifecycle changes stop it', async () => {
  const pending = deferred<void>()
  const { runner, disable } = fixture({ run: async () => pending.promise })
  const starts = await Promise.allSettled([runner.start('test.job', 'review', {}), runner.start('test.job', 'review', {})])
  assert.equal(starts.filter((item) => item.status === 'fulfilled').length, 1)
  await runner.withCapabilityStopped('test.job', async () => {
    await assert.rejects(runner.start('test.job', 'review', {}))
    disable()
  })
  assert.equal(runner.getSnapshot()[0].status, 'cancelled')
  await assert.rejects(runner.retry(runner.getSnapshot()[0].id), /Disabled/)
  pending.resolve()
})

test('a task checkpoint cannot be replayed with a different package version', async () => {
  const { runner, upgrade } = fixture({ run: async () => { throw new Error('retry me') } })
  const id = await runner.start('test.job', 'review', {})
  await runner.settled(id)
  upgrade()
  await assert.rejects(runner.retry(id), /different capability version/)
})

test('a failure to persist the initial task prevents all execution', async () => {
  let called = false
  const runner = createTaskRunner({
    read: async () => [], write: async () => { throw new Error('disk full') },
    resolve: () => { called = true; throw new Error('must not execute') },
    cancelInvocation: async () => {},
  })
  await assert.rejects(runner.start('test.job', 'review', {}), /disk full/)
  assert.equal(called, false)
})

test('data maintenance blocks task starts and refuses to replace data while work is running', async () => {
  const gate = deferred<void>()
  const { runner } = fixture({ run: async () => gate.promise })
  const id = await runner.start('com.personal.notes', 'job', {})
  await assert.rejects(runner.withMaintenance(async () => {}), /Stop running tasks/)
  await runner.cancel(id); gate.resolve(); await runner.settled(id)
  await runner.withMaintenance(async () => { await assert.rejects(runner.start('com.personal.notes', 'job', {}), /maintenance/) })
  const next = await runner.start('com.personal.notes', 'job', {})
  await runner.settled(next)
  assert.equal(runner.getSnapshot().find((r) => r.id === next)?.status, 'completed')
})
