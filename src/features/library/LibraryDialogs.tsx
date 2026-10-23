import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Cross2Icon } from '@radix-ui/react-icons'
import { changeLibrary } from '../../platform/document-library.ts'
import { documentDiff } from '../../shared/document-diff.ts'
import './library-management.css'

export function LibraryDialog({ title, children, onClose, busy = false, wide = false, className = '' }: { title: string; children: ReactNode; onClose(): void; busy?: boolean; wide?: boolean; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const zh = document.documentElement.lang.startsWith('zh')
  useEffect(() => { const el = dialog.current!; const previous = document.activeElement; el.showModal(); el.querySelector<HTMLElement>('input:not([type=checkbox]), textarea')?.focus(); return () => { el.close(); if (previous instanceof HTMLElement) previous.focus() } }, [])
  return createPortal(<dialog ref={dialog} className={`library-dialog ${wide ? 'library-dialog-wide' : ''} ${className}`} aria-labelledby={heading} onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }}>
    <header className="modal-header"><h2 id={heading}>{title}</h2><button type="button" className="icon-button" aria-label={zh ? '关闭' : 'Close'} disabled={busy} onClick={onClose}><Cross2Icon /></button></header>{children}
  </dialog>, document.body)
}
export function DocumentComparison({ before, after }: { before: string; after: string }) {
  const zh = document.documentElement.lang.startsWith('zh')
  const lines = documentDiff(before, after)
  return <div className="library-diff" aria-label={zh ? '修改差异' : 'Changes'}><div className="library-diff-heading"><h3>{zh ? '修改差异' : 'Changes'}</h3><span>{zh ? '− 删除 · + 新增' : '− Removed · + Added'}</span></div><div className="library-diff-lines">{lines.map((line, i) => <div key={i} className={`library-diff-line line-${line.kind}`}><span className="library-diff-number">{line.before}</span><span className="library-diff-number">{line.after}</span><span aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span><code>{line.text || ' '}</code></div>)}</div></div>
}
export function DeleteDocumentsDialog({ ids, language, onClose, onDeleted }: { ids: string[]; language: 'zh' | 'en'; onClose(): void; onDeleted(): void }) {
  const zh = language === 'zh'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <LibraryDialog title={zh ? '删除资料' : 'Delete documents'} busy={busy} onClose={onClose}><p className="modal-copy">{zh ? `永久删除 ${ids.length} 篇资料及其版本历史？删除后不可恢复。` : `Permanently delete ${ids.length} documents and their revision history? This cannot be undone.`}</p>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button danger-button" disabled={busy || !ids.length} onClick={() => { setBusy(true); void changeLibrary({ kind: 'delete-documents', ids }).then(() => { onDeleted(); onClose() }).catch((e) => setError(String(e))).finally(() => setBusy(false)) }}>{zh ? '永久删除' : 'Delete permanently'}</button></footer></LibraryDialog>
}
