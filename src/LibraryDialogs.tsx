import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Cross2Icon } from '@radix-ui/react-icons'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { changeLibrary, libraryHistory, type LibraryDocument } from './document-library'
import { documentDiff } from './document-diff'
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
export function DocumentPreview({ content }: { content: string }) {
  return <div className="library-preview library-reader-content"><Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown></div>
}
export function DocumentComparison({ before, after }: { before: string; after: string }) {
  const zh = document.documentElement.lang.startsWith('zh')
  const lines = documentDiff(before, after)
  return <div className="library-diff" aria-label={zh ? '修改差异' : 'Changes'}><div className="library-diff-heading"><h3>{zh ? '修改差异' : 'Changes'}</h3><span>{zh ? '− 删除 · + 新增' : '− Removed · + Added'}</span></div><div className="library-diff-lines">{lines.map((line, i) => <div key={i} className={`library-diff-line line-${line.kind}`}><span className="library-diff-number">{line.before}</span><span className="library-diff-number">{line.after}</span><span aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span><code>{line.text || ' '}</code></div>)}</div></div>
}
export function EditDocumentDialog({ document, language, onClose, onSaved }: { document: LibraryDocument; language: 'zh' | 'en'; onClose(): void; onSaved(): void }) {
  const zh = language === 'zh'
  const [title, setTitle] = useState(document.title)
  const [content, setContent] = useState(document.content)
  const [compare, setCompare] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try { await changeLibrary({ kind: 'edit', id: document.id, title, content, expected: document.revision ?? document.updatedAt }); onSaved(); onClose() }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <LibraryDialog wide className="library-revision-dialog" title={zh ? '修订文档' : 'Revise document'} busy={busy} onClose={onClose}>
    <label className="library-field">{zh ? '标题' : 'Title'}<input autoFocus value={title} maxLength={120} disabled={busy} onChange={(e) => setTitle(e.target.value)} /></label>
    <div className="library-revision-body">{compare ? <DocumentComparison before={`# ${document.title}\n\n${document.content}`} after={`# ${title}\n\n${content}`} /> : <div className="library-edit-split"><label className="library-field">{zh ? '编辑 Markdown' : 'Edit Markdown'}<textarea className="library-editor" value={content} disabled={busy} onChange={(e) => setContent(e.target.value)} /></label><section><h3>{zh ? '实时预览' : 'Live preview'}</h3><DocumentPreview content={content} /></section></div>}</div>
    {error && <p role="alert" className="library-error">{error}</p>}
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setCompare(!compare)}>{compare ? (zh ? '继续编辑' : 'Keep editing') : (zh ? '对比修改' : 'Compare changes')}</button><button className="primary-button" disabled={busy || !title.trim() || !content.trim() || (title === document.title && content === document.content)} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存新版本' : 'Save revision')}</button></footer>
  </LibraryDialog>
}
export function HistoryDialog({ document, language, onClose, onSaved }: { document: LibraryDocument; language: 'zh' | 'en'; onClose(): void; onSaved(): void }) {
  const zh = language === 'zh'
  const [versions, setVersions] = useState<LibraryDocument[]>([])
  const [chosen, setChosen] = useState<LibraryDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { let current = true; void libraryHistory(document.id).then((v) => { if (current) { setVersions(v); setChosen(v[0] ?? null) } }).catch((e) => { if (current) setError(String(e)) }); return () => { current = false } }, [document.id])
  const restore = async () => {
    if (!chosen?.revision) return
    setBusy(true); setError('')
    try { await changeLibrary({ kind: 'restore-version', id: document.id, revision: chosen.revision, expected: document.revision ?? document.updatedAt }); onSaved(); onClose() }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <LibraryDialog wide title={zh ? '版本历史' : 'Version history'} busy={busy} onClose={onClose}>
    <div className="library-history-layout"><nav aria-label={zh ? '选择版本' : 'Select a version'}>{versions.map((v, i) => <button key={v.revision} className={chosen?.revision === v.revision ? 'is-active' : ''} aria-pressed={chosen?.revision === v.revision} disabled={busy} onClick={() => setChosen(v)}><strong>{i === 0 ? (zh ? '当前版本' : 'Current version') : (zh ? `历史版本 ${versions.length - i}` : `Revision ${versions.length - i}`)}</strong><time>{new Date(v.updatedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</time></button>)}</nav><section>{chosen ? <><h3>{chosen.title}</h3><DocumentPreview content={chosen.content} /></> : <p className="modal-copy">{zh ? '正在读取版本…' : 'Loading revisions…'}</p>}</section></div>
    {error && <p role="alert" className="library-error">{error}</p>}
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '关闭' : 'Close'}</button><button className="primary-button" disabled={busy || !chosen || chosen.revision === versions[0]?.revision} onClick={() => void restore()}>{zh ? '恢复此版本' : 'Restore this version'}</button></footer>
  </LibraryDialog>
}
export function DeleteDocumentsDialog({ ids, language, onClose, onDeleted }: { ids: string[]; language: 'zh' | 'en'; onClose(): void; onDeleted(): void }) {
  const zh = language === 'zh'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <LibraryDialog title={zh ? '删除资料' : 'Delete documents'} busy={busy} onClose={onClose}><p className="modal-copy">{zh ? `将 ${ids.length} 篇资料移入回收站，之后可以恢复。` : `Move ${ids.length} documents to Trash. You can restore them later.`}</p>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button danger-button" disabled={busy || !ids.length} onClick={() => { setBusy(true); void changeLibrary({ kind: 'trash', ids }).then(() => { onDeleted(); onClose() }).catch((e) => setError(String(e))).finally(() => setBusy(false)) }}>{zh ? '移入回收站' : 'Move to Trash'}</button></footer></LibraryDialog>
}
