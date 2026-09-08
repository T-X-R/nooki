import type { TaskRecord } from '../packages/capability-contract/src/index.ts'
import { CONVERSATION_OWNER } from './conversation-model.ts'

export type TaskGroup = { kind: 'task'; id: string; record: TaskRecord; updatedAt: string } | {
  kind: 'conversation'; id: string; threadId: string; records: TaskRecord[]; updatedAt: string
  fallbackTitle: string; running: number; attention: number
}

export function taskInputText(record: TaskRecord, key: string): string {
  if (!record.input || typeof record.input !== 'object') return ''
  const value = (record.input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function groupTasks(records: readonly TaskRecord[]): TaskGroup[] {
  const groups: TaskGroup[] = []
  const conversations = new Map<string, Extract<TaskGroup, { kind: 'conversation' }>>()
  for (const record of records) {
    const threadId = record.ownerKind === 'platform' && record.capabilityId === CONVERSATION_OWNER ? taskInputText(record, 'threadId') : ''
    if (!threadId) { groups.push({ kind: 'task', id: `task:${record.id}`, record, updatedAt: record.updatedAt }); continue }
    let group = conversations.get(threadId)
    if (!group) {
      group = { kind: 'conversation', id: `conversation:${threadId}`, threadId, records: [], updatedAt: record.updatedAt, fallbackTitle: '', running: 0, attention: 0 }
      conversations.set(threadId, group); groups.push(group)
    }
    group.records.push(record)
    if (record.status === 'running') group.running++
    if (record.status === 'failed' || record.status === 'interrupted') group.attention++
  }
  for (const group of conversations.values()) {
    const firstMessage = [...group.records].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).find((record) => taskInputText(record, 'message'))
    group.fallbackTitle = firstMessage ? taskInputText(firstMessage, 'message').replace(/\s+/g, ' ').slice(0, 120) : ''
    group.records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))
    group.updatedAt = group.records[0].updatedAt
  }
  return groups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
