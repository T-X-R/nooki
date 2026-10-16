import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Cross2Icon, DownloadIcon, TrashIcon } from '@radix-ui/react-icons'
import { changeLibrary, libraryTrash, type LibraryDocumentMetadata, type Organization } from '../../platform/document-library.ts'
import { folderOptions } from '../../platform/library-folders.ts'
import { DestinationSelect } from '../../shared/DestinationSelect.tsx'
import { LibraryDialog, DocumentPreview, DeleteDocumentsDialog } from './LibraryDialogs.tsx'
import { exportMarkdown } from '../../platform/user-data.ts'
import { CreateDocumentDialog } from './CreateDocumentDialog.tsx'

type ImportDraft = { key: string; title: string; content: string; documentDate: string; saved?: boolean }
export type LibraryCreation = { kind: 'document' | 'import'; folderId?: string }
export function LibraryManager({ language, organization, selected, onOpen, creation, onCloseCreation, showTrash, onCloseTrash, refresh, selectionActions, onClear }: {
  language: 'zh' | 'en'; organization: Organization; selected: string[]; onOpen(id: string): void
  creation: LibraryCreation | null; onCloseCreation(): void; showTrash: boolean; onCloseTrash(): void; refresh(): void
  selectionActions: ReactNode; onClear(): void
}) {
  const zh = language === 'zh'
  const [moving, setMoving] = useState(false)
  const [sectionId, setSectionId] = useState('')
  const [imports, setImports] = useState<ImportDraft[] | null>(null)
  const [active, setActive] = useState(0)
  const [preview, setPreview] = useState(false)
  const [trash, setTrash] = useState<LibraryDocumentMetadata[] | null>(null)
  const [trashIds, setTrashIds] = useState<string[]>([])
  const [confirm, setConfirm] = useState<'trash' | 'purge' | null>(null)
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
  useEffect(() => { if (showTrash) void libraryTrash().then(value => { setTrash(value); setTrashIds([]) }).catch(reason => setError(String(reason))) }, [showTrash])
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
    {creation?.kind === 'document' && <CreateDocumentDialog language={language} folderId={creation.folderId} location={location} onClose={onCloseCreation} onCreated={(id) => { refresh(); onOpen(id) }} />}
    {!!selected.length && <div className="library-batch-actions"><span className="library-selection-count">{zh ? `已选 ${selected.length} 篇` : `${selected.length} selected`}</span><button className="icon-button" aria-label={zh ? '取消选择' : 'Clear selection'} onClick={onClear}><Cross2Icon /></button><button className="quiet-button" disabled={busy} onClick={() => { setSectionId(''); setMoving(true); setError('') }}>{zh ? '移动到' : 'Move to'}</button><button className="quiet-button" disabled={busy} onClick={() => void act(async () => setNotice(await exportMarkdown(selected)))}><DownloadIcon />{zh ? '导出' : 'Export'}</button><button className="quiet-button library-delete-action" disabled={busy} onClick={() => setConfirm('trash')}><TrashIcon />{zh ? '删除' : 'Delete'}</button><div className="library-selection-actions">{selectionActions}</div></div>}
    {moving && <LibraryDialog title={zh ? '移动资料' : 'Move documents'} busy={busy} onClose={() => setMoving(false)}><p className="modal-copy">{zh ? `将所选 ${selected.length} 篇资料移到文件夹，保留内容和版本历史。` : `Move ${selected.length} documents, keeping content and revision history.`}</p><DestinationSelect label={zh ? '文件夹' : 'Folder'} autoFocus options={destinations} value={sectionId} disabled={busy} onChange={setSectionId} />{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setMoving(false)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy} onClick={() => void act(async () => { await changeLibrary({ kind: 'move-documents', ids: selected, folderId: sectionId || undefined }); setMoving(false); onClear() })}>{zh ? '移动资料' : 'Move documents'}</button></footer></LibraryDialog>}
    {!imports && !trash && !moving && error && <p role="alert" className="library-error">{error}</p>}{notice && <p role="status" className="library-notice">{notice}</p>}
    {imports && <LibraryDialog wide className="library-import-dialog" busy={busy} title={zh ? '导入资料' : 'Import documents'} onClose={() => { setImports(null); onCloseCreation() }}>
      <p className="library-create-location">{zh ? '导入到' : 'Import into'} <strong>{location}</strong></p>
      {imports.length > 1 && <select aria-label={zh ? '预览文件' : 'Preview file'} value={active} disabled={busy} onChange={(e) => setActive(Number(e.target.value))}>{imports.map((row, i) => <option key={row.key} value={i}>{row.saved ? '✓ ' : ''}{row.title}</option>)}</select>}
      {draft && <><div className="library-editor-heading"><label className="library-field">{zh ? '标题' : 'Title'}<input autoFocus value={draft.title} disabled={busy || draft.saved} maxLength={120} onChange={(e) => setDraft({ title: e.target.value })} /></label><label className="library-field">{zh ? '日期' : 'Date'}<input type="date" value={draft.documentDate} disabled={busy || draft.saved} onChange={(e) => setDraft({ documentDate: e.target.value })} /></label></div><div className="library-import-body">{preview ? <section><h3>{zh ? '正文预览' : 'Content preview'}</h3><DocumentPreview content={draft.content} /></section> : <label className="library-field">{zh ? '正文' : 'Content'}<textarea className="library-editor" value={draft.content} disabled={busy || draft.saved} placeholder={zh ? '粘贴或编辑 Markdown / 纯文本…' : 'Paste or edit Markdown / plain text…'} onChange={(e) => setDraft({ content: e.target.value })} /></label>}</div></>}
      {error && <p role="alert" className="library-error">{error}</p>}
      <footer className="modal-footer"><button className="secondary-button" onClick={() => setPreview(!preview)}>{preview ? (zh ? '编辑' : 'Edit') : (zh ? '预览' : 'Preview')}</button><button className="primary-button" disabled={busy || imports.some((row) => !row.title.trim() || !row.content.trim() || !row.documentDate)} onClick={importAll}>{busy ? (zh ? '导入中…' : 'Importing…') : (zh ? `导入 ${imports.filter((row) => !row.saved).length} 篇资料` : `Import ${imports.filter((row) => !row.saved).length} documents`)}</button></footer>
    </LibraryDialog>}
    {trash && <LibraryDialog title={zh ? '回收站' : 'Trash'} busy={busy} onClose={() => { setTrash(null); onCloseTrash() }}><p className="modal-copy">{zh ? '这里管理资料库副本。来源能力的内部记录和历史引用快照会保留；永久删除后版本历史无法恢复。' : 'Manage Library copies here. Capability records and historical citation snapshots are retained. Permanent deletion also removes revision history.'}</p><div className="library-trash-list">{trash.map((doc) => <label key={doc.id}><input type="checkbox" disabled={busy} checked={trashIds.includes(doc.id)} onChange={() => setTrashIds((ids) => ids.includes(doc.id) ? ids.filter((id) => id !== doc.id) : [...ids, doc.id])} /><span><strong>{doc.title}</strong><small>{doc.capabilityName} · {doc.documentDate}</small></span></label>)}{!trash.length && <p className="library-trash-empty">{zh ? '暂无已删除资料' : 'No deleted documents'}</p>}</div>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy || !trashIds.length} onClick={() => setConfirm('purge')}>{zh ? '永久删除' : 'Delete permanently'}</button><button className="primary-button" disabled={busy || !trashIds.length} onClick={() => void act(async () => { await changeLibrary({ kind: 'restore', ids: trashIds }); setTrash(await libraryTrash()); setTrashIds([]) })}>{zh ? '恢复' : 'Restore'}</button></footer></LibraryDialog>}
    {confirm === 'trash' && <DeleteDocumentsDialog ids={selected} language={language} onClose={() => setConfirm(null)} onDeleted={() => { onClear(); refresh() }} />}
    {confirm === 'purge' && <LibraryDialog title={zh ? '永久删除资料' : 'Delete documents permanently'} busy={busy} onClose={() => setConfirm(null)}><p className="modal-copy">{zh ? `永久删除 ${trashIds.length} 篇资料及版本历史？此操作无法撤销。` : `Permanently delete ${trashIds.length} documents and their revision history? This cannot be undone.`}</p><footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setConfirm(null)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button danger-button" disabled={busy} onClick={() => void act(async () => { await changeLibrary({ kind: 'purge', ids: trashIds }); setTrash(await libraryTrash()); setTrashIds([]); setConfirm(null) })}>{zh ? '永久删除' : 'Delete permanently'}</button></footer>{error && <p role="alert" className="library-error">{error}</p>}</LibraryDialog>}
  </>
}
