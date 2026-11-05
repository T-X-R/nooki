import { invoke } from '@tauri-apps/api/core'
import { createTaskBoard, type BoardState } from './task-board-store.ts'

const key = 'personal-workbench-task-board'

export const taskBoard = createTaskBoard({
  read: async () => window.__TAURI_INTERNALS__
    ? invoke<BoardState | null>('task_board_read')
    : JSON.parse(localStorage.getItem(key) ?? 'null'),
  write: async (state) => {
    if (window.__TAURI_INTERNALS__) await invoke('task_board_write', { board: state })
    else localStorage.setItem(key, JSON.stringify(state))
  },
})
