import { useEffect, useRef, useState } from 'react'
import { changeLibrary, type Organization } from '../../platform/document-library.ts'
import { folderOptions } from '../../platform/library-folders.ts'
import { LibraryDialog, DocumentPreview } from './LibraryDialogs.tsx'

type ImportDraft = { key: string; title: string; content: string; documentDate: string; saved?: boolean }
export type LibraryCreation = { kind: 'document' | 'import'; folderId?: string }
export function LibraryManager({ language, organization, onOpen, creation, onCloseCreation, refresh }: {
  language: 'zh' | 'en'; organization: Organization; onOpen(id: string): void
  creation: LibraryCreation | null; onCloseCreation(): void; refresh(): void
}) {
  const zh = language === 'zh'
  const [imports, setImports] = useState<ImportDraft[] | null>(null)
  const [active, setActive] = useState(0)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const destinations = folderOptions(organization.folders ?? [], zh ? '我的资料' : 'My documents')
  const location = destinations.find(folder => folder.id === creation?.folderId)?.name ?? destinations[0].name
  useEffect(() => {
    const input = fileInput.current!
    input.addEventListener('cancel', onCloseCreation)
    if (creation?.kind === 'import') input.click()
    return () => input.removeEventListener('cancel', onCloseCreation)
  }, [creation])
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await fn(); refresh() } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const loadFiles = (files: File[]) => void act(async () => {
    if (!files.length) return
    if (files.length > 50 || files.some((f) => !/\.(md|txt)$/i.test(f.name) || f.size > 2_000_000)) throw new Error(zh ? '请选择最多 50 个 Markdown/TXT 文件，每个不超过 2 MB。' : 'Choose up to 50 Markdown/TXT files, each under 2 MB.')
    const drafts = await Promise.all(files.map(async (file): Promise<ImportDraft> => ({ key: crypto.randomUUID(), title: file.name.replace(/\.(md|txt)$/i, ''), content: await file.text(), documentDate: new Date().toLocaleDateString('en-CA') })))
    setImports(drafts); setActive(0); setPreview(false)
  })
  const draft = imports?.[active]
  const setDraft = (patch: Partial<ImportDraft>) => setImports((rows) => rows?.map((row, i) => i === active ? { ...row, ...patch } : row) ?? null)
  const importAll = () => void act(async () => {
    if (!imports) return
    for (const row of imports) {
      if (row.saved) continue
      const doc = await changeLibrary({ kind: 'import', folderId: creation?.folderId, document: { ...row, collectionKey: 'imports', collectionName: 'Imports' } })
      row.saved = true
      setImports([...imports])
      if (doc) onOpen(doc.id)
    }
    setImports(null); onCloseCreation(); setNotice(zh ? '资料已导入当前文件夹。' : 'Documents imported into this folder.')
  })
  return <>
    <input ref={fileInput} hidden type="file" accept=".md,.txt,text/plain,text/markdown" multiple onChange={(event) => { loadFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    {!imports && error && <p role="alert" className="library-error">{error}</p>}{notice && <p role="status" className="library-notice">{notice}</p>}
    {imports && <LibraryDialog wide className="library-import-dialog" busy={busy} title={zh ? '导入资料' : 'Import documents'} onClose={() => { setImports(null); onCloseCreation() }}>
      <p className="library-create-location">{zh ? '导入到' : 'Import into'} <strong>{location}</strong></p>
      {imports.length > 1 && <select aria-label={zh ? '预览文件' : 'Preview file'} value={active} disabled={busy} onChange={(e) => setActive(Number(e.target.value))}>{imports.map((row, i) => <option key={row.key} value={i}>{row.saved ? '✓ ' : ''}{row.title}</option>)}</select>}
      {draft && <><div className="library-editor-heading"><label className="library-field">{zh ? '标题' : 'Title'}<input autoFocus value={draft.title} disabled={busy || draft.saved} maxLength={120} onChange={(e) => setDraft({ title: e.target.value })} /></label><label className="library-field">{zh ? '日期' : 'Date'}<input type="date" value={draft.documentDate} disabled={busy || draft.saved} onChange={(e) => setDraft({ documentDate: e.target.value })} /></label></div><div className="library-import-body">{preview ? <section><h3>{zh ? '正文预览' : 'Content preview'}</h3><DocumentPreview content={draft.content} /></section> : <label className="library-field">{zh ? '正文' : 'Content'}<textarea className="library-editor" value={draft.content} disabled={busy || draft.saved} placeholder={zh ? '粘贴或编辑 Markdown / 纯文本…' : 'Paste or edit Markdown / plain text…'} onChange={(e) => setDraft({ content: e.target.value })} /></label>}</div></>}
      {error && <p role="alert" className="library-error">{error}</p>}
      <footer className="modal-footer"><button className="secondary-button" onClick={() => setPreview(!preview)}>{preview ? (zh ? '编辑' : 'Edit') : (zh ? '预览' : 'Preview')}</button><button className="primary-button" disabled={busy || imports.some((row) => !row.title.trim() || !row.content.trim() || !row.documentDate)} onClick={importAll}>{busy ? (zh ? '导入中…' : 'Importing…') : (zh ? `导入 ${imports.filter((row) => !row.saved).length} 篇资料` : `Import ${imports.filter((row) => !row.saved).length} documents`)}</button></footer>
    </LibraryDialog>}
  </>
}
