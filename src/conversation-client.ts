import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { applyConversationEvent, retainPublicSummary, type Conversation, type ConversationEvent } from './conversation-model'

const listeners = new Set<() => void>()
let cache: Readonly<Record<string, Conversation>> = {}
let listening: Promise<unknown> | undefined
const revisions: Record<string, number> = {}
function emit() { listeners.forEach((listener) => listener()) }
function desktop() { if (!window.__TAURI_INTERNALS__) throw new Error('对话需要桌面版 Nooki 和已登录的 Codex / Desktop Nooki and Codex are required') }
export const conversationClient = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  getSnapshot: () => cache,
  async connect() {
    desktop()
    listening ??= listen<ConversationEvent>('workbench:codex-event', ({ payload }) => {
      const id = payload.params?.threadId
      if (!id || !cache[id]) return
      const next = applyConversationEvent(cache[id], payload)
      if (next !== cache[id]) { revisions[id] = (revisions[id] ?? 0) + 1; cache = { ...cache, [id]: next }; emit() }
    }).catch((error) => { listening = undefined; throw error })
    await listening
  },
  async list(cursor?: string | null): Promise<{ data: Conversation[]; nextCursor: string | null }> { await this.connect(); return invoke('conversation_list', { cursor: cursor ?? null }) },
  async create(): Promise<Conversation> {
    await this.connect()
    const thread = await invoke<Conversation>('conversation_create')
    cache = { ...cache, [thread.id]: thread }; emit(); return thread
  },
  async read(id: string, cursor?: string | null) {
    await this.connect()
    const before = revisions[id] ?? 0
    const thread = await invoke<Conversation>('conversation_read', { id, cursor: cursor ?? null })
    const previous = cache[id]
    if (previous) {
      const items = new Map(previous.turns.flatMap((turn) => turn.items.map((item) => [item.id, item] as const)))
      thread.turns = thread.turns.map((turn) => ({ ...turn, items: turn.items.map((item) => retainPublicSummary(items.get(item.id), item)) }))
    }
    if (previous && (cursor || (revisions[id] ?? 0) !== before)) {
      const turns = new Map(thread.turns.map((turn) => [turn.id, turn]))
      for (const turn of previous.turns) { if (cursor || (revisions[id] ?? 0) !== before) turns.set(turn.id, turn) }
      thread.turns = [...turns.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
      if (!cursor && previous.nextCursor) thread.nextCursor = previous.nextCursor
    }
    cache = { ...cache, [id]: thread }; emit(); return thread
  },
}
