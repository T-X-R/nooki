import { invoke } from '@tauri-apps/api/core'
import type { DocumentPublication, SelectedDocument } from '../packages/capability-contract/src'
import { publicationReference } from '../packages/capability-contract/src/references'
import { readLibraryDocument, publishCapabilityDocument, changeLibrary } from './document-library'
import { activityStore } from './activity'
import { CONVERSATION_OWNER, libraryContext, type ConversationInput, type ConversationResult, type SaveAnswerInput } from './conversation-model'
import type { TaskJob } from './task-runner'
export { CONVERSATION_OWNER } from './conversation-model'

export const respond: TaskJob = {
  async run(value, { step, executionId, signal }) {
    const input = value as ConversationInput
    if (!input.threadId || !input.message.trim() || !Array.isArray(input.documentIds) || input.documentIds.length > 50) throw new Error('Invalid conversation input')
    const documents = await step('sources', async (): Promise<SelectedDocument[]> => {
      if (window.__TAURI_INTERNALS__) return invoke('library_capture_sources', { id: input.snapshotId, ids: input.documentIds })
      const key = `workbench-source-snapshot:${input.snapshotId}`
      const saved = localStorage.getItem(key)
      if (saved) return JSON.parse(saved)
      const sources = await Promise.all(input.documentIds.map(async (id) => { const doc = await readLibraryDocument(id); return { reference: { kind: 'library-document' as const, documentId: id, title: doc.title, snapshotId: input.snapshotId, revision: doc.updatedAt }, documentDate: doc.documentDate, content: doc.content } }))
      localStorage.setItem(key, JSON.stringify(sources)); return sources
    })
    const context = libraryContext(documents)
    if (new TextEncoder().encode(context + input.message).length > 100_000) throw new Error('引用资料过长，请减少资料后重新发送 / Message and references exceed 100 KB')
    return step('codex-turn', async (): Promise<ConversationResult> => {
      signal.throwIfAborted()
      if (!window.__TAURI_INTERNALS__) throw new Error('请在桌面 App 中连接 Codex / Codex requires desktop Workbench')
      return invoke('conversation_run', { request: { threadId: input.threadId, message: input.message, context, requestId: executionId.split(':')[0], executionId } })
    })
  },
}
export const saveAnswer: TaskJob = {
  async run(value, { step, signal, executionId }) {
    const input = value as SaveAnswerInput
    if (!input.title.trim() || !input.content.trim() || !/^[a-z0-9-]+$/.test(input.messageId)) throw new Error('Invalid answer to save')
    const publication: DocumentPublication = { key: input.messageId, title: input.title, content: input.content, documentDate: input.date, collectionKey: 'answers', collectionName: input.language === 'zh' ? '对话成果' : 'Conversation answers' }
    const published = await step('publish', async () => {
      signal.throwIfAborted()
      if (input.targetDocumentId) {
        if (!input.expectedRevision) throw new Error('Missing target revision')
        const current = await readLibraryDocument(input.targetDocumentId)
        // A lost publication acknowledgement can be retried without overwriting a later edit.
        if (current.title !== input.title || current.content !== input.content) {
          await changeLibrary({ kind: 'edit', id: current.id, title: input.title, content: input.content, expected: input.expectedRevision })
        }
        return { kind: 'library-document' as const, documentId: current.id, title: input.title }
      }
      if (window.__TAURI_INTERNALS__) await invoke('conversation_publish', { document: publication })
      else await publishCapabilityDocument(CONVERSATION_OWNER, input.language === 'zh' ? '对话' : 'Conversations', publication)
    })
    const reference = published ?? publicationReference(CONVERSATION_OWNER, publication)
    if (input.threadId) await step('origin', async () => { await changeLibrary({ kind: 'origin', id: reference.documentId, origin: { threadId: input.threadId!, messageId: input.sourceMessageId ?? input.messageId } }) })
    await step('activity', async () => { signal.throwIfAborted(); activityStore.write(CONVERSATION_OWNER, { type: 'conversation.saved', title: input.title, key: reference.documentId, target: reference }, executionId.split(':')[0]) })
    return reference
  },
}
export function resolveConversationJob(job: string) {
  if (!['respond', 'save-answer'].includes(job)) throw new Error('Platform conversation job not found')
  return { ownerKind: 'platform' as const, version: '1', definition: job === 'respond' ? respond : saveAnswer, scope: (input: unknown) => job === 'respond' ? (input as ConversationInput).threadId : (input as SaveAnswerInput).messageId }
}
