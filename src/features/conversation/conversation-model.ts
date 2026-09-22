import type { LibrarySection } from '../../platform/library-store.ts'
import type { SelectedDocument } from '../../../packages/capability-contract/src/index.ts'
import { referenceHref } from '../../../packages/capability-contract/src/references.ts'
import type { ConversationAttachment, ConversationArtifact } from './conversation-documents.ts'

export const CONVERSATION_OWNER = 'workbench.conversations'
export const LEGACY_REVIEW = 'com.personal.weekly-review'
export type AsyncQuestion = { title: string; options?: string[] | null }
export type ConversationItem = { id: string; type: string; clientId?: string; text?: string; phase?: string; delivery?: string | null; questions?: AsyncQuestion[] | null; summary?: string[]; content?: { type: string; text?: string }[]; command?: string; aggregatedOutput?: string; status?: string; tool?: string; server?: string; changes?: unknown[]; error?: unknown; result?: unknown }
export type ConversationTurn = { id: string; items: ConversationItem[]; status: string; error?: { message: string }; startedAt?: number | null; completedAt?: number | null; durationMs?: number | null }
export type Conversation = { id: string; agent?: string; archived?: boolean; name?: string; preview: string; createdAt: number; updatedAt: number; model?: string; status?: { type: string }; turns: ConversationTurn[]; nextCursor?: string | null }
export type ConversationEvent = { method: string; params?: { threadId?: string; turnId?: string; turn?: ConversationTurn; item?: ConversationItem; itemId?: string; delta?: string; summaryIndex?: number; message?: string } }
export type ConversationInput = { threadId: string; message: string; documentIds: string[]; snapshotId: string; uploads?: ConversationAttachment[]; skills?: string[] }
export type ConversationResult = { threadId: string; turnId: string; artifacts?: ConversationArtifact[] }
export type SaveAnswerInput = { threadId?: string; messageId: string; sourceMessageId?: string; sourceArtifactId?: string; title: string; content: string; date: string; language: 'zh' | 'en'; targetDocumentId?: string; expectedRevision?: string; destination?: { topicId?: string; section: LibrarySection } }

export function conversationAgentName(agent?: string): string {
  if (agent === 'pi') return 'pi'
  if (agent === 'claude') return 'Claude Code'
  return 'Codex'
}

/** A conversation that already exists names its own agent and is the authority; only a page with no
 *  conversation open yet can speak for the agent the next one will use. Codex threads carry no agent
 *  field at all, so an absent field means Codex, never "whichever agent is selected right now". */
export function conversationRuntimeName(thread: Conversation | undefined, selectedAgent: string): string {
  return conversationAgentName(thread ? thread.agent : selectedAgent)
}

