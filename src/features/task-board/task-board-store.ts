import type { ConversationArtifact } from '../conversation/conversation-documents.ts'

export type BoardAuthorization = { snapshotId: string; documentIds: string[] }
export type BoardDelivery = { text: string; artifacts: ConversationArtifact[]; question?: boolean }

export type BoardStatus = 'todo' | 'queued' | 'running' | 'question' | 'review' | 'stopped' | 'done'

export type BoardCard = {
  id: string
  title: string
  description: string
  status: BoardStatus
  authorization?: BoardAuthorization
  queuedAt?: number
  threadId?: string
  runId?: string
  followUp?: string
  delivery?: BoardDelivery
  error?: string
}

export type BoardState = { cards: BoardCard[]; paused?: boolean }

type Storage = {
  read(): Promise<BoardState | null>
  write(state: BoardState): Promise<void>
}

export function createTaskBoard(storage: Storage) {
  let state: BoardState = { cards: [] }
  let initialization: Promise<void> | undefined
  let pending: Promise<unknown> = Promise.resolve()
  let maintenance = false
  const listeners = new Set<() => void>()
  const publish = (next: BoardState) => {
    state = next
    listeners.forEach(listener => listener())
  }
  const initialize = () => initialization ??= storage.read().then(saved => {
    if (!saved) return
    if (!Array.isArray(saved.cards)) throw new Error('Invalid task board')
    publish(saved)
  }).catch(error => {
    initialization = undefined
    throw error
  })
  const change = (update: (current: BoardState) => BoardState) => {
    const operation = pending.then(async () => {
      await initialize()
      if (maintenance) throw new Error('Data maintenance in progress')
      const next = update(state)
      if (next === state) return
      await storage.write(next)
      publish(next)
    })
    pending = operation.catch(() => undefined)
    return operation
  }
  const updateCard = (id: string, update: (card: BoardCard) => BoardCard) => change(current => {
    const card = current.cards.find(item => item.id === id)
    if (!card) return current
    const next = update(card)
    return next === card ? current : { ...current, cards: current.cards.map(item => item === card ? next : item) }
  })

  const queue = (id: string, prepare: (card: BoardCard) => BoardCard | undefined) => change(current => {
    const card = current.cards.find(item => item.id === id)
    const next = card && prepare(card)
    if (!next) return current
    const latest = current.cards.reduce((value, item) => Math.max(value, item.queuedAt ?? 0), 0)
    const queued: BoardCard = { ...next, status: 'queued', queuedAt: Math.max(Date.now(), latest + 1), runId: undefined, error: undefined }
    return { ...current, cards: current.cards.map(item => item === card ? queued : item) }
  })

  return {
    initialize, change, updateCard,
    async withMaintenance<T>(action: () => Promise<T>) {
      if (maintenance) throw new Error('Data maintenance in progress')
      maintenance = true
      try { await pending; return await action() }
      finally { maintenance = false }
    },
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async add(title: string, description: string) {
      title = title.trim()
      description = description.trim()
      if (!title || title.length > 120 || description.length > 20_000) throw new Error('Invalid task title or description')
      const id = crypto.randomUUID()
      await change(current => ({ ...current, cards: [...current.cards, { id, title, description, status: 'todo' }] }))
      return id
    },
    setPaused: (paused: boolean) => change(current => ({ ...current, paused })),
    remove: (id: string) => change(current => {
      const card = current.cards.find(item => item.id === id)
      if (!card) return current
      if (card.status === 'running') throw new Error('Stop the running task before deleting it')
      return { ...current, cards: current.cards.filter(item => item.id !== id) }
    }),
    delegate: (id: string, authorization: BoardAuthorization) => queue(id, card => card.status === 'todo' ? { ...card, authorization } : undefined),
    continue: (id: string, message: string) => {
      message = message.trim()
      if (!message || message.length > 20_000) return Promise.reject(new Error('Invalid follow-up'))
      return queue(id, card => card.authorization && ['question', 'review'].includes(card.status) ? { ...card, followUp: message } : undefined)
    },
    retry: (id: string) => queue(id, card => card.status === 'stopped' && card.authorization ? card : undefined),
    withdraw: (id: string) => updateCard(id, card => ['queued', 'question', 'stopped'].includes(card.status)
      ? { id: card.id, title: card.title, description: card.description, status: 'todo' } : card),
    complete: (id: string) => updateCard(id, card => ['todo', 'review'].includes(card.status) ? { ...card, status: 'done' } : card),
  }
}
