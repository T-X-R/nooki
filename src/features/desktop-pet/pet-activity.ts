import type { BoardStatus } from '../task-board/task-board-store.ts'

export type PetTask = {
  id: string
  title: string
  status: BoardStatus
  threadId?: string
  archived?: boolean
  activeTurn?: boolean
  needsInput?: boolean
  goalActive?: boolean
  deliveryTurnId?: string | null
}
export type PetStatus = BoardStatus | 'idle' | 'queuePaused'
export type PetBoard = { cards: PetTask[]; paused?: boolean }

const priority: Record<BoardStatus, number> = { question: 0, blocked: 1, usageLimited: 1, budgetLimited: 1, review: 2, running: 3, pausing: 3, stopping: 3, queued: 4, paused: 5, stopped: 5, todo: 6, done: 6 }

export function petActivity(board: PetBoard, isDeliveryRead: (taskId: string, turnId: string) => boolean = () => false): { status: PetStatus; tasks: PetTask[] } {
  const tasks = board.cards.filter(task => !task.archived).map(task => {
    let status = task.status
    if (task.needsInput) status = 'question'
    else if ((task.activeTurn || task.goalActive) && priority[status] > priority.review && !['pausing', 'stopping'].includes(status)) status = 'running'
    return { ...task, status }
  }).filter(task => task.status !== 'todo' && task.status !== 'done')
    .sort((a, b) => priority[a.status] - priority[b.status])
  const next = tasks.find(task => task.status !== 'review' || (task.deliveryTurnId && !isDeliveryRead(task.id, task.deliveryTurnId)))
  const status: PetStatus = next?.status ?? 'idle'
  return { tasks, status: board.paused && (status === 'queued' || status === 'idle') ? 'queuePaused' : status }
}

export const petStatusLabels: Record<PetStatus, [string, string]> = {
  idle: ['空闲', 'Idle'], todo: ['待办', 'To do'], queued: ['等待执行', 'Queued'], queuePaused: ['自动接取已暂停', 'Auto-pickup paused'],
  running: ['执行中', 'Working'], question: ['需要你处理', 'Needs input'], review: ['待验收', 'Ready for review'],
  blocked: ['任务受阻', 'Blocked'], usageLimited: ['额度受限', 'Usage limited'], budgetLimited: ['预算受限', 'Budget limited'],
  pausing: ['正在暂停', 'Pausing'], stopping: ['正在停止', 'Stopping'], paused: ['已暂停', 'Paused'], stopped: ['已停止', 'Stopped'], done: ['已验收', 'Accepted'],
}
