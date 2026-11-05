import type { TaskRecord } from '../../../packages/capability-contract/src/index.ts'
import type { BoardCard, BoardDelivery, createTaskBoard } from './task-board-store.ts'

type Execution = Pick<TaskRecord, 'status'> & Partial<Pick<TaskRecord, 'error'>>
type Dependencies = {
  find(runId: string): Execution | undefined
  createThread(card: BoardCard): Promise<string>
  start(card: BoardCard, runId: string): Promise<void>
  delivery(runId: string): Promise<BoardDelivery>
  stop(runId: string): Promise<void>
}

// One serialized coordinator owns claims and stops. A persisted claim without a matching
// execution is an interrupted handoff, so a restart can never resend its prompt implicitly.
export function createBoardDispatcher(board: ReturnType<typeof createTaskBoard>, dependencies: Dependencies) {
  let pending: Promise<unknown> = Promise.resolve()
  function serialize<T>(operation: () => Promise<T>) {
    const next = pending.then(operation)
    pending = next.catch(() => undefined)
    return next
  }

  const finish = (card: BoardCard, patch: Partial<BoardCard>) => board.updateCard(card.id, current =>
    current.status === 'running' && current.runId === card.runId ? { ...current, ...patch } : current)

  async function reconcile(available: boolean) {
    await board.initialize()
    const running = board.snapshot().cards.find(card => card.status === 'running')
    if (running) {
      const record = running.runId ? dependencies.find(running.runId) : undefined
      if (record?.status === 'running') return
      let delivery: BoardDelivery | undefined
      let error = record?.error ?? (record?.status === 'cancelled' ? 'Task stopped' : 'Execution interrupted. Review the conversation before retrying.')
      if (record?.status === 'completed' && running.runId) {
        try { delivery = await dependencies.delivery(running.runId) }
        catch (reason) { error = String(reason) }
      }
      await finish(running, delivery
        ? { status: delivery.question ? 'question' : 'review', delivery, followUp: undefined, error: undefined }
        : { status: 'stopped', error })
    }
    if (!available) return
    const runId = crypto.randomUUID()
    let claimed: BoardCard | undefined
    await board.change(state => {
      if (state.paused || state.cards.some(card => card.status === 'running')) return state
      const card = state.cards.filter(item => item.status === 'queued' && item.authorization)
        .sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0))[0]
      if (!card) return state
      const next: BoardCard = { ...card, status: 'running', runId }
      claimed = next
      return { ...state, cards: state.cards.map(item => item === card ? next : item) }
    })
    if (!claimed) return
    try {
      const threadId = claimed.threadId ?? await dependencies.createThread(claimed)
      if (!claimed.threadId) await finish(claimed, { threadId })
      await dependencies.start({ ...claimed, threadId }, runId)
    } catch (error) {
      await finish(claimed, { status: 'stopped', error: String(error) })
    }
  }

  async function stop(id: string) {
    const card = board.snapshot().cards.find(item => item.id === id && item.status === 'running')
    if (!card) return
    if (card.runId && dependencies.find(card.runId)?.status === 'running') await dependencies.stop(card.runId)
    await finish(card, { status: 'stopped', error: undefined })
  }

  return {
    reconcile: (available: boolean) => serialize(() => reconcile(available)),
    stop: (id: string) => serialize(() => stop(id)),
    remove: (id: string) => serialize(async () => {
      await stop(id)
      await board.remove(id)
    }),
  }
}
