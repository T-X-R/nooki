import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckIcon, ChevronDownIcon, Cross2Icon, DownloadIcon, Pencil2Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { changeLibrary, libraryOrganization, libraryTrash, type LibraryDocumentMetadata, type Organization, type Topic } from './document-library'
import { emptyOrganization } from './library-store'
import { LibraryDialog, DocumentPreview, DeleteDocumentsDialog } from './LibraryDialogs'
import { exportMarkdown } from './user-data'

type ImportDraft = { key: string; title: string; content: string; documentDate: string; saved?: boolean }
export function LibraryManager({ language, documents, selected, onOpen, onScope, onDiscuss, refresh, filters, selectionActions, onClear }: {
  language: 'zh' | 'en'; documents: LibraryDocumentMetadata[]; selected: string[]; onOpen(id: string): void
  onScope(ids: string[] | null): void; onDiscuss(ids: string[]): void; refresh(): void
  filters: ReactNode; selectionActions: ReactNode; onClear(): void
}) {
  const zh = language === 'zh'
  const [organization, setOrganization] = useState<Organization>(emptyOrganization)
  const [topicId, setTopicId] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [manageTopics, setManageTopics] = useState(false)
  const [addingToTopic, setAddingToTopic] = useState(false)
  const [topicMenu, setTopicMenu] = useState(false)
  const topicTrigger = useRef<HTMLButtonElement>(null)
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
  const scopeKey = JSON.stringify(currentTopic?.documentIds ?? (topicId ? [] : null))
  const previousScope = useRef(`${topicId}:${scopeKey}`)
  useEffect(() => { const next = `${topicId}:${scopeKey}`; if (previousScope.current !== next) { previousScope.current = next; onScope(JSON.parse(scopeKey)) } }, [topicId, scopeKey])
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
  const saveTopic = (value: Topic) => act(async () => { await changeLibrary({ kind: 'save-topic', topic: value }); setTopic(null) })
  return <>
    <div className="library-management-bar" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={(e) => { e.preventDefault(); loadFiles(Array.from(e.dataTransfer.files)) }}>
      <div className="library-management-group">
        <div className="library-topic-picker" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setTopicMenu(false) }} onKeyDown={(e) => { if (e.key === 'Escape' && topicMenu) { e.preventDefault(); e.stopPropagation(); setTopicMenu(false); topicTrigger.current?.focus() } if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const root = e.currentTarget; const items = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')); if (!topicMenu) { setTopicMenu(true); requestAnimationFrame(() => root.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus()) } else { const index = items.indexOf(document.activeElement as HTMLButtonElement); items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus() } } }}>
          <button ref={topicTrigger} className="library-topic-trigger" aria-label={zh ? '切换专题' : 'Switch topic'} aria-haspopup="menu" aria-expanded={topicMenu} onClick={() => setTopicMenu(!topicMenu)}><span>{currentTopic?.name ?? (zh ? '默认' : 'Default')}</span><ChevronDownIcon /></button>
          {topicMenu && <div className="library-topic-menu" role="menu" aria-label={zh ? '专题' : 'Topics'}>{[{ id: '', name: zh ? '默认' : 'Default', documentIds: documents.map((d) => d.id) }, ...organization.topics].map((t) => <button key={t.id} role="menuitemradio" aria-checked={topicId === t.id} onClick={() => { setTopicId(t.id); setTopicMenu(false); topicTrigger.current?.focus() }}><span>{t.name}</span><small>{t.documentIds.filter((id) => documents.some((d) => d.id === id)).length}</small>{topicId === t.id && <CheckIcon />}</button>)}</div>}
        </div>
        {filters}
        <button className="quiet-button" onClick={() => { setManageTopics(true); setError('') }}>{zh ? '管理专题' : 'Manage topics'}</button>
      </div>
      <div className="library-management-group">
        <button className="quiet-button" disabled={busy} onClick={() => void act(async () => { setTrash(await libraryTrash()); setTrashIds([]) })}><TrashIcon />{zh ? '回收站' : 'Trash'}</button>
        <button className="primary-button library-import-button" disabled={busy} onClick={() => fileInput.current?.click()}><PlusIcon />{zh ? '导入资料' : 'Import'}</button>
      </div>
    </div>
    <input ref={fileInput} hidden type="file" accept=".md,.txt,text/plain,text/markdown" multiple onChange={(e) => { loadFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
    {!!selected.length && <div className="library-batch-actions"><span className="library-selection-count">{zh ? `已选 ${selected.length} 篇` : `${selected.length} selected`}</span><button className="icon-button" aria-label={zh ? '取消选择' : 'Clear selection'} onClick={onClear}><Cross2Icon /></button><button className="quiet-button" disabled={busy} onClick={() => setAddingToTopic(true)}>{zh ? '加入专题' : 'Add to topic'}</button>{currentTopic && <button className="quiet-button" disabled={busy} onClick={() => void saveTopic({ ...currentTopic, documentIds: currentTopic.documentIds.filter((id) => !selected.includes(id)) })}>{zh ? '移出专题' : 'Remove from topic'}</button>}<button className="quiet-button" disabled={busy} onClick={() => void act(async () => setNotice(await exportMarkdown(selected)))}><DownloadIcon />{zh ? '导出' : 'Export'}</button><button className="quiet-button library-delete-action" disabled={busy} onClick={() => setConfirm('trash')}><TrashIcon />{zh ? '删除' : 'Delete'}</button><div className="library-selection-actions">{selectionActions}</div></div>}
    {manageTopics && <LibraryDialog title={zh ? '管理专题' : 'Manage topics'} busy={busy} onClose={() => { setManageTopics(false); setRenaming(null); setError('') }}><p className="modal-copy">{zh ? '将不同来源的资料整理在一起。默认视图始终包含全部资料。' : 'Organize documents across sources. Default always contains every document.'}</p><div className="library-topic-list">{organization.topics.map((t) => <div key={t.id}><span>{renaming?.id === t.id ? <form className="library-topic-rename" onSubmit={(e) => { e.preventDefault(); if (!renaming.name.trim() || busy) return; void act(async () => { await changeLibrary({ kind: 'save-topic', topic: { ...t, name: renaming.name.trim() } }); setRenaming(null) }) }}><input autoFocus aria-label={zh ? '专题名称' : 'Topic name'} maxLength={80} value={renaming.name} disabled={busy} onChange={(e) => setRenaming({ id: t.id, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(null); setError('') } }} /><button type="submit" className="icon-button" disabled={busy || !renaming.name.trim()} aria-label={zh ? '保存名称' : 'Save name'}><CheckIcon /></button><button type="button" className="icon-button" disabled={busy} aria-label={zh ? '取消改名' : 'Cancel rename'} onClick={() => { setRenaming(null); setError('') }}><Cross2Icon /></button></form> : <span className="library-topic-name"><strong>{t.name}</strong><button className="icon-button" aria-label={zh ? `修改专题名称：${t.name}` : `Rename topic: ${t.name}`} title={zh ? '修改名称' : 'Rename'} disabled={busy} onClick={() => { setRenaming({ id: t.id, name: t.name }); setError('') }}><Pencil2Icon /></button></span>}<small>{t.documentIds.filter((id) => documents.some((d) => d.id === id)).length} {zh ? '篇资料' : 'documents'}</small></span><button className="quiet-button library-delete-action" disabled={busy} onClick={() => { setRenaming(null); setTopic({ ...t }); setConfirm('topic'); setError('') }}>{zh ? '删除' : 'Delete'}</button></div>)}{!organization.topics.length && <p className="library-empty-copy">{zh ? '还没有专题，创建一个开始整理。' : 'Create your first topic to start organizing.'}</p>}</div>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="primary-button" onClick={() => { setRenaming(null); setTopic({ id: crypto.randomUUID(), name: '', documentIds: [] }); setError('') }}><PlusIcon />{zh ? '新建专题' : 'New topic'}</button></footer></LibraryDialog>}
    {addingToTopic && <LibraryDialog title={zh ? '加入专题' : 'Add to topic'} busy={busy} onClose={() => setAddingToTopic(false)}><p className="modal-copy">{zh ? `将所选 ${selected.length} 篇资料关联到专题，原文位置不变。` : `Link ${selected.length} selected documents to a topic.`}</p><div className="library-topic-list">{organization.topics.map((t) => <button className="library-topic-choice" key={t.id} disabled={busy} onClick={() => void act(async () => { await changeLibrary({ kind: 'save-topic', topic: { ...t, documentIds: [...new Set([...t.documentIds, ...selected])] } }); setAddingToTopic(false) })}><span>{t.name}</span><PlusIcon /></button>)}{!organization.topics.length && <p className="library-empty-copy">{zh ? '先创建一个专题，再加入资料。' : 'Create a topic first.'}</p>}</div>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => { setAddingToTopic(false); setTopic({ id: crypto.randomUUID(), name: '', documentIds: selected }); setError('') }}>{zh ? '新建专题并加入' : 'Create topic with selection'}</button></footer></LibraryDialog>}
    {!imports && !topic && !trash && !manageTopics && !addingToTopic && error && <p role="alert" className="library-error">{error}</p>}{notice && <p role="status" className="library-notice">{notice}</p>}
    {imports && <LibraryDialog wide busy={busy} title={zh ? '导入资料' : 'Import documents'} onClose={() => setImports(null)}>
      {imports.length > 1 && <select aria-label={zh ? '预览文件' : 'Preview file'} value={active} disabled={busy} onChange={(e) => setActive(Number(e.target.value))}>{imports.map((row, i) => <option key={row.key} value={i}>{row.saved ? '✓ ' : ''}{row.title}</option>)}</select>}
      {draft && <><div className="library-editor-heading"><label className="library-field">{zh ? '标题' : 'Title'}<input autoFocus value={draft.title} disabled={busy || draft.saved} maxLength={120} onChange={(e) => setDraft({ title: e.target.value })} /></label><label className="library-field">{zh ? '日期' : 'Date'}<input type="date" value={draft.documentDate} disabled={busy || draft.saved} onChange={(e) => setDraft({ documentDate: e.target.value })} /></label></div>{preview ? <DocumentPreview content={draft.content} /> : <label className="library-field">{zh ? '正文' : 'Content'}<textarea className="library-editor" value={draft.content} disabled={busy || draft.saved} placeholder={zh ? '粘贴或编辑 Markdown / 纯文本…' : 'Paste or edit Markdown / plain text…'} onChange={(e) => setDraft({ content: e.target.value })} /></label>}</>}
      {error && <p role="alert" className="library-error">{error}</p>}
      <footer className="modal-footer"><button className="secondary-button" onClick={() => setPreview(!preview)}>{preview ? (zh ? '编辑' : 'Edit') : (zh ? '预览' : 'Preview')}</button><button className="primary-button" disabled={busy || imports.some((row) => !row.title.trim() || !row.content.trim() || !row.documentDate)} onClick={importAll}>{busy ? (zh ? '导入中…' : 'Importing…') : (zh ? `导入 ${imports.filter((row) => !row.saved).length} 篇资料` : `Import ${imports.filter((row) => !row.saved).length} documents`)}</button></footer>
    </LibraryDialog>}
    {topic && confirm !== 'topic' && <LibraryDialog title={organization.topics.some((t) => t.id === topic.id) ? (zh ? '修改专题名称' : 'Rename topic') : (zh ? '新建专题' : 'New topic')} busy={busy} onClose={() => setTopic(null)}><label className="library-field">{zh ? '专题名称' : 'Topic name'}<input autoFocus value={topic.name} maxLength={80} disabled={busy} onChange={(e) => setTopic({ ...topic, name: e.target.value })} /></label><p className="modal-copy">{zh ? `包含 ${topic.documentIds.length} 篇资料。专题关联原文，删除专题不会删除资料。` : `${topic.documentIds.length} linked documents. Deleting a topic keeps its documents.`}</p>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer">{organization.topics.some((t) => t.id === topic.id) && <button className="quiet-button" disabled={busy} onClick={() => setConfirm('topic')}>{zh ? '删除专题' : 'Delete topic'}</button>}<button className="primary-button" disabled={busy || !topic.name.trim()} onClick={() => void saveTopic(topic)}>{zh ? '保存专题' : 'Save topic'}</button></footer></LibraryDialog>}
    {trash && <LibraryDialog wide title={zh ? '回收站' : 'Trash'} busy={busy} onClose={() => setTrash(null)}><p className="modal-copy">{zh ? '这里管理资料库副本。来源能力的内部记录和历史引用快照会保留；永久删除后版本历史无法恢复。' : 'Manage Library copies here. Capability records and historical citation snapshots are retained. Permanent deletion also removes revision history.'}</p><div className="library-trash-list">{trash.map((doc) => <label key={doc.id}><input type="checkbox" disabled={busy} checked={trashIds.includes(doc.id)} onChange={() => setTrashIds((ids) => ids.includes(doc.id) ? ids.filter((id) => id !== doc.id) : [...ids, doc.id])} /><span><strong>{doc.title}</strong><small>{doc.capabilityName} · {doc.documentDate}</small></span></label>)}{!trash.length && <p>{zh ? '回收站是空的。' : 'Trash is empty.'}</p>}</div>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy || !trashIds.length} onClick={() => setConfirm('purge')}>{zh ? '永久删除' : 'Delete permanently'}</button><button className="primary-button" disabled={busy || !trashIds.length} onClick={() => void act(async () => { await changeLibrary({ kind: 'restore', ids: trashIds }); setTrash(await libraryTrash()); setTrashIds([]) })}>{zh ? '恢复' : 'Restore'}</button></footer></LibraryDialog>}
    {confirm === 'trash' && <DeleteDocumentsDialog ids={selected} language={language} onClose={() => setConfirm(null)} onDeleted={() => { onClear(); refresh() }} />}
    {confirm && confirm !== 'trash' && <LibraryDialog title={zh ? '确认操作' : 'Confirm action'} busy={busy} onClose={() => { setConfirm(null); if (confirm === 'topic') setTopic(null) }}><p className="modal-copy">{confirm === 'purge' ? (zh ? `永久删除 ${trashIds.length} 篇资料及版本历史？此操作无法撤销。` : `Permanently delete ${trashIds.length} documents and their revision history? This cannot be undone.`) : (zh ? '删除这个专题？其中的资料会保留。' : 'Delete this topic? Its documents will remain.')}</p><footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => { setConfirm(null); if (confirm === 'topic') setTopic(null) }}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy} onClick={() => void act(async () => { if (confirm === 'topic' && topic) { await changeLibrary({ kind: 'delete-topic', id: topic.id }); setTopic(null); if (topicId === topic.id) setTopicId('') } else { await changeLibrary({ kind: confirm === 'purge' ? 'purge' : 'trash', ids: confirm === 'purge' ? trashIds : selected }); if (confirm === 'purge') { setTrash(await libraryTrash()); setTrashIds([]) } } setConfirm(null) })}>{zh ? '确认' : 'Confirm'}</button></footer>{error && <p role="alert" className="library-error">{error}</p>}</LibraryDialog>}
    {currentTopic && <div className="library-topic-summary library-management-group"><span>{currentTopic.documentIds.filter((id) => documents.some((d) => d.id === id)).length} {zh ? '篇资料' : 'documents'}</span><button className="quiet-button" disabled={!currentTopic.documentIds.some((id) => documents.some((d) => d.id === id)) || currentTopic.documentIds.filter((id) => documents.some((d) => d.id === id)).length > 50} onClick={() => onDiscuss(currentTopic.documentIds.filter((id) => documents.some((d) => d.id === id)))}>{zh ? '讨论整个专题' : 'Discuss this topic'}</button>{currentTopic.documentIds.length > 50 && <small>{zh ? '每次最多引用 50 篇，请手动选择资料。' : 'Select up to 50 documents per message.'}</small>}</div>}
  </>
}
