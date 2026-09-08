import type { ActivityEvent, ActivityEventInput, TaskRecord } from '../packages/capability-contract/src/index.ts'

// Preserve the existing storage key so pre-0.3 events remain readable.
export const activityStorageKey = 'personal-workbench:activity-events'
export function createActivityStore(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const listeners = new Set<() => void>()
  let snapshot: readonly ActivityEvent[] = []
  return {
    load() {
      const records = JSON.parse(storage.getItem(activityStorageKey) ?? '[]')
      if (!Array.isArray(records)) throw new Error('Invalid activity history')
      if (records.some((event) => !event || !['id', 'type', 'title', 'source', 'occurredAt'].every((field) => typeof event[field] === 'string'))) throw new Error('Invalid activity history')
      snapshot = records
      listeners.forEach((listener) => listener())
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    write(source: string, event: ActivityEventInput, taskId?: string) {
      const records: ActivityEvent[] = JSON.parse(storage.getItem(activityStorageKey) ?? '[]')
      const previous = event.key ? records.find((item) => item.source === source && item.key === event.key) : undefined
      const next = { ...event, source, taskId, id: previous?.id ?? crypto.randomUUID(), occurredAt: new Date().toISOString(), sensitivity: event.sensitivity ?? 'normal' as const }
      const updated = [...records.filter((item) => item.id !== next.id), next]
      // Do not acknowledge an event on storage failure or silently evict history.
      storage.setItem(activityStorageKey, JSON.stringify(updated))
      snapshot = updated
      listeners.forEach((listener) => listener())
    },
  }
}

export function todayFeed(events: readonly ActivityEvent[], tasks: readonly TaskRecord[]) {
  const attention = tasks.filter((task) => ['running', 'failed', 'interrupted'].includes(task.status))
  const visible = events.filter((event) => !attention.some((task) => task.id === event.taskId))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  return { tasks: [...attention].reverse(), events: visible }
}
