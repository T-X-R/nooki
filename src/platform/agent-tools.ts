import { invoke } from '@tauri-apps/api/core'
import type { Language } from '../shared/i18n.ts'

/**
 * The coding agents installed on this machine.
 *
 * Nooki lists agents, never ways of signing into one: how an agent authenticates is that agent's
 * business, and asking a person to declare it here would ask them to keep a second copy of
 * something the tool already knows. What a Capability reaches is picked here and run there.
 */

/** `unknown` is a real answer: some agents keep their credentials where Nooki cannot look. */
export type SignInState = 'in' | 'out' | 'unknown'

export type AgentSignIn = {
  state: SignInState
  /** How the tool describes its own sign-in, in the tool's words. Absent when it does not say. */
  method: string | null
  /** What to run, in that tool, to sign in. Nooki never collects the credential itself. */
  hint: string | null
}

export type AgentTool = {
  id: string
  name: string
  /** Where this tool reads skills from. */
  directory: string
  detected: boolean
  readsPool: boolean
  custom: boolean
  signIn: AgentSignIn
  /** Whether this agent can run a one-shot turn on a Capability's behalf. */
  servesCapabilities: boolean
}

export type AiInvocationResult = {
  provider: string
  model: string
  output: string
}

export function isDesktopHost(): boolean {
  return Boolean(window.__TAURI_INTERNALS__)
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

/** Browser preview has no machine to look at, and says so by finding nothing. */
export async function listAgentTools(): Promise<AgentTool[]> {
  if (!isDesktopHost()) return []
  try {
    return await invoke<AgentTool[]>('agent_tools')
  } catch {
    return []
  }
}

export async function getCapabilityAgent(): Promise<string> {
  if (!isDesktopHost()) return 'codex'
  try {
    return await invoke<string>('capability_agent')
  } catch {
    return 'codex'
  }
}

export async function setCapabilityAgent(id: string): Promise<void> {
  if (!isDesktopHost()) return
  await invoke('set_capability_agent', { agent: id })
}

/**
 * The only honest check is the thing a Capability actually does, so this runs one real turn on the
 * chosen agent. It spends the same quota a Capability would.
 */
export async function testCapabilityAgent(language: Language): Promise<AiInvocationResult> {
  if (!isDesktopHost()) {
    throw new Error(language === 'en' ? 'Agents are only reachable in the desktop app' : '只有桌面应用能调用本机 agent')
  }
  try {
    return await invoke<AiInvocationResult>('capability_agent_test', { language })
  } catch (error) {
    throw new Error(typeof error === 'string' ? error : language === 'en' ? 'The agent did not answer' : 'Agent 没有回应')
  }
}
