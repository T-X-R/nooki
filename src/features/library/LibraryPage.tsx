import { captureFolderAttachment, attachmentDocumentIds, type LibrarySelection } from '../conversation/library-folder-attachments.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowRightIcon, CheckIcon, ChevronRightIcon, Cross2Icon, DotsHorizontalIcon, ExclamationTriangleIcon, FileTextIcon, MagnifyingGlassIcon, ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import type { DocumentReference, SelectedDocument } from '../../../packages/capability-contract/src/index.ts'
import { parseReferenceHref } from '../../../packages/capability-contract/src/references.ts'
import type { InstalledCapability } from '../../platform/capability-host.ts'
import { grantSelectedDocuments, readSourceReference } from '../../platform/document-grants.ts'
import { changeLibrary, listLibraryDocuments, readLibraryDocument, searchLibraryContent, type LibraryDocument, type LibraryDocumentMetadata, type Organization } from '../../platform/document-library.ts'
import { folderOptions, uniqueFolderName, validateFolder } from '../../platform/library-folders.ts'
import { CONVERSATION_OWNER, LEGACY_REVIEW } from '../conversation/conversation-model.ts'
import { capabilityCopy, CapabilityIcon } from '../capabilities/capability-presentation.tsx'
import { useWorkbench } from '../../platform/preferences.ts'
import { exportMarkdown } from '../../platform/user-data.ts'
import { DestinationSelect } from '../../shared/DestinationSelect.tsx'
import { DeleteDocumentsDialog, HistoryDialog, LibraryDialog } from './LibraryDialogs.tsx'
import { LibraryManager, type LibraryCreation } from './LibraryManager.tsx'
import { LibraryDirectory, LibraryAddMenu, FolderIcon, FolderMenu, DOCUMENT_DRAG_TYPE } from './LibraryDirectory.tsx'
import { LibraryMenu } from './LibraryMenu.tsx'
import { LibraryFolderRename } from './LibraryFolderRename.tsx'
import { LibraryFolderDialog, type FolderAction } from './LibraryFolderDialog.tsx'
import { LibraryDocumentEditor } from './LibraryDocumentEditor.tsx'
import { startWindowDrag } from '../../app/window-drag.ts'
import './library-folders.css'

