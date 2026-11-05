import type { BoardCard } from '../task-board/task-board-store.ts'

export function ConversationTaskCard({ task, zh, onOpen }: { task: BoardCard; zh: boolean; onOpen(id: string): void }) {
  return <div className="conversation-task-card"><button type="button" aria-label={`${zh ? '打开任务详情' : 'Open task details'}：${task.title}`} title={task.title} onClick={() => onOpen(task.id)}>{task.title}</button></div>
}
