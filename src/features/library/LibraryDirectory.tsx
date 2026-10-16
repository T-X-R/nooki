import { useId, useState } from 'react'
import { LibraryFolderRename } from './LibraryFolderRename.tsx'
import { ChevronRightIcon, DotsHorizontalIcon, FilePlusIcon, FileTextIcon, PlusIcon, UploadIcon } from '@radix-ui/react-icons'
import type { LibraryDocumentMetadata, LibraryFolder } from '../../platform/document-library.ts'
import { LibraryMenu } from './LibraryMenu.tsx'
import type { LibraryCreation } from './LibraryManager.tsx'
import type { FolderAction } from './LibraryFolderDialog.tsx'

export const DOCUMENT_DRAG_TYPE = 'application/x-nooki-library-document'
export function FolderIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" fill="currentColor" opacity=".15" /><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.6" /></svg> }
export function LibraryAddMenu({ language, folderId, name, onCreate, onFolder }: { language: 'zh' | 'en'; folderId?: string; name: string; onCreate(value: LibraryCreation): void; onFolder(value: FolderAction): void }) {
  const zh = language === 'zh'
  return <LibraryMenu label={`${zh ? '添加到' : 'Add to'} ${name}`} icon={<PlusIcon />}>
    <button role="menuitem" onClick={() => onCreate({ kind: 'document', folderId })}><FilePlusIcon />{zh ? '新建文档' : 'New document'}</button>
    <button role="menuitem" onClick={() => onFolder({ kind: 'create', parentId: folderId })}><FolderIcon />{zh ? '新建文件夹' : 'New folder'}</button>
    <button role="menuitem" onClick={() => onCreate({ kind: 'import', folderId })}><UploadIcon />{zh ? '导入资料' : 'Import documents'}</button>
  </LibraryMenu>
}
export function FolderMenu({ folder, language, onAction, onRename }: { folder: LibraryFolder; language: 'zh' | 'en'; onAction(value: FolderAction): void; onRename(): void }) {
  const zh = language === 'zh'
  return <LibraryMenu label={`${zh ? '文件夹操作' : 'Folder actions'} ${folder.name}`} icon={<DotsHorizontalIcon />}>
    <button role="menuitem" onClick={onRename}>{zh ? '重命名' : 'Rename'}</button>
    <button role="menuitem" onClick={() => onAction({ kind: 'move', folder })}>{zh ? '移动到…' : 'Move to…'}</button>
    <button role="menuitem" className="library-delete-action" onClick={() => onAction({ kind: 'delete', folder })}>{zh ? '删除文件夹' : 'Delete folder'}</button>
  </LibraryMenu>
}
export function LibraryDirectory({ language, folders, documents, folderId, selectedId, collapsed, onToggle, onFolder, onDocument, onCreate, onFolderAction, renameId, onRename, onFinishRename, documentMenu, dragging, dropTarget, onDrag, onDropTarget, onMove }: {
  language: 'zh' | 'en'; folders: LibraryFolder[]; documents: LibraryDocumentMetadata[]; folderId: string; selectedId: string | null; collapsed: Set<string>
  onToggle(id: string): void; onFolder(id: string): void; onDocument(id: string): void; onCreate(value: LibraryCreation): void; onFolderAction(value: FolderAction): void; renameId: string | null; onRename(id: string): void; onFinishRename(): void
  documentMenu(doc: LibraryDocumentMetadata): React.ReactNode; dragging: string | null; dropTarget: string | null; onDrag(id: string | null): void; onDropTarget(id: string | null): void; onMove(id: string, folderId?: string): void
}) {
  const zh = language === 'zh'
  const [expandedRoot, setExpandedRoot] = useState(true)
  const rootId = useId()
  const assigned = new Set(folders.flatMap(folder => folder.documentIds))
  const drops = (id: string) => ({
    onDragOver: (event: React.DragEvent) => { if (!dragging || !event.dataTransfer.types.includes(DOCUMENT_DRAG_TYPE)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; onDropTarget(id) },
    onDragLeave: (event: React.DragEvent) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) onDropTarget(null) },
    onDrop: (event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); const value = event.dataTransfer.getData(DOCUMENT_DRAG_TYPE); if (value && value === dragging && documents.some(doc => doc.id === value)) onMove(value, id || undefined); onDrag(null); onDropTarget(null) },
  })
  const docRow = (doc: LibraryDocumentMetadata) => <li key={doc.id}><div className={`library-directory-row library-directory-document ${selectedId === doc.id ? 'is-active' : ''} ${dragging === doc.id ? 'is-dragging' : ''}`}>
    <button className="library-directory-label" draggable onDragStart={event => { event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, doc.id); event.dataTransfer.effectAllowed = 'move'; onDrag(doc.id) }} onDragEnd={() => { onDrag(null); onDropTarget(null) }} title={doc.title} aria-current={selectedId === doc.id ? 'true' : undefined} onClick={() => onDocument(doc.id)}><FileTextIcon /><span>{doc.title}</span></button><span className="library-directory-actions">{documentMenu(doc)}</span>
  </div></li>
  const children = (parentId?: string, seen = new Set<string>()): React.ReactNode => <ul>
    {folders.filter(folder => folder.parentId === parentId && !seen.has(folder.id)).map(folder => {
      const expanded = !collapsed.has(folder.id)
      return <li key={folder.id}><div className={`library-directory-row ${folderId === folder.id && !selectedId ? 'is-active' : ''} ${dropTarget === folder.id ? 'is-drop-target' : ''}`} {...drops(folder.id)}>
        <button className="library-folder-disclosure icon-button" aria-label={`${zh ? (expanded ? '收起' : '展开') : (expanded ? 'Collapse' : 'Expand')} ${folder.name}`} aria-expanded={expanded} onClick={() => onToggle(folder.id)}><ChevronRightIcon className={expanded ? 'is-expanded' : ''} /></button>
        {renameId === folder.id ? <div className="library-directory-label"><FolderIcon /><LibraryFolderRename folder={folder} language={language} onFinish={onFinishRename} /></div> : <button className="library-directory-label" title={folder.name} aria-current={folderId === folder.id && !selectedId ? 'true' : undefined} onClick={() => onFolder(folder.id)}><FolderIcon /><span>{folder.name}</span></button>}
        <span className="library-directory-actions"><LibraryAddMenu language={language} folderId={folder.id} name={folder.name} onCreate={onCreate} onFolder={onFolderAction} /><FolderMenu folder={folder} language={language} onAction={onFolderAction} onRename={() => onRename(folder.id)} /></span>
      </div>{expanded && <>{children(folder.id, new Set([...seen, folder.id]))}<ul>{documents.filter(doc => folder.documentIds.includes(doc.id)).map(docRow)}</ul></>}</li>
    })}
    {!parentId && documents.filter(doc => !assigned.has(doc.id)).map(docRow)}
  </ul>
  return <div className="library-directory-content">
    <div className={`library-directory-root library-directory-row ${!folderId && !selectedId ? 'is-active' : ''} ${dropTarget === '' ? 'is-drop-target' : ''}`} {...drops('')}><button className="library-directory-label" aria-current={!folderId && !selectedId ? 'true' : undefined} aria-expanded={expandedRoot} aria-controls={rootId} onClick={() => { setExpandedRoot(value => !value); onFolder('') }}><span>{zh ? '我的资料' : 'My documents'}</span><ChevronRightIcon className={expandedRoot ? 'is-expanded' : ''} /></button><LibraryAddMenu language={language} name={zh ? '我的资料' : 'My documents'} onCreate={onCreate} onFolder={onFolderAction} /></div>
    <div id={rootId} hidden={!expandedRoot}>{children()}</div>
    {expandedRoot && !folders.length && !documents.length && <p className="library-directory-hint">{zh ? '用右侧的 ＋，收好第一份资料。' : 'Use + to add your first document.'}</p>}
  </div>
}
