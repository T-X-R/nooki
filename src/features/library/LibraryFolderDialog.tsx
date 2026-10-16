import { useState } from 'react'
import { changeLibrary, type LibraryFolder } from '../../platform/document-library.ts'
import { folderOptions } from '../../platform/library-folders.ts'
import { DestinationSelect } from '../../shared/DestinationSelect.tsx'
import { LibraryDialog } from './LibraryDialogs.tsx'

export type FolderAction = { kind: 'create'; parentId?: string } | { kind: 'move' | 'delete'; folder: LibraryFolder }
export function LibraryFolderDialog({ action, folders, language, onClose, onSaved }: { action: FolderAction; folders: LibraryFolder[]; language: 'zh' | 'en'; onClose(): void; onSaved(id?: string): void }) {
  const zh = language === 'zh'
  const folder = action.kind === 'create' ? undefined : action.folder
  const [id] = useState(() => folder?.id ?? crypto.randomUUID())
  const [name, setName] = useState(folder?.name ?? '')
  const [parentId, setParentId] = useState((action.kind === 'create' ? action.parentId : folder?.parentId) ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const title = { create: zh ? '新建文件夹' : 'New folder', move: zh ? '移动文件夹' : 'Move folder', delete: zh ? '删除文件夹' : 'Delete folder' }[action.kind]
  const save = async () => {
    setBusy(true); setError('')
    try {
      await changeLibrary(action.kind === 'delete' ? { kind: 'delete-folder', id } : { kind: 'save-folder', folder: { id, name, parentId: parentId || undefined, documentIds: [] } })
      onSaved(action.kind === 'delete' ? folder?.parentId : id); onClose()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <LibraryDialog title={title} busy={busy} onClose={onClose}>
    {action.kind === 'delete' ? <p className="modal-copy">{zh ? `删除「${name}」及其中的所有内容？所有子文件夹、文档及版本历史都会永久删除，删除后不可恢复。` : `Delete “${name}” and all its contents? All subfolders, documents and revision history will be permanently deleted. This cannot be undone.`}</p> : action.kind === 'move' ? <DestinationSelect label={zh ? '移动到' : 'Move to'} value={parentId} options={folderOptions(folders, zh ? '我的资料' : 'My documents', id)} disabled={busy} autoFocus onChange={setParentId} /> : <label className="library-field">{zh ? '文件夹名称' : 'Folder name'}<input autoFocus value={name} maxLength={80} disabled={busy} placeholder={zh ? '例如：项目笔记' : 'e.g. Project notes'} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && name.trim() && !busy) void save() }} /></label>}
    {error && <p role="alert" className="library-error">{error}</p>}
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className={`primary-button ${action.kind === 'delete' ? 'danger-button' : ''}`} disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : action.kind === 'delete' ? (zh ? '删除文件夹' : 'Delete folder') : (zh ? '保存' : 'Save')}</button></footer>
  </LibraryDialog>
}
