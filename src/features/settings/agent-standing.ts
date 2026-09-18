import type { AgentTool } from '../../platform/agent-tools.ts'

/**
 * How an agent stands right now, in one word.
 *
 * Sign-in is deliberately not part of this. pi has no login at all — an API key in its own config is
 * enough — and Claude Code keeps credentials where Nooki cannot look. A badge built on sign-in would
 * be wrong for two agents out of three. What Nooki can actually tell is whether the agent is here.
 */
export type AgentStanding = 'available' | 'notInstalled' | 'preview'

/** A message key plus whatever the message needs, so the words themselves stay in i18n. */
export type AgentNote = { key: string; values?: Record<string, string> }

export function agentStanding(tool: AgentTool | null, desktop: boolean): AgentStanding {
  if (!desktop) return 'preview'
  return tool?.detected ? 'available' : 'notInstalled'
}

/**
 * What to say under the name. For an installed agent this is about credentials, and it is a
 * statement rather than a warning: an agent holding its own credentials is the arrangement Nooki
 * wants, not a problem to fix.
 */
export function agentNote(tool: AgentTool | null, standing: AgentStanding): AgentNote {
  if (standing === 'preview') return { key: 'agentPreviewNote' }
  if (standing === 'notInstalled') return { key: 'agentMissingNote' }
  if (tool?.signIn.method) return { key: 'agentSignedInAs', values: { method: tool.signIn.method } }
  // The hint is the tool's own command. Nooki repeats it rather than offering to run it.
  if (tool?.signIn.state === 'out' && tool.signIn.hint) return { key: 'agentSignInHint', values: { hint: tool.signIn.hint } }
  return { key: 'agentCredentialOwn' }
}

/**
 * The agent a Capability would actually reach. A choice that no longer works is still shown as the
 * choice, so Settings can explain the problem instead of quietly substituting something else.
 */
export function chosenAgent(tools: AgentTool[], chosen: string): AgentTool | null {
  return tools.find((tool) => tool.id === chosen) ?? null
}

/**
 * The agents to show, installed ones first. A tool registered only by its skills directory is not
 * listed: Nooki knows where it reads skills, not how to run it, and offering it would be a control
 * that fails.
 */
export function listedAgents(tools: AgentTool[]): AgentTool[] {
  const listed = tools.filter((tool) => !tool.custom)
  return [...listed.filter((tool) => tool.detected), ...listed.filter((tool) => !tool.detected)]
}

/** Installed is enough. Whether the agent is ready to answer is the agent's own report to make. */
export function canChoose(tool: AgentTool): boolean {
  return tool.servesCapabilities
}
