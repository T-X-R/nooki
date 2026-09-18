import assert from 'node:assert/strict'
import test from 'node:test'
import { agentNote, agentStanding, chosenAgent, selectableAgents } from '../src/features/settings/agent-standing.ts'
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

test('an agent that is not here is missing, whatever its sign-in says', () => {
  assert.equal(agentStanding(tool({ detected: false }), true), 'missing')
  assert.equal(agentStanding(null, true), 'missing')
})

test('an agent that says it is signed out is not called ready', () => {
  const signedOut = tool({ signIn: { state: 'out', method: null, hint: 'codex login' } })
  assert.equal(agentStanding(signedOut, true), 'signedOut')
  assert.deepEqual(agentNote(signedOut, 'signedOut'), { key: 'agentSignInHint', values: { hint: 'codex login' } })
})

test('an agent that cannot report is left unknown rather than guessed at', () => {
  const quiet = tool({ id: 'claude', name: 'Claude Code', signIn: { state: 'unknown', method: null, hint: null } })
  assert.equal(agentStanding(quiet, true), 'unknown')
  assert.deepEqual(agentNote(quiet, 'unknown'), { key: 'agentSignInUnknown' })
})

test('a signed-in agent is described in its own words', () => {
  assert.deepEqual(agentNote(tool(), 'ready'), { key: 'agentSignedInAs', values: { method: 'ChatGPT' } })
  assert.deepEqual(agentNote(tool({ signIn: { state: 'in', method: null, hint: null } }), 'ready'), { key: 'agentSignedIn' })
})

test('a choice that stopped working is still shown as the choice', () => {
  const tools = [tool({ detected: false, servesCapabilities: false }), tool({ id: 'pi', name: 'pi' })]
  assert.equal(chosenAgent(tools, 'codex')?.id, 'codex')
  assert.equal(agentStanding(chosenAgent(tools, 'codex'), true), 'missing')
  assert.equal(chosenAgent(tools, 'kimi'), null)
})

test('only installed built-in agents are offered as a choice', () => {
  const tools = [
    tool(),
    tool({ id: 'claude', name: 'Claude Code', detected: false }),
    tool({ id: 'zyx', name: 'zyx', custom: true, servesCapabilities: false }),
  ]
  assert.deepEqual(selectableAgents(tools).map((entry) => entry.id), ['codex'])
})
