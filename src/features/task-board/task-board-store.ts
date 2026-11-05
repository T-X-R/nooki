export type BoardStatus = 'todo' | 'queued' | 'running' | 'question' | 'review' | 'stopped' | 'done'

export type BoardCard = {
  id: string
  title: string
  description: string
  status: BoardStatus
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
  const listeners = new Set<() => void>()
  const publish = (next: BoardState) => {
    state = next
    listeners.forEach(listener => listener())
  }
  const initialize = () => initialization ??= storage.read().then(saved => {
    if (saved) publish(saved)
  }).catch(error => {
    initialization = undefined
    throw error
  })
  const change = (update: (current: BoardState) => BoardState) => {
    const operation = pending.then(async () => {
      await initialize()
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

  return {
    initialize, change, updateCard,
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
    complete: (id: string) => updateCard(id, card => ['todo', 'review'].includes(card.status) ? { ...card, status: 'done' } : card),
  }
}