function LibraryMarkdown({ content, onDocument }: { content: string; onDocument(reference: DocumentReference): void }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => {
    const reference = parseReferenceHref(href ?? '')
    return reference ? <a href={href} onClick={event => { event.preventDefault(); onDocument(reference) }}>{children}</a> : <a href={href}>{children}</a>
  } }}>{content}</Markdown>
}
export function LibraryPage({ organization, organizationError, installed, target, onAddToConversation, onOpenCapability, onDocument, onOpenCommand }: { organization: Organization; organizationError: string; installed: InstalledCapability[]; target: DocumentReference | null; onAddToConversation(selection: LibrarySelection): void; onOpenCapability(id: string): void; onDocument(reference: DocumentReference): void; onOpenCommand(): void }) {
  const { t } = useTranslation()
  const { language } = useWorkbench()
  const zh = language === 'zh'
  const rootName = zh ? '我的资料' : 'My documents'
  const folders = organization.folders ?? []
  const [documents, setDocuments] = useState<LibraryDocumentMetadata[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const refreshLibrary = () => setRefreshKey(key => key + 1)
  const [folderId, setFolderId] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDocument, setSelectedDocument] = useState<LibraryDocument | null>(null)
  const [sourceTarget, setSourceTarget] = useState<DocumentReference | null>(null)
  const [source, setSource] = useState<SelectedDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [contentMatches, setContentMatches] = useState<Set<string>>(new Set())
  const [searchError, setSearchError] = useState<string | null>(null)
  const [grantIds, setGrantIds] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [creation, setCreation] = useState<LibraryCreation | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; surface: 'directory' | 'content' } | null>(null)
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const documentEditor = useRef<{ save(): Promise<boolean> }>(null)
  const [renamingDocument, setRenamingDocument] = useState<string | null>(null)
  const [history, setHistory] = useState<LibraryDocument | null>(null)
  const [moveId, setMoveId] = useState<string | null>(null)
  const [destinationId, setDestinationId] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null)
  const [grantOpen, setGrantOpen] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [grantBusy, setGrantBusy] = useState(false)
  const [grantError, setGrantError] = useState<string | null>(null)
  const recipients = installed.filter(cap => cap.manifest.id !== LEGACY_REVIEW && cap.enabled && cap.manifest.permissions.includes('documents.read-selected'))
  const origins = organization.origins
  const installedNames = useMemo(() => new Map<string, string>(installed.map((cap): [string, string] => [cap.manifest.id, capabilityCopy(cap, language).name]).concat([[CONVERSATION_OWNER, zh ? '对话' : 'Conversations']])), [installed, language, zh])
  const destinations = folderOptions(folders, rootName)
  const location = destinations.find(folder => folder.id === folderId)?.name ?? rootName
  const currentFolder = folders.find(folder => folder.id === folderId)
  const assigned = new Set(folders.flatMap(folder => folder.documentIds))
  const searching = !!query.trim()
  const visibleDocuments = documents.filter(doc => searching ? doc.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) || contentMatches.has(doc.id) : folderId ? currentFolder?.documentIds.includes(doc.id) : !assigned.has(doc.id))
  const childFolders = searching ? [] : folders.filter(folder => folder.parentId === (folderId || undefined))
  const openFolder = (id: string) => { setFolderId(id); setSelectedId(null); setSourceTarget(null); setQuery('') }
  const openDocument = (id: string) => { setSelectedId(id); setSourceTarget(null); setQuery(''); const owner = folders.find(folder => folder.id === folderId && folder.documentIds.includes(id)) ?? folders.find(folder => folder.documentIds.includes(id)); setFolderId(owner?.id ?? ''); if (owner) setCollapsed(value => { const next = new Set(value); let parent: typeof owner | undefined = owner; while (parent) { next.delete(parent.id); parent = folders.find(folder => folder.id === parent?.parentId) } return next }) }
  useEffect(() => { window.addEventListener('workbench:library-changed', refreshLibrary); return () => window.removeEventListener('workbench:library-changed', refreshLibrary) }, [])
  useEffect(() => {
    let current = true
    listLibraryDocuments().then(next => { if (current) { setDocuments(next); setError(null) } }).catch(reason => { if (current) setError(String(reason)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [refreshKey])
  useEffect(() => {
    let current = true; setContentMatches(new Set()); setSearchError(null)
    const timer = window.setTimeout(() => { void searchLibraryContent(query).then(ids => { if (current) setContentMatches(new Set(ids)) }).catch(reason => { if (current) setSearchError(String(reason)) }) }, 150)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query, documents])
  useEffect(() => { if (target) { setSourceTarget(target.grantId || target.snapshotId ? target : null); setSelectedId(target.documentId) } }, [target])
  useEffect(() => {
    let current = true
    setSelectedDocument(previous => previous?.id === selectedId ? previous : null); setSource(null); setDocumentError(null)
    if (!selectedId && !sourceTarget) return
    const read = sourceTarget ? readSourceReference(sourceTarget).then(doc => { if (current) setSource(doc) }) : readLibraryDocument(selectedId!).then(doc => { if (current) setSelectedDocument(doc) })
    void read.catch(reason => { if (current) setDocumentError(String(reason)) })
    return () => { current = false }
  }, [selectedId, sourceTarget, refreshKey])
  const currentDocument = selectedDocument?.id === selectedId && selectedDocument && documents.some(doc => doc.id === selectedDocument.id) ? selectedDocument : null
  const moveDocument = async (id: string, destination?: string) => {
    if (moving) return
    setMoving(true); setFeedback(null)
    try { await changeLibrary({ kind: 'move-documents', ids: [id], folderId: destination }); setMoveId(null); setCollapsed(value => { const next = new Set(value); if (destination) next.delete(destination); return next }); setFolderId(destination ?? ''); setSelectedId(id); setQuery(''); setFeedback({ error: false, text: zh ? '资料已移动。' : 'Document moved.' }) }
    catch (reason) { setFeedback({ error: true, text: String(reason) }) } finally { setMoving(false) }
  }
  const showHistory = async (id: string) => {
    try { if (id === currentDocument?.id && documentEditor.current && !await documentEditor.current.save()) return; setHistory(await readLibraryDocument(id)) } catch (reason) { setFeedback({ error: true, text: String(reason) }) }
  }
  const discuss = async (ids: string[]) => {
    if (ids.length > 50) { setFeedback({ error: true, text: zh ? `共 ${ids.length} 篇资料，一次最多添加 50 篇，请分批选择。` : `${ids.length} documents. Select up to 50 at a time.` }); return }
    if (ids.includes(currentDocument?.id ?? '') && documentEditor.current && !await documentEditor.current.save()) return
    if (ids.length) onAddToConversation({ documentIds: ids, folders: [] })
  }
  const exportCurrentDocument = async () => {
    if (!currentDocument || (documentEditor.current && !await documentEditor.current.save())) return
    try { await exportMarkdown(currentDocument.id) } catch (reason) { setFeedback({ error: true, text: String(reason) }) }
  }
  const folderMenu = (folder: typeof folders[number], surface: 'directory' | 'content' = 'directory') => {
    return <FolderMenu folder={folder} language={language} onAction={handleFolderAction} onRename={() => setRenaming({ id: folder.id, surface })} onDiscuss={async () => {
      const attachment = captureFolderAttachment(folders, documents, folder.id)
      const ids = attachmentDocumentIds([attachment])
      if (ids.length > 50) { setFeedback({ error: true, text: zh ? `文件夹含 ${ids.length} 篇资料，超过单次 50 篇的限制，未添加任何内容。` : `This folder contains ${ids.length} documents, exceeding the limit of 50. Nothing was added.` }); return }
      if (ids.includes(currentDocument?.id ?? '') && documentEditor.current && !await documentEditor.current.save()) return
      onAddToConversation({ documentIds: [], folders: [attachment] })
    }} />
  }
  const documentMenu = (doc: LibraryDocumentMetadata) => <LibraryMenu label={`${zh ? '文档操作' : 'Document actions'} ${doc.title}`} icon={<DotsHorizontalIcon />}>
    <button role="menuitem" onClick={() => discuss([doc.id])}>{zh ? '添加到会话' : 'Add to conversation'}</button>
    <button role="menuitem" onClick={() => { openDocument(doc.id); setRenamingDocument(doc.id) }}>{zh ? '重命名' : 'Rename'}</button>
    <button role="menuitem" onClick={() => { setMoveId(doc.id); setDestinationId(folders.find(folder => folder.documentIds.includes(doc.id))?.id ?? ''); setFeedback(null) }}>{zh ? '移动到…' : 'Move to…'}</button>
    {!!recipients.length && <button role="menuitem" onClick={() => { setGrantIds([doc.id]); setRecipient(recipients[0]?.manifest.id ?? ''); setGrantError(null); setGrantOpen(true) }}>{zh ? '授权读取' : 'Authorize access'}</button>}
    {origins[doc.id] && <button role="menuitem" onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-conversation', { detail: origins[doc.id].threadId }))}>{zh ? '原始对话' : 'Original conversation'}</button>}
    <button role="menuitem" className="library-delete-action" onClick={() => setDeleteIds([doc.id])}>{zh ? '移入回收站' : 'Move to Trash'}</button>
  </LibraryMenu>
  const creationBusy = useRef(false)
  const handleCreate = async (value: LibraryCreation) => {
    if (value.kind === 'import') { setCreation(value); return }
    if (creationBusy.current) return
    creationBusy.current = true; setFeedback(null)
    try {
      if (documentEditor.current && !await documentEditor.current.save()) return
      const doc = await changeLibrary({ kind: 'create', folderId: value.folderId, document: { key: crypto.randomUUID(), title: zh ? '未命名文档' : 'Untitled document', content: '', documentDate: new Date().toLocaleDateString('en-CA'), collectionKey: 'documents', collectionName: 'My documents' } })
      if (doc) { setSelectedId(doc.id); setFolderId(value.folderId ?? ''); setSourceTarget(null); setQuery(''); setCollapsed(new Set()) }
    } catch (reason) { setFeedback({ error: true, text: String(reason) }) } finally { creationBusy.current = false }
  }
  const handleFolderAction = async (action: FolderAction) => {
    if (action.kind !== 'create') { setFolderAction(action); return }
    if (creationBusy.current) return
    creationBusy.current = true; setFeedback(null)
    try {
      const id = crypto.randomUUID()
      await changeLibrary({ kind: 'save-folder', folder: { id, name: uniqueFolderName(folders, zh ? '未命名文件夹' : 'Untitled folder', action.parentId), parentId: action.parentId, documentIds: [] } })
      openFolder(id); setCollapsed(new Set()); setRenaming({ id, surface: 'directory' })
    } catch (reason) { setFeedback({ error: true, text: String(reason) }) } finally { creationBusy.current = false }
  }
  const moveFolder = async (id: string, parentId?: string) => {
    const folder = folders.find(item => item.id === id)
    if (!folder || moving || folder.parentId === parentId) return
    setMoving(true); setFeedback(null)
    try { await changeLibrary({ kind: 'save-folder', folder: { ...folder, parentId } }); setCollapsed(new Set()); setFeedback({ error: false, text: zh ? '文件夹已移动。' : 'Folder moved.' }) }
    catch (reason) { setFeedback({ error: true, text: String(reason) }) } finally { setMoving(false) }
  }
  const canDrop = (id: string) => {
    if (!dragging?.startsWith('folder:')) return !!dragging
    const folder = folders.find(item => `folder:${item.id}` === dragging)
    if (!folder || folder.parentId === (id || undefined)) return false
    try { validateFolder(folders, { ...folder, parentId: id || undefined }); return true } catch { return false }
  }
  const drop = (value: string, id?: string) => { if (!canDrop(id ?? '')) return; if (value.startsWith('folder:')) void moveFolder(value.slice(7), id); else void moveDocument(value, id) }
  const addMenu = <LibraryAddMenu language={language} folderId={folderId || undefined} name={currentFolder?.name ?? rootName} onCreate={handleCreate} onFolder={handleFolderAction} />
  const breadcrumbs = () => {
    const parts = []; let folder = currentFolder; const seen = new Set<string>()
    while (folder && !seen.has(folder.id)) { parts.unshift(folder); seen.add(folder.id); folder = folders.find(item => item.id === folder?.parentId) }
    return <nav className="library-breadcrumbs" aria-label={zh ? '当前位置' : 'Current location'}><button onClick={() => openFolder('')}>{rootName}</button>{parts.map(part => <span key={part.id}><ChevronRightIcon /><button onClick={() => openFolder(part.id)}>{part.name}</button></span>)}{selectedId && <><ChevronRightIcon /><span className="library-breadcrumb-document">{source?.reference.title ?? currentDocument?.title ?? '…'}</span></>}</nav>
  }
  return <div className="content-column library-page library-folder-page">
    <header className="library-shell-heading" onMouseDown={startWindowDrag}><div className="library-shell-title"><h1>{zh ? '资料库' : 'Library'}</h1><span>{documents.length} {zh ? '篇资料' : 'documents'}</span></div><div className="library-shell-location">{breadcrumbs()}<div className="library-location-actions">{currentDocument && !sourceTarget && <LibraryMenu label={zh ? '文档更多操作' : 'More document actions'} icon={<DotsHorizontalIcon />}><button role="menuitem" onClick={() => { void exportCurrentDocument() }}>{zh ? '导出 Markdown' : 'Export Markdown'}</button><button role="menuitem" onClick={() => void showHistory(currentDocument.id)}>{zh ? '版本历史' : 'Version history'}</button></LibraryMenu>}<button className="topbar-search" aria-label={`${t('searchWorkbench')} (⌘ K)`} onClick={onOpenCommand}><MagnifyingGlassIcon /><kbd>⌘ K</kbd></button></div></div></header>
    <LibraryManager organization={organization} language={language} creation={creation} onCloseCreation={() => setCreation(null)} showTrash={showTrash} onCloseTrash={() => setShowTrash(false)} onOpen={id => { openDocument(id); setFolderId(creation ? creation.folderId ?? '' : folderId) }} refresh={refreshLibrary} />
    <div className="library-feedback" aria-live="polite">{(error || organizationError || searchError || feedback) && <p role={error || organizationError || searchError || feedback?.error ? 'alert' : 'status'}>{error || organizationError || searchError || feedback?.text}</p>}</div>
    {history && <HistoryDialog document={history} language={language} onClose={() => setHistory(null)} onSaved={refreshLibrary} />}
    {deleteIds && <DeleteDocumentsDialog ids={deleteIds} language={language} onClose={() => setDeleteIds(null)} onDeleted={() => { setSelectedId(null); refreshLibrary() }} />}
    {folderAction && <LibraryFolderDialog action={folderAction} folders={folders} language={language} onClose={() => setFolderAction(null)} onSaved={id => { openFolder(id ?? ''); setCollapsed(new Set()); refreshLibrary() }} />}
    {moveId && <LibraryDialog title={zh ? '移动资料' : 'Move document'} busy={moving} onClose={() => setMoveId(null)}><DestinationSelect label={zh ? '文件夹' : 'Folder'} options={destinations} value={destinationId} disabled={moving} autoFocus onChange={setDestinationId} />{feedback?.error && <p role="alert" className="library-error">{feedback.text}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={moving} onClick={() => setMoveId(null)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={moving} onClick={() => void moveDocument(moveId, destinationId || undefined)}>{zh ? '移动' : 'Move'}</button></footer></LibraryDialog>}
      {grantOpen && <div className="modal-backdrop"><section className="modal grant-modal" role="dialog" aria-modal="true" aria-labelledby="grant-title"><div className="modal-header"><div><span className="section-kicker">DOCUMENT ACCESS</span><h2 id="grant-title">{language === 'zh' ? '确认资料授权' : 'Confirm document access'}</h2></div><button className="icon-button" disabled={grantBusy} onClick={() => setGrantOpen(false)} aria-label={t('close')}><Cross2Icon /></button></div>
        <p className="modal-copy">{language === 'zh' ? '只授权读取以下资料的当前快照。能力可将这些内容用于 AI 生成；不会获得全库或其他能力私有数据的访问权。' : 'Authorize only the current snapshots listed below. The capability may use them for AI generation; this does not grant access to the entire Library or private capability storage.'}</p>
        <div className="grant-section-label"><span>{language === 'zh' ? '所选资料' : 'Selected documents'}</span><small>{grantIds.length}</small></div>
        <ul className="grant-document-list">{documents.filter((doc) => grantIds.includes(doc.id)).map((doc) => <li key={doc.id}><span className="grant-document-icon"><FileTextIcon /></span><span><strong>{doc.title}</strong><small>{installedNames.get(doc.capabilityId) ?? doc.capabilityName} · {doc.documentDate}</small></span></li>)}</ul>
        <fieldset className="grant-recipients"><legend>{language === 'zh' ? '允许哪个能力读取' : 'Allow access to'}</legend><div className="grant-recipient-list">{recipients.map((cap) => <label className={`grant-recipient ${recipient === cap.manifest.id ? 'is-selected' : ''}`} key={cap.manifest.id}><input type="radio" name="document-recipient" value={cap.manifest.id} checked={recipient === cap.manifest.id} disabled={grantBusy} onChange={() => setRecipient(cap.manifest.id)} /><span className="grant-recipient-icon"><CapabilityIcon name={cap.manifest.icon} /></span><span><strong>{capabilityCopy(cap, language).name}</strong><small>{capabilityCopy(cap, language).description}</small></span><CheckIcon className="grant-recipient-check" aria-hidden="true" /></label>)}</div></fieldset>
        {!recipients.length && <p>{language === 'zh' ? '请先安装并启用支持所选文档读取的能力。' : 'Install and enable a capability that supports selected documents.'}</p>}
        {grantError && <p role="alert">{grantError}</p>}
        <div className="modal-footer"><button className="secondary-button" disabled={grantBusy} onClick={() => setGrantOpen(false)}>{language === 'zh' ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={grantBusy || !recipient} onClick={() => { setGrantBusy(true); void grantSelectedDocuments(recipient, grantIds).then(() => { setGrantOpen(false); onOpenCapability(recipient) }).catch((reason) => setGrantError(String(reason))).finally(() => setGrantBusy(false)) }}>{language === 'zh' ? '授权并打开能力' : 'Authorize and open'}<ArrowRightIcon /></button></div>
      </section></div>}
    <div className="library-workspace">
      <nav className="library-tree library-directory" aria-label={zh ? '资料目录' : 'Library directory'}>
        <label className="library-tree-search"><MagnifyingGlassIcon /><input type="search" value={query} onChange={event => { setQuery(event.target.value); setSelectedId(null); setSourceTarget(null) }} placeholder={zh ? '搜索我的资料…' : 'Search my documents…'} aria-label={t('librarySearch')} /></label>
        <LibraryDirectory language={language} folders={folders} documents={documents} folderId={folderId} selectedId={selectedId} collapsed={collapsed} onToggle={id => setCollapsed(value => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next })} onFolder={openFolder} onDocument={openDocument} onCreate={handleCreate} onFolderAction={handleFolderAction} renameId={renaming?.surface === 'directory' ? renaming.id : null}  onFinishRename={() => setRenaming(null)} folderMenu={folderMenu} documentMenu={documentMenu} dragging={dragging} dropTarget={dropTarget} onDrag={setDragging} onDropTarget={setDropTarget} canDrop={canDrop} onMove={drop} />
        <button className="library-trash-link" onClick={() => setShowTrash(true)}><TrashIcon />{zh ? '回收站' : 'Trash'}</button>
      </nav>
      <article className="library-reader library-folder-content">

        {source ? <><header className="library-reader-header"><small>{zh ? '引用原文 · 使用时保存的快照' : 'Cited source · retained snapshot'}</small><h2>{source.reference.title}</h2><button className="quiet-button" onClick={() => openDocument(source.reference.documentId)}>{zh ? '查看当前文档' : 'View current document'}</button></header><div className="library-reader-content"><LibraryMarkdown content={source.content} onDocument={onDocument} /></div></> : currentDocument ? <LibraryDocumentEditor ref={documentEditor} key={currentDocument.id} document={currentDocument} language={language} renameTitle={renamingDocument === currentDocument.id} onRenamed={() => setRenamingDocument(null)} onDocument={onDocument} /> : selectedId && documentError ? <div className="library-state library-state-error"><ExclamationTriangleIcon /><span>{documentError}</span></div> : selectedId || loading ? <div className="library-state"><ReloadIcon className="spin" /><span>{t('libraryLoading')}</span></div> : <>
          <header className="library-folder-heading"><span className="library-folder-emblem"><FolderIcon /></span><div><h2 tabIndex={-1}>{searching ? (zh ? '搜索结果' : 'Search results') : currentFolder?.name ?? rootName}</h2><p>{searching ? (zh ? `找到 ${visibleDocuments.length} 篇资料` : `${visibleDocuments.length} documents found`) : zh ? `${childFolders.length} 个文件夹 · ${visibleDocuments.length} 篇资料` : `${childFolders.length} folders · ${visibleDocuments.length} documents`}</p></div></header>
          {!childFolders.length && !visibleDocuments.length ? <div className="library-folder-empty"><FolderIcon /><h3>{searching ? (zh ? '没有找到相关资料' : 'No matching documents') : (zh ? '从这里，整理你的想法。' : 'A place for your ideas.')}</h3><p>{searching ? (zh ? '试试其他关键词。' : 'Try another search.') : (zh ? '点击 ＋ 新建文档、文件夹，或导入已有资料。' : 'Use + to create a document, a folder, or import existing notes.')}</p>{!searching && addMenu}</div> : <div className="library-folder-list">
            {childFolders.map(folder => <div className={`library-folder-item ${dropTarget === folder.id ? 'is-drop-target' : ''}`} key={folder.id} onDragOver={event => { if (canDrop(folder.id) && event.dataTransfer.types.includes(DOCUMENT_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(folder.id) } }} onDragLeave={() => setDropTarget(null)} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData(DOCUMENT_DRAG_TYPE); if (id && id === dragging) drop(id, folder.id); setDragging(null); setDropTarget(null) }}><div className="library-folder-item-name">{renaming?.id === folder.id && renaming.surface === 'content' ? <div className="library-folder-item-label"><FolderIcon /><LibraryFolderRename folder={folder} language={language} onFinish={() => setRenaming(null)} /></div> : <button className="library-folder-item-label" draggable onDragStart={event => { const id = `folder:${folder.id}`; event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, id); event.dataTransfer.effectAllowed = 'move'; setDragging(id) }} onDragEnd={() => { setDragging(null); setDropTarget(null) }} onClick={() => openFolder(folder.id)}><FolderIcon /><strong>{folder.name}</strong><small>{folders.filter(item => item.parentId === folder.id).length + documents.filter(doc => folder.documentIds.includes(doc.id)).length} {zh ? '项' : 'items'}</small></button>}</div><LibraryAddMenu language={language} folderId={folder.id} name={folder.name} onCreate={handleCreate} onFolder={handleFolderAction} />{folderMenu(folder, 'content')}</div>)}
            {visibleDocuments.map(doc => <div className="library-folder-item" key={doc.id}><button className="library-folder-item-label" draggable onDragStart={event => { event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, doc.id); event.dataTransfer.effectAllowed = 'move'; setDragging(doc.id) }} onDragEnd={() => { setDragging(null); setDropTarget(null) }} onClick={() => openDocument(doc.id)}><FileTextIcon /><strong>{doc.title}</strong><small>{searching ? destinations.find(folder => folders.find(item => item.id === folder.id)?.documentIds.includes(doc.id))?.name ?? rootName : doc.documentDate}</small></button>{documentMenu(doc)}</div>)}
          </div>}
        </>}
      </article>
    </div>
  </div>
}
