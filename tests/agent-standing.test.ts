import assert from 'node:assert/strict'
import test from 'node:test'
import { agentNote, agentStanding, canChoose, chosenAgent, listedAgents } from '../src/features/settings/agent-standing.ts'
import type { AgentTool } from '../src/platform/agent-tools.ts'

function tool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    id: 'codex',
    name: 'Codex',
    directory: '/home/.codex/skills',
    detected: true,
    readsPool: false,
    custom: false,
    signIn: { state: 'in', method: 'ChatGPT', hint: null },
    servesCapabilities: true,
    ...overrides,
  }
}

test('a browser preview has no machine to report on', () => {
  assert.equal(agentStanding(tool(), false), 'preview')
  assert.equal(agentStanding(null, false), 'preview')
})

test('an agent that is not here is the only thing called unavailable', () => {
  assert.equal(agentStanding(tool({ detected: false }), true), 'notInstalled')
  assert.equal(agentStanding(null, true), 'notInstalled')
})

test('an agent with no login of its own is still available', () => {
  // pi is configured with an API key in its own config. There is nothing to sign into.
  const pi = tool({ id: 'pi', name: 'pi', signIn: { state: 'unknown', method: null, hint: null } })
  assert.equal(agentStanding(pi, true), 'available')
  assert.deepEqual(agentNote(pi, 'available'), { key: 'agentInstalled' })
  assert.ok(canChoose(pi))
})

test('a row says only what Nooki knows, and never the same sentence twice', () => {
  const claude = tool({ id: 'claude', name: 'Claude Code', signIn: { state: 'unknown', method: null, hint: null } })
  const pi = tool({ id: 'pi', name: 'pi', signIn: { state: 'unknown', method: null, hint: null } })
  // Identical because the state is identical; short enough that the repetition reads as a column.
  assert.deepEqual(agentNote(claude, 'available'), agentNote(pi, 'available'))
  assert.deepEqual(agentNote(tool({ detected: false }), 'notInstalled'), { key: 'agentNotInstalled' })
})

test('an agent reports its credential in its own words when it has one to report', () => {
  assert.deepEqual(agentNote(tool(), 'available'), { key: 'agentSignedInAs', values: { method: 'ChatGPT' } })
  const signedOut = tool({ signIn: { state: 'out', method: null, hint: 'codex login' } })
  assert.deepEqual(agentNote(signedOut, 'available'), { key: 'agentSignInHint', values: { hint: 'codex login' } })
})

test('a choice that stopped working is still shown as the choice', () => {
  const tools = [tool({ detected: false, servesCapabilities: false }), tool({ id: 'pi', name: 'pi' })]
  assert.equal(chosenAgent(tools, 'codex')?.id, 'codex')
  assert.equal(agentStanding(chosenAgent(tools, 'codex'), true), 'notInstalled')
  assert.equal(chosenAgent(tools, 'kimi'), null)
})

test('installed agents come first, and a skills-only registration is not listed', () => {
  const tools = [
    tool({ id: 'claude', name: 'Claude Code', detected: false, servesCapabilities: false }),
    tool(),
    tool({ id: 'zyx', name: 'zyx', custom: true, servesCapabilities: false }),
  ]
  assert.deepEqual(listedAgents(tools).map((entry) => entry.id), ['codex', 'claude'])
  assert.ok(!canChoose(tools[0]))
})