export function isConversationProcessItem(item: ConversationItem): boolean {
  if (item.type === 'agentMessage') return item.delivery !== 'async' && item.phase === 'commentary'
  if (item.type === 'reasoning') return !!item.summary?.some((text) => text.trim())
  return ['plan', 'commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'contextCompaction', 'collabAgentToolCall'].includes(item.type)
}

export function isAsyncQuestion(item: ConversationItem): boolean {
  return item.type === 'agentMessage' && item.delivery === 'async' && !!item.questions?.length
}

export function isConversationAnswer(item: ConversationItem): boolean {
  return item.type === 'agentMessage' && item.delivery !== 'async' && item.phase !== 'commentary'
}

export function asyncQuestionReply(turns: readonly ConversationTurn[], itemId: string): ConversationItem | undefined {
  return turns.flatMap((turn) => turn.items).find((item) => item.type === 'userMessage' && item.clientId === `async-answer-${itemId}`)
}

export function asyncQuestionAnswered(turns: readonly ConversationTurn[], itemId: string): boolean {
  return !!asyncQuestionReply(turns, itemId)
}

export function waitingForInitialResponse(turns: readonly ConversationTurn[], hasEarlierTurns = false): boolean {
  if (hasEarlierTurns || turns.length > 1) return false
  const turn = turns[0]
  return !turn || (turn.status === 'inProgress' && !turn.items.some((item) => isConversationProcessItem(item) || (item.type === 'agentMessage' && !!item.text?.trim())))
}

export function conversationDuration(turn: ConversationTurn, zh: boolean): string | null {
  const milliseconds = turn.durationMs ?? (turn.startedAt != null && turn.completedAt != null ? (turn.completedAt - turn.startedAt) * 1000 : null)
  if (milliseconds == null || !Number.isFinite(milliseconds) || milliseconds < 0) return null
  const total = Math.floor(milliseconds / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total % 3600 / 60)
  const seconds = total % 60
  return [hours ? `${hours}${zh ? '小时' : 'h'}` : '', minutes ? `${minutes}${zh ? '分' : 'm'}` : '', seconds || !total ? `${seconds}${zh ? '秒' : 's'}` : ''].filter(Boolean).join(' ')
}

export function retainPublicSummary(previous: ConversationItem | undefined, item: ConversationItem): ConversationItem {
  return item.type === 'reasoning' && !item.summary?.some((text) => text.trim()) && previous?.summary?.some((text) => text.trim())
    ? { ...item, summary: previous.summary } : item
}

// Native adapters own history; this reducer only renders normalized live notifications.
export function applyConversationEvent(thread: Conversation, event: ConversationEvent): Conversation {
  const p = event.params
  if (!p || p.threadId !== thread.id) return thread
  const turnId = p.turn?.id ?? p.turnId
  if (!turnId) return thread
  let turns = [...thread.turns]
  let turn = turns.find((t) => t.id === turnId) ?? { id: turnId, items: [], status: 'inProgress' }
  if (p.turn && (event.method === 'turn/started' || event.method === 'turn/completed')) {
    turn = { ...turn, ...p.turn, items: p.turn.items?.length ? p.turn.items.map((item) => retainPublicSummary(turn.items.find((previous) => previous.id === item.id), item)) : turn.items }
  } else if (p.item && ['item/started', 'item/completed'].includes(event.method)) {
    const index = turn.items.findIndex((i) => i.id === p.item!.id)
    const items = [...turn.items]
    if (index < 0) items.push(p.item); else items[index] = retainPublicSummary(items[index], p.item)
    turn = { ...turn, items }
  } else if (p.itemId && typeof p.delta === 'string') {
    const index = turn.items.findIndex((i) => i.id === p.itemId)
    const known = ['item/agentMessage/delta', 'item/reasoning/summaryTextDelta', 'item/commandExecution/outputDelta', 'item/plan/delta']
    if (!known.includes(event.method)) return thread
    let item = { ...(turn.items[index] ?? { id: p.itemId, type: event.method.includes('reasoning') ? 'reasoning' : event.method.includes('commandExecution') ? 'commandExecution' : event.method.includes('plan') ? 'plan' : 'agentMessage' }) }
    if (event.method.includes('summaryTextDelta')) { const summary = [...(item.summary ?? [])]; summary[p.summaryIndex ?? 0] = (summary[p.summaryIndex ?? 0] ?? '') + p.delta; item = { ...item, summary } }
    else if (event.method.includes('outputDelta')) item.aggregatedOutput = (item.aggregatedOutput ?? '') + p.delta
    else item.text = (item.text ?? '') + p.delta
    const items = [...turn.items]; if (index < 0) items.push(item); else items[index] = item
    turn = { ...turn, items }
  } else return thread
  turns = turns.some((t) => t.id === turnId) ? turns.map((t) => t.id === turnId ? turn : t) : [...turns, turn]
  return { ...thread, turns }
}
export function libraryContext(documents: SelectedDocument[], fileBacked = false): string {
  return documents.length ? `Library documents attached by the user.${fileBacked ? ' Read each one through the working copy listed in the document context.' : ''}\n${JSON.stringify(documents.map((doc) => ({ title: doc.reference.title, date: doc.documentDate, href: referenceHref(doc.reference), ...(!fileBacked && { content: doc.content }) })))}` : 'No Library documents are attached to this message.'
}
