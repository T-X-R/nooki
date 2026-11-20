import type { CapabilityEnvironment, CapabilityHost, CapabilityManifest } from '../contract/index.ts'

// UI/test simulation only. Each instance starts empty and never opens native services.
export function createPreviewHost(manifest: CapabilityManifest) {
  let environment: CapabilityEnvironment = Object.freeze({ language: 'zh', locale: 'zh-CN', theme: 'light' })
  const listeners = new Set<() => void>()
  const storage = new Map<string, string>()
  const requireStorage = () => {
    if (!manifest.permissions.includes('storage')) throw new Error('Declare storage permission')
  }
  const unavailable = (operation: string): never => {
    throw new Error(`Preview unavailable: ${operation} requires desktop Nooki.`)
  }
  const host: CapabilityHost = {
    environment: {
      getSnapshot: () => environment,
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
    storage: {
      async get<T>(key: string) { requireStorage(); return JSON.parse(storage.get(key) ?? 'null') as T | null },
      async set(key, value) {
        requireStorage()
        const serialized = JSON.stringify(value)
        if (serialized === undefined) throw new Error('Preview storage requires a JSON value')
        storage.set(key, serialized)
      },
      async remove(key) { requireStorage(); storage.delete(key) },
    },
    ai: { invoke: async () => unavailable('ai.invoke') },
    codex: { sessions: { readTodayFiles: async () => unavailable('codex.sessions.readTodayFiles') } },
    documents: {
      publish: async () => unavailable('documents.publish'),
      listGrants: async () => unavailable('documents.listGrants'),
      readSelected: async () => unavailable('documents.readSelected'),
      open: () => unavailable('documents.open'),
    },
    activity: { write: async () => unavailable('activity.write') },
    tasks: {
      getSnapshot: () => unavailable('tasks.getSnapshot'),
      subscribe: () => unavailable('tasks.subscribe'),
      start: async () => unavailable('tasks.start'),
      cancel: async () => unavailable('tasks.cancel'),
      retry: async () => unavailable('tasks.retry'),
    },
  }
  return {
    host,
    setEnvironment(next: CapabilityEnvironment) {
      environment = Object.freeze({ ...next })
      listeners.forEach((listener) => listener())
    },
  }
}
