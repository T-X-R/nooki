import { useEffect, useRef, useState } from 'react'
import { DownloadIcon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { changeLibrary, libraryOrganization, libraryTrash, type LibraryDocumentMetadata, type Organization, type Topic } from './document-library'
import { emptyOrganization } from './library-store'
import { LibraryDialog, DocumentPreview } from './LibraryDialogs'
import { exportMarkdown } from './user-data'

type ImportDraft = { key: string; title: string; content: string; documentDate: string; saved?: boolean }
export function LibraryManager({ language, documents, selected, onOpen, onScope, onDiscuss, refresh }: {
  language: 'zh' | 'en'; documents: LibraryDocumentMetadata[]; selected: string[]; onOpen(id: string): void
  onScope(ids: string[] | null): void; onDiscuss(ids: string[]): void; refresh(): void
}) {
  const zh = language === 'zh'
  const [organization, setOrganization] = useState<Organization>(emptyOrganization)
  const [topicId, setTopicId] = useState('')
  const [topic, setTopic] = useState<Topic | null>(null)
  const [imports, setImports] = useState<ImportDraft[] | null>(null)
  const [active, setActive] = useState(0)
  const [preview, setPreview] = useState(false)
  const [trash, setTrash] = useState<LibraryDocumentMetadata[] | null>(null)
  const [trashIds, setTrashIds] = useState<string[]>([])
  const [confirm, setConfirm] = useState<'trash' | 'purge' | 'topic' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const currentTopic = organization.topics.find((t) => t.id === topicId)
  const reload = async () => { const next = await libraryOrganization(); setOrganization(next); return next }
  useEffect(() => {
    const load = () => { void reload().catch((e) => setError(String(e))) }
    load(); window.addEventListener('workbench:library-changed', load)
    return () => window.removeEventListener('workbench:library-changed', load)
  }, [])
  useEffect(() => { onScope(topicId ? organization.topics.find((t) => t.id === topicId)?.documentIds ?? [] : null) }, [topicId, organization])
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
    setImports(null); setTopicId(''); setNotice(zh ? '资料已导入，可选择后加入专题或对话。' : 'Documents imported. Select them to add to a topic or conversation.')
  })
  const saveTopic = (value: Topic) => act(async () => { await changeLibrary({ kind: 'save-topic', topic: value }); setTopic(null); setTopicId(value.id) })
  return <>
    <div className="library-management-bar" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={(e) => { e.preventDefault(); loadFiles(Array.from(e.dataTransfer.files)) }}>
      <div className="library-management-group"><button className="quiet-button" disabled={busy} onClick={() => fileInput.current?.click()}><PlusIcon />{zh ? '导入资料' : 'Import'}</button><button className="quiet-button" disabled={busy} onClick={() => { setImports([{ key: crypto.randomUUID(), title: '', content: '', documentDate: new Date().toLocaleDateString('en-CA') }]); setActive(0); setPreview(false) }}>{zh ? '粘贴文字' : 'Paste text'}</button><small>{zh ? '也可拖入 .md / .txt' : 'Drop .md / .txt here'}</small></div>
      <div className="library-management-group"><label className="sr-only" htmlFor="library-topic-filter">{zh ? '专题' : 'Topic'}</label><select id="library-topic-filter" value={topicId} onChange={(e) => setTopicId(e.target.value)}><option value="">{zh ? '所有专题' : 'All topics'}</option>{organization.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><button className="quiet-button" onClick={() => setTopic({ id: crypto.randomUUID(), name: '', documentIds: selected })}>{zh ? '新建专题' : 'New topic'}</button>{currentTopic && <button className="quiet-button" onClick={() => setTopic({ ...currentTopic })}>{zh ? '管理专题' : 'Manage topic'}</button>}<button className="quiet-button" disabled={busy} onClick={() => void act(async () => { setTrash(await libraryTrash()); setTrashIds([]) })}><TrashIcon />{zh ? '回收站' : 'Trash'}</button></div>
    </div>
    <input ref={fileInput} hidden type="file" accept=".md,.txt,text/plain,text/markdown" multiple onChange={(e) => { loadFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
    {!!selected.length && <div className="library-batch-actions"><select aria-label={zh ? '将已选资料加入专题' : 'Add selected to topic'} value="" disabled={busy} onChange={(e) => { const t = organization.topics.find((t) => t.id === e.target.value); if (t) void saveTopic({ ...t, documentIds: [...new Set([...t.documentIds, ...selected])] }) }}><option value="" disabled>{zh ? '加入专题…' : 'Add to topic…'}</option>{organization.topics.map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}</select>{currentTopic && <button className="quiet-button" disabled={busy} onClick={() => void saveTopic({ ...currentTopic, documentIds: currentTopic.documentIds.filter((id) => !selected.includes(id)) })}>{zh ? '从专题移除' : 'Remove from topic'}</button>}<button className="quiet-button" disabled={busy} onClick={() => void act(async () => setNotice(await exportMarkdown(selected)))}><DownloadIcon />{zh ? '导出 Markdown' : 'Export Markdown'}</button><button className="quiet-button" disabled={busy} onClick={() => setConfirm('trash')}><TrashIcon />{zh ? '移入回收站' : 'Move to Trash'}</button></div>}
    {!imports && !topic && !trash && error && <p role="alert" className="library-error">{error}</p>}{notice && <p role="status" className="library-notice">{notice}</p>}
    {imports && <LibraryDialog wide busy={busy} title={zh ? '导入资料' : 'Import documents'} onClose={() => setImports(null)}>
      {imports.length > 1 && <select aria-label={zh ? '预览文件' : 'Preview file'} value={active} disabled={busy} onChange={(e) => setActive(Number(e.target.value))}>{imports.map((row, i) => <option key={row.key} value={i}>{row.saved ? '✓ ' : ''}{row.title}</option>)}</select>}
      {draft && <><div className="library-editor-heading"><label className="library-field">{zh ? '标题' : 'Title'}<input autoFocus value={draft.title} disabled={busy || draft.saved} maxLength={120} onChange={(e) => setDraft({ title: e.target.value })} /></label><label className="library-field">{zh ? '日期' : 'Date'}<input type="date" value={draft.documentDate} disabled={busy || draft.saved} onChange={(e) => setDraft({ documentDate: e.target.value })} /></label></div>{preview ? <DocumentPreview content={draft.content} /> : <label className="library-field">{zh ? '正文' : 'Content'}<textarea className="library-editor" value={draft.content} disabled={busy || draft.saved} placeholder={zh ? '粘贴或编辑 Markdown / 纯文本…' : 'Paste or edit Markdown / plain text…'} onChange={(e) => setDraft({ content: e.target.value })} /></label>}</>}
      {error && <p role="alert" className="library-error">{error}</p>}
      <footer className="modal-footer"><button className="secondary-button" onClick={() => setPreview(!preview)}>{preview ? (zh ? '编辑' : 'Edit') : (zh ? '预览' : 'Preview')}</button><button className="primary-button" disabled={busy || imports.some((row) => !row.title.trim() || !row.content.trim() || !row.documentDate)} onClick={importAll}>{busy ? (zh ? '导入中…' : 'Importing…') : (zh ? `导入 ${imports.filter((row) => !row.saved).length} 篇资料` : `Import ${imports.filter((row) => !row.saved).length} documents`)}</button></footer>
    </LibraryDialog>}
    {topic && <LibraryDialog title={zh ? '专题设置' : 'Topic settings'} busy={busy} onClose={() => setTopic(null)}><label className="library-field">{zh ? '专题名称' : 'Topic name'}<input autoFocus value={topic.name} maxLength={80} disabled={busy} onChange={(e) => setTopic({ ...topic, name: e.target.value })} /></label><p className="modal-copy">{zh ? `包含 ${topic.documentIds.length} 篇资料。专题关联原文，删除专题不会删除资料。` : `${topic.documentIds.length} linked documents. Deleting a topic keeps its documents.`}</p>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer">{organization.topics.some((t) => t.id === topic.id) && <button className="quiet-button" disabled={busy} onClick={() => setConfirm('topic')}>{zh ? '删除专题' : 'Delete topic'}</button>}<button className="primary-button" disabled={busy || !topic.name.trim()} onClick={() => void saveTopic(topic)}>{zh ? '保存专题' : 'Save topic'}</button></footer></LibraryDialog>}
    {trash && <LibraryDialog wide title={zh ? '回收站' : 'Trash'} busy={busy} onClose={() => setTrash(null)}><p className="modal-copy">{zh ? '这里管理资料库副本。来源能力的内部记录和历史引用快照会保留；永久删除后版本历史无法恢复。' : 'Manage Library copies here. Capability records and historical citation snapshots are retained. Permanent deletion also removes revision history.'}</p><div className="library-trash-list">{trash.map((doc) => <label key={doc.id}><input type="checkbox" disabled={busy} checked={trashIds.includes(doc.id)} onChange={() => setTrashIds((ids) => ids.includes(doc.id) ? ids.filter((id) => id !== doc.id) : [...ids, doc.id])} /><span><strong>{doc.title}</strong><small>{doc.capabilityName} · {doc.documentDate}</small></span></label>)}{!trash.length && <p>{zh ? '回收站是空的。' : 'Trash is empty.'}</p>}</div>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy || !trashIds.length} onClick={() => setConfirm('purge')}>{zh ? '永久删除所选' : 'Delete selected permanently'}</button><button className="primary-button" disabled={busy || !trashIds.length} onClick={() => void act(async () => { await changeLibrary({ kind: 'restore', ids: trashIds }); setTrash(await libraryTrash()); setTrashIds([]) })}>{zh ? '恢复所选' : 'Restore selected'}</button></footer></LibraryDialog>}
    {confirm && <LibraryDialog title={zh ? '确认操作' : 'Confirm action'} busy={busy} onClose={() => setConfirm(null)}><p className="modal-copy">{confirm === 'trash' ? (zh ? `将 ${selected.length} 篇资料移入回收站？之后可以恢复。` : `Move ${selected.length} documents to Trash? You can restore them later.`) : confirm === 'purge' ? (zh ? `永久删除 ${trashIds.length} 篇资料及版本历史？此操作无法撤销。` : `Permanently delete ${trashIds.length} documents and their revision history? This cannot be undone.`) : (zh ? '删除这个专题？其中的资料会保留。' : 'Delete this topic? Its documents will remain.')}</p><footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setConfirm(null)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy} onClick={() => void act(async () => { if (confirm === 'topic' && topic) { await changeLibrary({ kind: 'delete-topic', id: topic.id }); setTopic(null); setTopicId('') } else { await changeLibrary({ kind: confirm === 'purge' ? 'purge' : 'trash', ids: confirm === 'purge' ? trashIds : selected }); if (confirm === 'purge') { setTrash(await libraryTrash()); setTrashIds([]) } } setConfirm(null) })}>{zh ? '确认' : 'Confirm'}</button></footer>{error && <p role="alert" className="library-error">{error}</p>}</LibraryDialog>}
    {currentTopic && <div className="library-topic-summary library-management-group"><span>{currentTopic.name} · {currentTopic.documentIds.filter((id) => documents.some((d) => d.id === id)).length} {zh ? '篇资料' : 'documents'}</span><button className="quiet-button" disabled={!currentTopic.documentIds.some((id) => documents.some((d) => d.id === id)) || currentTopic.documentIds.filter((id) => documents.some((d) => d.id === id)).length > 50} onClick={() => onDiscuss(currentTopic.documentIds.filter((id) => documents.some((d) => d.id === id)))}>{zh ? '讨论整个专题' : 'Discuss this topic'}</button>{currentTopic.documentIds.length > 50 && <small>{zh ? '每次最多引用 50 篇，请手动选择资料。' : 'Select up to 50 documents per message.'}</small>}</div>}
  </>
}
