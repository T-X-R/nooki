import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Cross2Icon, DownloadIcon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { changeLibrary, libraryOrganization, libraryTrash, type LibraryDocumentMetadata, type Organization, type Topic } from './document-library'
import { emptyOrganization } from './library-store'
import { buildLibraryTree } from './library-tree'
import { ConversationDestinationSelect } from './ConversationDestinationSelect'
import { LibraryDialog, DocumentPreview, DeleteDocumentsDialog } from './LibraryDialogs'
import { exportMarkdown } from './user-data'

type ImportDraft = { key: string; title: string; content: string; documentDate: string; saved?: boolean }
export function LibraryManager({ language, documents, selected, onOpen, topicId, onSelectTopic, onDiscuss, refresh, filters, selectionActions, onClear }: {
  language: 'zh' | 'en'; documents: LibraryDocumentMetadata[]; selected: string[]; onOpen(id: string): void
  topicId: string; onSelectTopic(id: string): void; onDiscuss(ids: string[]): void; refresh(): void
  filters: ReactNode; selectionActions: ReactNode; onClear(): void
}) {
  const zh = language === 'zh'
  const [organization, setOrganization] = useState<Organization>(emptyOrganization)
  const [addingToTopic, setAddingToTopic] = useState(false)
  const [moving, setMoving] = useState(false)
  const [sectionId, setSectionId] = useState('')
  const [topic, setTopic] = useState<Topic | null>(null)
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
  const sections = buildLibraryTree(documents, new Map(), organization.customSections).map((node) => ({ id: node.capabilityId, name: node.capabilityName }))
  const currentTopic = organization.topics.find((t) => t.id === topicId)
  const reload = async () => { const next = await libraryOrganization(); setOrganization(next); return next }
  useEffect(() => {
    const load = () => { void reload().catch((e) => setError(String(e))) }
    load(); window.addEventListener('workbench:library-changed', load)
    return () => window.removeEventListener('workbench:library-changed', load)
  }, [])
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await fn(); await reload(); refresh() } catch (e) { setError(String(e)) } finally { setBusy(false) }
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
      const doc = await changeLibrary({ kind: 'import', document: { ...row, collectionKey: 'imports', collectionName: 'Imports' } })
      row.saved = true
      setImports([...imports])
      if (doc) onOpen(doc.id)
    }
    setImports(null); onSelectTopic(''); setNotice(zh ? '资料已导入，可选择后加入专题或对话。' : 'Documents imported. Select them to add to a topic or conversation.')
  })
  const saveTopic = (value: Topic) => act(async () => { await changeLibrary({ kind: 'save-topic', topic: value }); setTopic(null) })
  return <>
    <div className="library-management-bar" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={(e) => { e.preventDefault(); loadFiles(Array.from(e.dataTransfer.files)) }}>
      <div className="library-management-group">
        {filters}
        {currentTopic && <button className="quiet-button" disabled={!currentTopic.documentIds.some((id) => documents.some((d) => d.id === id)) || currentTopic.documentIds.filter((id) => documents.some((d) => d.id === id)).length > 50} onClick={() => onDiscuss(currentTopic.documentIds.filter((id) => documents.some((d) => d.id === id)))}>{zh ? '讨论整个专题' : 'Discuss this topic'}</button>}
      </div>
      <div className="library-management-group">
        <button className="quiet-button" disabled={busy} onClick={() => void act(async () => { setTrash(await libraryTrash()); setTrashIds([]) })}><TrashIcon />{zh ? '回收站' : 'Trash'}</button>
        <button className="primary-button library-import-button" disabled={busy} onClick={() => fileInput.current?.click()}><PlusIcon />{zh ? '导入资料' : 'Import'}</button>
      </div>
    </div>
    <input ref={fileInput} hidden type="file" accept=".md,.txt,text/plain,text/markdown" multiple onChange={(e) => { loadFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
    {!!selected.length && <div className="library-batch-actions"><span className="library-selection-count">{zh ? `已选 ${selected.length} 篇` : `${selected.length} selected`}</span><button className="icon-button" aria-label={zh ? '取消选择' : 'Clear selection'} onClick={onClear}><Cross2Icon /></button><button className="quiet-button" disabled={busy} onClick={() => setAddingToTopic(true)}>{zh ? '加入专题' : 'Add to topic'}</button><button className="quiet-button" disabled={busy || !sections.length} onClick={() => { setSectionId(sections[0]?.id ?? ''); setMoving(true); setError('') }}>{zh ? '移至栏目' : 'Move to section'}</button>{currentTopic && <button className="quiet-button" disabled={busy} onClick={() => void saveTopic({ ...currentTopic, documentIds: currentTopic.documentIds.filter((id) => !selected.includes(id)) })}>{zh ? '移出专题' : 'Remove from topic'}</button>}<button className="quiet-button" disabled={busy} onClick={() => void act(async () => setNotice(await exportMarkdown(selected)))}><DownloadIcon />{zh ? '导出' : 'Export'}</button><button className="quiet-button library-delete-action" disabled={busy} onClick={() => setConfirm('trash')}><TrashIcon />{zh ? '删除' : 'Delete'}</button><div className="library-selection-actions">{selectionActions}</div></div>}
    {moving && <LibraryDialog title={zh ? '移至栏目' : 'Move to section'} busy={busy} onClose={() => setMoving(false)}><p className="modal-copy">{zh ? `将所选 ${selected.length} 篇资料移到同一栏目，保留专题关联和版本历史。` : `Move ${selected.length} documents to one section, keeping topic links and revision history.`}</p><ConversationDestinationSelect label={zh ? '栏目' : 'Section'} autoFocus options={sections} value={sectionId} disabled={busy} onChange={setSectionId} />{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setMoving(false)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy || !sections.some((section) => section.id === sectionId)} onClick={() => void act(async () => { const section = sections.find((section) => section.id === sectionId)!; for (const id of selected) await changeLibrary({ kind: 'place', id, section }); setMoving(false); onClear() })}>{zh ? '移动资料' : 'Move documents'}</button></footer></LibraryDialog>}
    {addingToTopic && <LibraryDialog title={zh ? '加入专题' : 'Add to topic'} busy={busy} onClose={() => setAddingToTopic(false)}><p className="modal-copy">{zh ? `将所选 ${selected.length} 篇资料关联到专题，原文位置不变。` : `Link ${selected.length} selected documents to a topic.`}</p><div className="library-topic-list">{organization.topics.map((t) => <button className="library-topic-choice" key={t.id} disabled={busy} onClick={() => void act(async () => { await changeLibrary({ kind: 'save-topic', topic: { ...t, documentIds: [...new Set([...t.documentIds, ...selected])] } }); setAddingToTopic(false) })}><span>{t.name}</span><PlusIcon /></button>)}{!organization.topics.length && <p className="library-empty-copy">{zh ? '先创建一个专题，再加入资料。' : 'Create a topic first.'}</p>}</div>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => { setAddingToTopic(false); setTopic({ id: crypto.randomUUID(), name: '', documentIds: selected }); setError('') }}>{zh ? '新建专题并加入' : 'Create topic with selection'}</button></footer></LibraryDialog>}
    {!imports && !topic && !trash && !addingToTopic && !moving && error && <p role="alert" className="library-error">{error}</p>}{notice && <p role="status" className="library-notice">{notice}</p>}
    {imports && <LibraryDialog wide className="library-import-dialog" busy={busy} title={zh ? '导入资料' : 'Import documents'} onClose={() => setImports(null)}>
      {imports.length > 1 && <select aria-label={zh ? '预览文件' : 'Preview file'} value={active} disabled={busy} onChange={(e) => setActive(Number(e.target.value))}>{imports.map((row, i) => <option key={row.key} value={i}>{row.saved ? '✓ ' : ''}{row.title}</option>)}</select>}
      {draft && <><div className="library-editor-heading"><label className="library-field">{zh ? '标题' : 'Title'}<input autoFocus value={draft.title} disabled={busy || draft.saved} maxLength={120} onChange={(e) => setDraft({ title: e.target.value })} /></label><label className="library-field">{zh ? '日期' : 'Date'}<input type="date" value={draft.documentDate} disabled={busy || draft.saved} onChange={(e) => setDraft({ documentDate: e.target.value })} /></label></div><div className="library-import-body">{preview ? <section><h3>{zh ? '正文预览' : 'Content preview'}</h3><DocumentPreview content={draft.content} /></section> : <label className="library-field">{zh ? '正文' : 'Content'}<textarea className="library-editor" value={draft.content} disabled={busy || draft.saved} placeholder={zh ? '粘贴或编辑 Markdown / 纯文本…' : 'Paste or edit Markdown / plain text…'} onChange={(e) => setDraft({ content: e.target.value })} /></label>}</div></>}
      {error && <p role="alert" className="library-error">{error}</p>}
      <footer className="modal-footer"><button className="secondary-button" onClick={() => setPreview(!preview)}>{preview ? (zh ? '编辑' : 'Edit') : (zh ? '预览' : 'Preview')}</button><button className="primary-button" disabled={busy || imports.some((row) => !row.title.trim() || !row.content.trim() || !row.documentDate)} onClick={importAll}>{busy ? (zh ? '导入中…' : 'Importing…') : (zh ? `导入 ${imports.filter((row) => !row.saved).length} 篇资料` : `Import ${imports.filter((row) => !row.saved).length} documents`)}</button></footer>
    </LibraryDialog>}
    {topic && <LibraryDialog title={zh ? '新建专题' : 'New topic'} busy={busy} onClose={() => setTopic(null)}><label className="library-field">{zh ? '专题名称' : 'Topic name'}<input autoFocus value={topic.name} maxLength={80} disabled={busy} onChange={(e) => setTopic({ ...topic, name: e.target.value })} /></label><p className="modal-copy">{zh ? `包含 ${topic.documentIds.length} 篇资料。专题关联原文，删除专题不会删除资料。` : `${topic.documentIds.length} linked documents. Deleting a topic keeps its documents.`}</p>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="primary-button" disabled={busy || !topic.name.trim()} onClick={() => void saveTopic(topic)}>{zh ? '保存专题' : 'Save topic'}</button></footer></LibraryDialog>}
    {trash && <LibraryDialog title={zh ? '回收站' : 'Trash'} busy={busy} onClose={() => setTrash(null)}><p className="modal-copy">{zh ? '这里管理资料库副本。来源能力的内部记录和历史引用快照会保留；永久删除后版本历史无法恢复。' : 'Manage Library copies here. Capability records and historical citation snapshots are retained. Permanent deletion also removes revision history.'}</p><div className="library-trash-list">{trash.map((doc) => <label key={doc.id}><input type="checkbox" disabled={busy} checked={trashIds.includes(doc.id)} onChange={() => setTrashIds((ids) => ids.includes(doc.id) ? ids.filter((id) => id !== doc.id) : [...ids, doc.id])} /><span><strong>{doc.title}</strong><small>{doc.capabilityName} · {doc.documentDate}</small></span></label>)}{!trash.length && <p className="library-trash-empty">{zh ? '暂无已删除资料' : 'No deleted documents'}</p>}</div>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy || !trashIds.length} onClick={() => setConfirm('purge')}>{zh ? '永久删除' : 'Delete permanently'}</button><button className="primary-button" disabled={busy || !trashIds.length} onClick={() => void act(async () => { await changeLibrary({ kind: 'restore', ids: trashIds }); setTrash(await libraryTrash()); setTrashIds([]) })}>{zh ? '恢复' : 'Restore'}</button></footer></LibraryDialog>}
    {confirm === 'trash' && <DeleteDocumentsDialog ids={selected} language={language} onClose={() => setConfirm(null)} onDeleted={() => { onClear(); refresh() }} />}
    {confirm === 'purge' && <LibraryDialog title={zh ? '永久删除资料' : 'Delete documents permanently'} busy={busy} onClose={() => setConfirm(null)}><p className="modal-copy">{zh ? `永久删除 ${trashIds.length} 篇资料及版本历史？此操作无法撤销。` : `Permanently delete ${trashIds.length} documents and their revision history? This cannot be undone.`}</p><footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setConfirm(null)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button danger-button" disabled={busy} onClick={() => void act(async () => { await changeLibrary({ kind: 'purge', ids: trashIds }); setTrash(await libraryTrash()); setTrashIds([]); setConfirm(null) })}>{zh ? '永久删除' : 'Delete permanently'}</button></footer>{error && <p role="alert" className="library-error">{error}</p>}</LibraryDialog>}
  </>
}
