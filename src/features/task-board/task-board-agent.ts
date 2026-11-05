import { invoke } from '@tauri-apps/api/core'
import { taskRunner } from '../../platform/tasks.ts'
import { conversationClient } from '../conversation/conversation-client.ts'
import { CONVERSATION_OWNER, isAsyncQuestion, isConversationAnswer, type ConversationInput, type ConversationResult } from '../conversation/conversation-model.ts'
import { createBoardDispatcher } from './task-board-dispatch.ts'
import { taskBoard, goalCommand } from './task-board.ts'

const questionHeading = '## NOOKI_QUESTION'
const find = (id: string) => taskRunner.getSnapshot().find(record =>
  record.capabilityId === CONVERSATION_OWNER && record.job === 'respond' && (record.input as ConversationInput).boardTask?.runId === id)

const dispatcher = createBoardDispatcher(taskBoard, {
  find,
  createThread: async card => (await conversationClient.create(card.title)).id,
  async start(card, runId) {
    const { authorization, threadId } = card
    if (!authorization || !threadId) throw new Error('Task authorization or session missing')
    const requirements = [
      'Work on this delegated Nooki task and prepare a draft for human review.',
      'Use only the attached task materials and the conversation. Return all drafts as Markdown text; do not use tools, send messages, or publish changes.',
      'If you must ask the user something before proceeding, put ' + questionHeading + ' on the first line of your final response, then write the question and finish this turn.',
      'Otherwise deliver the complete draft in your final response, with any evidence or assumptions.',
      '',
      card.title,
      card.description,
    ]
    if (card.followUp) requirements.push('', 'User follow-up:', card.followUp)
    const input: ConversationInput = {
      threadId, message: requirements.join('\n'), ...authorization, boardTask: { runId, title: card.title },
    }
    await taskRunner.start(CONVERSATION_OWNER, 'respond', input)
  },
  async delivery(id) {
    const result = find(id)?.result as ConversationResult | undefined
    if (!result?.threadId || !result.turnId) throw new Error('Codex did not return a turn')
    let thread = await conversationClient.read(result.threadId)
    let turn = thread.turns.find(item => item.id === result.turnId)
    while (!turn && thread.nextCursor) {
      thread = await conversationClient.read(result.threadId, thread.nextCursor)
      turn = thread.turns.find(item => item.id === result.turnId)
    }
    if (!turn) throw new Error('Task turn could not be found in Codex history')
    const text = turn.items.filter(isConversationAnswer).map(item => item.text?.trim()).filter(Boolean).at(-1) ?? ''
    const artifacts = result.artifacts ?? []
    const [heading, ...body] = text.split(/\r?\n/)
    if (heading === questionHeading && body.join('\n').trim()) return { text: body.join('\n').trim(), artifacts: [], question: true }
    if (!text && !artifacts.length) {
      const questions = turn.items.filter(isAsyncQuestion).flatMap(item => item.questions?.map(question => question.title) ?? [])
      if (questions.length) return { text: questions.join('\n'), artifacts: [], question: true }
      throw new Error('Codex completed this turn without a delivery')
    }
    return { text, artifacts }
  },
  async stop(id) {
    const record = find(id)
    if (!record) return
    await taskRunner.cancel(record.id)
    await taskRunner.settled(record.id)
  },
})

let available = false
let connected = false
let scheduled = false
function wake() {
  if (!connected || scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    void dispatcher.reconcile(available).catch(error => {
      console.error('Task board synchronization failed', error)
    })
  })
}

export const taskBoardAgent = {
  start() {
    if (connected || !window.__TAURI_INTERNALS__) return
    connected = true
    let refreshing = false
    setInterval(() => {
      if (refreshing) return
      refreshing = true
      void taskBoard.refresh().catch(error => console.error('Task board refresh failed', error)).finally(() => { refreshing = false })
    }, 2000)
    let threadIds = ''
    taskBoard.subscribe(() => {
      wake()
      const next = taskBoard.snapshot().cards.map(card => card.threadId ?? '').join(',')
      if (threadIds !== next) { threadIds = next; window.dispatchEvent(new Event('workbench:conversations-changed')) }
    })
    taskRunner.subscribe(wake)
    wake()
  },
  setAvailable(next: boolean) {
    available = next
    wake()
  },
  async delegate(id: string, documentIds: string[]) {
    if (!available) throw new Error('Codex is unavailable')
    const snapshotId = crypto.randomUUID()
    if (documentIds.length) await invoke('library_capture_sources', { id: snapshotId, ids: documentIds })
    await taskBoard.delegate(id, { snapshotId, documentIds })
  },
  stop: (id: string) => taskBoard.snapshot().cards.find(card => card.id === id)?.engine === 'goals'
    ? goalCommand({ op: 'stop', id }).then(() => {}) : dispatcher.stop(id),
  remove: (id: string) => taskBoard.snapshot().cards.find(card => card.id === id)?.engine === 'goals'
    ? taskBoard.remove(id) : dispatcher.remove(id),
}
