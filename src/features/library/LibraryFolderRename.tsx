import { useEffect, useRef, useState } from 'react'
import { changeLibrary, type LibraryFolder } from '../../platform/document-library.ts'

export function LibraryFolderRename({ folder, language, onFinish }: { folder: LibraryFolder; language: 'zh' | 'en'; onFinish(): void }) {
  const [name, setName] = useState(folder.name)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  const finish = () => {
    const row = input.current?.closest('.library-directory-row, .library-folder-item, .library-folder-heading')
    onFinish()
    requestAnimationFrame(() => row?.querySelector<HTMLElement>('button.library-directory-label, button.library-folder-item-label, h2')?.focus())
  }
  const save = async () => {
    if (pending.current) return
    if (name.trim() === folder.name) { pending.current = true; finish(); return }
    if (!name.trim()) { setError(language === 'zh' ? '请输入文件夹名称' : 'Enter a folder name'); input.current?.focus(); return }
    pending.current = true; setBusy(true); setError('')
    try { await changeLibrary({ kind: 'save-folder', folder: { ...folder, name } }); finish() }
    catch (reason) { pending.current = false; setBusy(false); setError(String(reason)); requestAnimationFrame(() => input.current?.focus()) }
  }
  return <span className="library-inline-rename" onClick={event => event.stopPropagation()}>
    <input ref={input} aria-label={language === 'zh' ? '文件夹名称' : 'Folder name'} maxLength={80} value={name} readOnly={busy} aria-invalid={!!error} onChange={event => { setName(event.target.value); setError('') }} onBlur={() => { void save() }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Enter') { event.preventDefault(); void save() }
      if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); pending.current = true; finish() }
    }} />
    {error && <small role="alert">{error}</small>}
  </span>
}
