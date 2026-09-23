import assert from 'node:assert/strict'
import test from 'node:test'
import type { CapabilityModule, InstalledCapability } from '../packages/capability-contract/src/index.ts'
import { createCapabilityBroker } from '../src/platform/capability-broker.ts'

const commandModule: CapabilityModule = {
  manifest: {
    id: 'test.notes', version: '1.0.0', name: 'Notes', description: 'Work with notes',
    locales: { zh: { name: '笔记', description: '处理笔记' } },
    entrypoints: ['page', 'job', 'command'], permissions: [], minPlatformVersion: '0.3.0',
  },
  Page: () => null,
  jobs: { summarize: { async run() { return null } }, publish: { async run() { return null } } },
  commands: {
    summarize: {
      job: 'summarize', title: 'Summarize notes', description: 'Create a concise draft.',
      locales: { zh: { title: '总结笔记', description: '生成简洁草稿。' } },
      inputSchema: {
        type: 'object', properties: { notes: { type: 'string', minLength: 1 } },
        required: ['notes'], additionalProperties: false,
      },
      outputSchema: { type: 'object' }, effect: 'draft', confirmation: 'never',
    },
    publish: {
      job: 'publish', title: 'Publish notes', description: 'Publish the selected notes.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      effect: 'external', confirmation: 'always',
    },
  },
}

function installed(module: CapabilityModule, enabled = true): { module: CapabilityModule; installed: InstalledCapability } {
  return { module, installed: { manifest: module.manifest, enabled } }
}

function setup(options: { confirm?: boolean } = {}) {
  const executions: { capabilityId: string; job: string; input: unknown }[] = []
  const confirmations: unknown[] = []
  const broker = createCapabilityBroker({
    listCapabilities: () => [
      installed(commandModule),
      installed({ ...commandModule, manifest: { ...commandModule.manifest, id: 'test.disabled' } }, false),
      installed({ ...commandModule, manifest: { ...commandModule.manifest, id: 'test.legacy', entrypoints: ['page', 'job'] }, commands: undefined }),
    ],
    execute: async (capabilityId, job, input) => {
      executions.push({ capabilityId, job, input })
      return { taskId: 'task-1', status: 'completed', result: { summary: 'Short' } }
    },
    confirm: async (proposal) => { confirmations.push(proposal); return options.confirm ?? false },
  })
  return { broker, executions, confirmations }
}

test('searches only enabled explicitly exposed commands with localized copy', async () => {
  const { broker } = setup()
  const response = await broker.handle({ action: 'search', query: '笔记', language: 'zh' })
  assert.equal(response.ok, true)
  if (!response.ok || response.action !== 'search') return
  assert.deepEqual(response.commands.map((command) => [command.capabilityId, command.commandId, command.title]), [
    ['test.notes', 'summarize', '总结笔记'],
    ['test.notes', 'publish', 'Publish notes'],
  ])
})

test('describes exact schemas and reports unavailable commands with stable errors', async () => {
  const { broker } = setup()
  const described = await broker.handle({ action: 'describe', capabilityId: 'test.notes', commandId: 'summarize', language: 'en' })
  assert.equal(described.ok, true)
  if (described.ok && described.action === 'describe') {
    assert.equal(described.command.effect, 'draft')
    assert.deepEqual(described.command.inputSchema.required, ['notes'])
  }
  const missing = await broker.handle({ action: 'describe', capabilityId: 'test.disabled', commandId: 'summarize' })
  assert.deepEqual(missing, { ok: false, error: { code: 'COMMAND_NOT_AVAILABLE', message: 'Capability command is not installed, enabled, or available' } })
})

test('validates invocation input before execution', async () => {
  const { broker, executions } = setup()
  const response = await broker.handle({
    action: 'invoke', invocationId: 'call-invalid', capabilityId: 'test.notes', commandId: 'summarize', input: { notes: '', extra: true },
  })
  assert.equal(response.ok, false)
  if (!response.ok) {
    assert.equal(response.error.code, 'INVALID_INPUT')
    assert.match(response.error.message, /notes/)
  }
  assert.equal(executions.length, 0)
})

test('requires platform-owned confirmation for side effects', async () => {
  const denied = setup({ confirm: false })
  const deniedResponse = await denied.broker.handle({
    action: 'invoke', invocationId: 'call-denied', capabilityId: 'test.notes', commandId: 'publish', input: { id: 'note-1' },
  })
  assert.equal(deniedResponse.ok, false)
  if (!deniedResponse.ok) assert.equal(deniedResponse.error.code, 'CONFIRMATION_DENIED')
  assert.equal(denied.confirmations.length, 1)
  assert.equal(denied.executions.length, 0)

  const accepted = setup({ confirm: true })
  const acceptedResponse = await accepted.broker.handle({
    action: 'invoke', invocationId: 'call-accepted', capabilityId: 'test.notes', commandId: 'publish', input: { id: 'note-1' },
  })
  assert.equal(acceptedResponse.ok, true)
  assert.equal(accepted.executions.length, 1)
})

test('publishes one agent-independent invocation lifecycle', async () => {
  const updates: string[] = []
  const broker = createCapabilityBroker({
    listCapabilities: () => [installed(commandModule)],
    execute: async (_capabilityId, _job, _input, onStarted) => {
      onStarted('task-lifecycle')
      return { taskId: 'task-lifecycle', status: 'completed', result: { summary: 'Short' } }
    },
    confirm: async () => true,
    onInvocation: (update) => updates.push(`${update.status}:${update.taskId ?? ''}`),
  })
  await broker.handle({
    action: 'invoke', invocationId: 'call-lifecycle', capabilityId: 'test.notes', commandId: 'publish', input: { id: 'note-1' },
    context: { threadId: 'thread-1', turnId: 'turn-1', agent: 'pi' },
  })
  assert.deepEqual(updates, ['proposed:', 'awaiting_confirmation:', 'running:task-lifecycle', 'completed:task-lifecycle'])
})

test('deduplicates identical invocation IDs and rejects conflicting reuse', async () => {
  const { broker, executions } = setup()
  const request = { action: 'invoke' as const, invocationId: 'call-once', capabilityId: 'test.notes', commandId: 'summarize', input: { notes: 'Hello' } }
  const [first, second] = await Promise.all([broker.handle(request), broker.handle(request)])
  assert.deepEqual(first, second)
  assert.equal(executions.length, 1)

  const conflict = await broker.handle({ ...request, input: { notes: 'Changed' } })
  assert.equal(conflict.ok, false)
  if (!conflict.ok) assert.equal(conflict.error.code, 'INVOCATION_CONFLICT')
})

test('normalizes execution failures without leaking thrown values', async () => {
  const broker = createCapabilityBroker({
    listCapabilities: () => [installed(commandModule)],
    execute: async () => { throw { secret: 'opaque failure' } },
    confirm: async () => true,
  })
  const response = await broker.handle({
    action: 'invoke', invocationId: 'call-failed', capabilityId: 'test.notes', commandId: 'summarize', input: { notes: 'Hello' },
  })
  assert.deepEqual(response, { ok: false, error: { code: 'EXECUTION_FAILED', message: 'Capability command failed' } })
})
