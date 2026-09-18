import type { AgentTool } from '../../platform/agent-tools.ts'

/**
 * How an agent stands right now, in one word.
 *
 * `unknown` is deliberately not folded into `ready` or `signedOut`. Claude Code and pi keep their
 * credentials where Nooki cannot look, and a badge that guessed would be wrong about half the time
 * with no way for a person to tell which half they were in.
 */
export type AgentStanding = 'ready' | 'unknown' | 'signedOut' | 'missing' | 'preview'

/** A message key plus whatever the message needs, so the words themselves stay in i18n. */
export type AgentNote = { key: string; values?: Record<string, string> }

export function agentStanding(tool: AgentTool | null, desktop: boolean): AgentStanding {
  if (!desktop) return 'preview'
  if (!tool || !tool.detected) return 'missing'
  if (tool.signIn.state === 'out') return 'signedOut'
  if (tool.signIn.state === 'unknown') return 'unknown'
  return 'ready'
}

export function agentNote(tool: AgentTool | null, standing: AgentStanding): AgentNote {
  switch (standing) {
    case 'preview':
      return { key: 'agentPreviewNote' }
    case 'missing':
      return { key: 'agentMissingNote' }
    case 'signedOut':
      // The hint is the tool's own command. Nooki repeats it rather than offering to run it.
      return tool?.signIn.hint ? { key: 'agentSignInHint', values: { hint: tool.signIn.hint } } : { key: 'agentSignedOutNote' }
    case 'unknown':
      return { key: 'agentSignInUnknown' }
    case 'ready':
      return tool?.signIn.method ? { key: 'agentSignedInAs', values: { method: tool.signIn.method } } : { key: 'agentSignedIn' }
  }
}

/**
 * The agent a Capability would actually reach. A choice that no longer works is still shown as the
 * choice, so Settings can explain the problem instead of quietly substituting something else.
 */
export function chosenAgent(tools: AgentTool[], chosen: string): AgentTool | null {
  return tools.find((tool) => tool.id === chosen) ?? null
}

/** The agents worth offering as a choice: installed, and something Nooki knows how to run. */
export function selectableAgents(tools: AgentTool[]): AgentTool[] {
  return tools.filter((tool) => !tool.custom && tool.detected)
}
