import { useEffect, useRef, useState } from 'react'
import { Cross2Icon } from '@radix-ui/react-icons'
import { changeLibrary, libraryHistory, readLibraryDocument, type LibraryDocument } from '../../platform/document-library.ts'

export function LibraryHistoryPanel({ document, selectedRevision, language, onSelect, onRestored, onClose }: { document: LibraryDocument; selectedRevision?: string; language: 'zh' | 'en'; onSelect(version: LibraryDocument): void; onRestored(version: LibraryDocument): void; onClose(): void }) {
  const zh = language === 'zh'
  const [versions, setVersions] = useState<LibraryDocument[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const closeButton = useRef<HTMLButtonElement>(null)
  const active = useRef(true)
  const select = useRef(onSelect); select.current = onSelect
  useEffect(() => { active.current = true; closeButton.current?.focus(); return () => { active.current = false } }, [])
  useEffect(() => {
    let current = true; setError(''); setVersions([])
    void libraryHistory(document.id).then(next => {
      if (!current) return
      setVersions(next); select.current(next[0] ?? document)
    }).catch(reason => { if (current) setError(String(reason)) })
    return () => { current = false }
  }, [document.id, document.revision, document.updatedAt])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !event.defaultPrevented && !window.document.querySelector('dialog[open], :popover-open')) { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [busy, onClose])
  const chosen = versions.find(version => version.revision === selectedRevision) ?? versions[0]
  const restore = async () => {
    if (!chosen?.revision || !versions[0]?.revision || busy) return
    setBusy(true); setError('')
    try {
      await changeLibrary({ kind: 'restore-version', id: document.id, revision: chosen.revision, expected: versions[0].revision })
      const restored = await readLibraryDocument(document.id)
      if (active.current) onRestored(restored)
    } catch (reason) { if (active.current) setError(String(reason)) }
    finally { if (active.current) setBusy(false) }
  }
  return <aside className="library-history-panel" aria-label={zh ? '版本历史' : 'Version history'} aria-busy={busy}>
    <header><h2>{zh ? '版本历史' : 'Version history'}</h2><button ref={closeButton} type="button" className="icon-button" aria-label={zh ? '关闭版本历史' : 'Close version history'} disabled={busy} onClick={onClose}><Cross2Icon /></button></header>
    <p className="library-history-hint">{zh ? '最近 10 个版本，点击即可预览。' : 'The latest 10 versions. Select one to preview.'}</p>
    <nav aria-label={zh ? '选择版本' : 'Select a version'}>{versions.map((version, index) => <button type="button" key={version.revision} aria-pressed={chosen?.revision === version.revision} disabled={busy} onClick={() => onSelect(version)}><strong>{index === 0 ? (zh ? '当前版本' : 'Current version') : (zh ? `历史版本 ${versions.length - index}` : `Revision ${versions.length - index}`)}</strong><time>{new Date(version.updatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time></button>)}</nav>
    {!versions.length && !error && <p role="status">{zh ? '正在读取版本…' : 'Loading versions…'}</p>}
    {error && <p role="alert" className="library-error">{error}</p>}
    <footer><button type="button" className="primary-button" disabled={busy || !chosen || chosen.revision === versions[0]?.revision} onClick={() => { void restore() }}>{busy ? (zh ? '恢复中…' : 'Restoring…') : (zh ? '恢复此版本' : 'Restore this version')}</button></footer>
  </aside>
}
