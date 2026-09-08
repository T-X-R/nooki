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

// Events may predate stable keys or have different keys for the same document.
// Group their identities without deleting persisted history or relying on titles.
export function latestActivities(events: readonly ActivityEvent[]): ActivityEvent[] {
  const parents = new Map<string, string>()
  const root = (key: string): string => {
    let current = key
    const path: string[] = []
    while (parents.has(current) && parents.get(current) !== current) { path.push(current); current = parents.get(current)! }
    for (const visited of path) parents.set(visited, current)
    return current
  }
  const keys = (event: ActivityEvent): string[] => {
    const identities = [`event:${event.id}`]
    if (event.key) identities.push(JSON.stringify(['key', event.source, event.key]))
    if (event.target?.documentId) identities.push(JSON.stringify(['document', event.target.documentId]))
    // Compatibility with diary events written before Activity Event keys existed.
    if (event.source === 'com.personal.diary' && event.type === 'diary.entry.saved' && event.payload && typeof event.payload === 'object' && 'entryId' in event.payload && typeof event.payload.entryId === 'string') {
      identities.push(JSON.stringify(['key', event.source, `diary-${event.payload.entryId}`]))
    }
    return identities
  }
  for (const event of events) {
    const identities = keys(event)
    for (const key of identities.slice(1)) parents.set(root(key), root(identities[0]))
  }
  const seen = new Set<string>()
  return [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).filter((event) => {
    const identity = root(keys(event)[0])
    if (seen.has(identity)) return false
    seen.add(identity); return true
  })
}

export function todayFeed(events: readonly ActivityEvent[], tasks: readonly TaskRecord[]) {
  const attention = tasks.filter((task) => ['running', 'failed', 'interrupted'].includes(task.status))
  const visible = latestActivities(events).filter((event) => !attention.some((task) => task.id === event.taskId))
  return { tasks: [...attention].reverse(), events: visible }
}
