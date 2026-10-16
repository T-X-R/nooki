import { useState } from 'react'
import { Pencil2Icon, TrashIcon } from '@radix-ui/react-icons'
import { changeLibrary, type LibrarySection } from '../../platform/document-library.ts'
import { LibraryDialog } from './LibraryDialogs.tsx'

export function LibrarySectionActions({ section, language }: { section: LibrarySection; language: 'zh' | 'en' }) {
  const zh = language === 'zh'
  const [action, setAction] = useState<'rename' | 'delete' | null>(null)
  const [name, setName] = useState(section.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (busy || !action) return
    setBusy(true); setError('')
    try {
      await changeLibrary(action === 'rename' ? { kind: 'rename-section', id: section.id, name } : { kind: 'delete-section', id: section.id })
      setAction(null)
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <div className="library-section-actions">
    <button className="icon-button" aria-label={`${zh ? '重命名栏目' : 'Rename section'}：${section.name}`} title={zh ? '重命名栏目' : 'Rename section'} onClick={() => { setName(section.name); setError(''); setAction('rename') }}><Pencil2Icon /></button>
    <button className="icon-button" aria-label={`${zh ? '删除栏目' : 'Delete section'}：${section.name}`} title={zh ? '删除栏目' : 'Delete section'} onClick={() => { setError(''); setAction('delete') }}><TrashIcon /></button>
    {action && <LibraryDialog title={action === 'rename' ? (zh ? '重命名栏目' : 'Rename section') : (zh ? '删除栏目' : 'Delete section')} busy={busy} onClose={() => setAction(null)}>
      <form onSubmit={(event) => { event.preventDefault(); void save() }}>
        {action === 'rename' ? <label className="library-field">{zh ? '栏目名称' : 'Section name'}<input autoFocus value={name} maxLength={80} disabled={busy} onChange={(event) => setName(event.target.value)} /></label> : <p className="modal-copy">{zh ? `删除「${section.name}」栏目？其中的文档会保留并回到原来源栏目，专题关联和版本历史不变。` : `Delete “${section.name}”? Documents will be kept under their original source sections, with topic links and revision history preserved.`}</p>}
        {error && <p role="alert" className="library-error">{error}</p>}
        <footer className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={() => setAction(null)}>{zh ? '取消' : 'Cancel'}</button><button type="submit" className={`primary-button ${action === 'delete' ? 'danger-button' : ''}`} disabled={busy || (action === 'rename' && (!name.trim() || name.trim() === section.name))}>{busy ? (zh ? '保存中…' : 'Saving…') : action === 'rename' ? (zh ? '保存名称' : 'Save name') : (zh ? '删除栏目' : 'Delete section')}</button></footer>
      </form>
    </LibraryDialog>}
  </div>
}
