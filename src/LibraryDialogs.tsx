import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Cross2Icon } from '@radix-ui/react-icons'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { changeLibrary, libraryHistory, type LibraryDocument } from './document-library'
import './library-management.css'

export function LibraryDialog({ title, children, onClose, busy = false, wide = false }: { title: string; children: ReactNode; onClose(): void; busy?: boolean; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const zh = document.documentElement.lang.startsWith('zh')
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close() }, [])
  return <dialog ref={dialog} className={`library-dialog ${wide ? 'library-dialog-wide' : ''}`} aria-labelledby={heading} onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }}>
    <header className="modal-header"><h2 id={heading}>{title}</h2><button type="button" className="icon-button" aria-label={zh ? '关闭' : 'Close'} disabled={busy} onClick={onClose}><Cross2Icon /></button></header>{children}
  </dialog>
}
export function DocumentPreview({ content }: { content: string }) {
  return <div className="library-preview"><Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown></div>
}
export function DocumentComparison({ before, after }: { before: string; after: string }) {
  const zh = document.documentElement.lang.startsWith('zh')
  const left = before.split('\n'); const right = after.split('\n')
  let start = 0; let end = 0
  while (start < Math.min(left.length, right.length) && left[start] === right[start]) start++
  while (end < Math.min(left.length, right.length) - start && left[left.length - end - 1] === right[right.length - end - 1]) end++
  return <div className="library-comparison">{[left, right].map((lines, side) => <section key={side}><h3>{side ? (zh ? '修改后' : 'After') : (zh ? '修改前' : 'Before')}</h3><pre>{lines.map((line, i) => <span key={i} className={i >= start && i < lines.length - end ? (side ? 'line-added' : 'line-removed') : ''}>{line || ' '}<br /></span>)}</pre></section>)}</div>
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
  return <LibraryDialog wide title={zh ? '修订文档' : 'Revise document'} busy={busy} onClose={onClose}>
    <label className="library-field">{zh ? '标题' : 'Title'}<input autoFocus value={title} maxLength={120} disabled={busy} onChange={(e) => setTitle(e.target.value)} /></label>
    {compare ? <DocumentComparison before={`# ${document.title}\n\n${document.content}`} after={`# ${title}\n\n${content}`} /> : <label className="library-field">Markdown<textarea className="library-editor" value={content} disabled={busy} onChange={(e) => setContent(e.target.value)} /></label>}
    <p className="modal-copy">{zh ? '保存为此文档的新版本，保留原有引用。来源能力再次发布时也会保留本次修订。' : 'Save a new version of this document. Existing citations and this revision remain available when its source publishes again.'}</p>
    {error && <p role="alert" className="library-error">{error}</p>}
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setCompare(!compare)}>{compare ? (zh ? '继续编辑' : 'Keep editing') : (zh ? '查看差异' : 'Compare changes')}</button><button className="primary-button" disabled={busy || !title.trim() || !content.trim() || (title === document.title && content === document.content)} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存新版本' : 'Save revision')}</button></footer>
  </LibraryDialog>
}
export function HistoryDialog({ document, language, onClose, onSaved }: { document: LibraryDocument; language: 'zh' | 'en'; onClose(): void; onSaved(): void }) {
  const zh = language === 'zh'
  const [versions, setVersions] = useState<LibraryDocument[]>([])
  const [chosen, setChosen] = useState<LibraryDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void libraryHistory(document.id).then((v) => { setVersions(v); setChosen(v[0] ?? null) }).catch((e) => setError(String(e))) }, [document.id])
  const restore = async () => {
    if (!chosen?.revision) return
    setBusy(true); setError('')
    try { await changeLibrary({ kind: 'restore-version', id: document.id, revision: chosen.revision, expected: document.revision ?? document.updatedAt }); onSaved(); onClose() }
    catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <LibraryDialog wide title={zh ? '版本历史' : 'Version history'} busy={busy} onClose={onClose}>
    <label className="library-field">{zh ? '选择版本' : 'Select a version'}<select value={chosen?.revision ?? ''} onChange={(e) => setChosen(versions.find((v) => v.revision === e.target.value) ?? null)}>{versions.map((v, i) => <option key={v.revision} value={v.revision}>{i === 0 ? (zh ? '当前版本 · ' : 'Current · ') : ''}{new Date(v.updatedAt).toLocaleString()} · {v.title}</option>)}</select></label>
    {chosen && <DocumentComparison before={`# ${document.title}\n\n${document.content}`} after={`# ${chosen.title}\n\n${chosen.content}`} />}
    <p className="modal-copy">{zh ? '恢复会创建一个新版本，当前内容仍可从历史中找回。历史版本从启用版本记录后开始保留。' : 'Restoring creates a new revision and keeps the current content in history. Versions are retained from when revision tracking was introduced.'}</p>
    {error && <p role="alert" className="library-error">{error}</p>}
    <footer className="modal-footer"><button className="primary-button" disabled={busy || !chosen || chosen.revision === versions[0]?.revision} onClick={() => void restore()}>{zh ? '恢复此版本' : 'Restore this version'}</button></footer>
  </LibraryDialog>
}
