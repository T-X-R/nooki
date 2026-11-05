import { FileTextIcon } from '@radix-ui/react-icons'
import type { DocumentReference } from '../../../packages/capability-contract/src/index.ts'
import type { BoardCard } from '../task-board/task-board-store.ts'

export function ConversationTaskCard({ task, zh, onDocument }: { task: BoardCard; zh: boolean; onDocument(ref: DocumentReference): void }) {
  const workspace = task.execution?.cwd || task.cwd
  return <article className="conversation-task-card" aria-label={zh ? '原始任务' : 'Original task'}>
    <header>{zh ? '来自任务板' : 'From task board'}</header>
    <h2>{task.title}</h2>
    {task.description && <p>{task.description}</p>}
    {!!task.sources?.length && <div className="conversation-message-sources">{task.sources.map(source => <button key={source.id} onClick={() => onDocument({ kind: 'library-document', documentId: source.id, title: source.title })}><FileTextIcon />{source.title}</button>)}</div>}
    {workspace && <dl><dt>{zh ? '工作目录' : 'Workspace'}</dt><dd>{workspace}</dd></dl>}
  </article>
}
