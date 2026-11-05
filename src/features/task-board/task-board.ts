import { invoke } from '@tauri-apps/api/core'
import { createTaskBoard, type BoardState } from './task-board-store.ts'

const key = 'personal-workbench-task-board'

const localBoard = createTaskBoard({
  read: async () => window.__TAURI_INTERNALS__
    ? invoke<BoardState | null>('task_board_read')
    : JSON.parse(localStorage.getItem(key) ?? 'null'),
  write: async (state) => {
    if (window.__TAURI_INTERNALS__) return invoke<BoardState>('task_board_write', { board: state })
    else localStorage.setItem(key, JSON.stringify(state))
  },
})

const native = () => !!window.__TAURI_INTERNALS__
const isGoal = (id: string) => localBoard.snapshot().cards.some(card => card.id === id && card.engine === 'goals')
let commands: Promise<unknown> = Promise.resolve()
export function goalCommand(request: Record<string, unknown>) {
  const next = commands.then(async () => {
    const result = await invoke<BoardState>('task_board_command', { request })
    localBoard.replace(result)
    return result
  })
  commands = next.catch(() => undefined)
  return next
}
export const taskBoard = {
  ...localBoard,
  async add(title: string, description: string, sources: import('./task-board-store.ts').BoardSource[] = [], cwd = '') {
    if (!native()) return localBoard.add(title, description, sources)
    const id = crypto.randomUUID()
    await goalCommand({ op: 'add', id, title: title.trim(), description: description.trim(), sources, cwd })
    return id
  },
  setPaused: (paused: boolean) => native() ? goalCommand({ op: 'queue-pause', paused }).then(() => {}) : localBoard.setPaused(paused),
  complete: (id: string) => isGoal(id) ? goalCommand({ op: 'accept', id }).then(() => {}) : localBoard.complete(id),
  continue: (id: string, message: string) => isGoal(id) ? goalCommand({ op: 'feedback', id, message }).then(() => {}) : localBoard.continue(id, message),
  retry: (id: string) => isGoal(id) ? goalCommand({ op: 'resume', id }).then(() => {}) : localBoard.retry(id),
  remove: (id: string) => isGoal(id) ? goalCommand({ op: 'remove', id }).then(() => {}) : localBoard.remove(id),
}
