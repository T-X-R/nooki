import type { ConversationCapabilitySource, SelectedDocument, TaskRecord } from '../../packages/capability-contract/src/index.ts'
import { CONVERSATION_OWNER, type ConversationInput } from '../features/conversation/conversation-model.ts'
import type { BrokerInvocationContext } from './capability-broker.ts'

// The agent never supplies source IDs or contents. Only a live Nooki conversation
// task for this thread can hand its captured, immutable attachments to a command.
export function currentConversationSources(records: readonly TaskRecord[], context: BrokerInvocationContext): ConversationCapabilitySource[] {
  const matches = records.filter((record) => record.ownerKind === 'platform'
    && record.capabilityId === CONVERSATION_OWNER && record.job === 'respond'
    && record.status === 'running' && record.scope === context.threadId)
  if (matches.length !== 1) throw new Error('Current conversation turn is unavailable')
  const record = matches[0]
  const input = record.input as ConversationInput
  if (input.threadId !== context.threadId || !Array.isArray(input.documentIds) || !Array.isArray(input.uploads ?? [])) throw new Error('Conversation source context is invalid')
  const captured = record.checkpoints.sources
  if (!Array.isArray(captured) || captured.length !== input.documentIds.length) throw new Error('Conversation sources are not captured yet')
  const documents = captured as SelectedDocument[]
  if (documents.some((document, index) => document?.reference?.documentId !== input.documentIds[index]
    || document.reference.snapshotId !== input.snapshotId || typeof document.content !== 'string')) throw new Error('Conversation snapshot does not match this turn')
  const uploads = input.uploads ?? []
  if (uploads.some((attachment) => !attachment || typeof attachment.name !== 'string' || typeof attachment.content !== 'string')) throw new Error('Conversation uploads are invalid')
  return [
    ...documents.map((document): ConversationCapabilitySource => ({ kind: 'library', title: document.reference.title, content: document.content, documentDate: document.documentDate, reference: document.reference })),
    ...uploads.map((attachment): ConversationCapabilitySource => ({ kind: 'upload', title: attachment.name, content: attachment.content })),
  ]
}
