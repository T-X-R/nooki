import { Cross2Icon } from '@radix-ui/react-icons'
import type { BoardSource } from './task-board-store.ts'

export function TaskReferences({ zh, sources, snapshotId, onRemove }: { zh: boolean; sources: BoardSource[]; snapshotId?: string; onRemove?(id: string): void }) {
  if (!sources.length) return null
  return <div className="task-board-references" aria-label={zh ? '已引用文件' : 'Referenced files'}>{sources.map(source => <div className="task-board-reference-file" key={source.id}>
    <span className="task-board-reference-type" aria-hidden="true">MD</span>
    <button type="button" className="task-board-reference-name" title={source.title} aria-label={`${zh ? '打开引用' : 'Open reference'} ${source.title}`} onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-document', { detail: { ...(source.reference ?? { kind: 'library-document', documentId: source.id, title: source.title }), ...(snapshotId ? { snapshotId } : {}) } }))}>{source.title}</button>
    {onRemove && <button className="task-board-reference-remove" type="button" aria-label={`${zh ? '移除引用' : 'Remove reference'} ${source.title}`} onClick={() => onRemove(source.id)}><Cross2Icon /></button>}
  </div>)}</div>
}
