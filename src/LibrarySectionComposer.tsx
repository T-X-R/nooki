import { CheckIcon, Cross2Icon, PlusIcon } from '@radix-ui/react-icons'
import { useState } from 'react'
import { changeLibrary } from './document-library'

export function LibrarySectionComposer({ language }: { language: 'zh' | 'en' }) {
  const zh = language === 'zh'
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="library-section-composer">
    <div className="library-section-caption"><span>{zh ? '资料栏目' : 'Sections'}</span><button className="icon-button" title={zh ? '新建栏目' : 'New section'} aria-label={zh ? '新建栏目' : 'New section'} disabled={busy} onClick={() => { setName(''); setError('') }}><PlusIcon /></button></div>
    {name !== null && <form className="nav-inline-editor" onSubmit={(e) => {
      e.preventDefault(); if (!name.trim() || busy) return
      setBusy(true); setError('')
      void changeLibrary({ kind: 'create-section', section: { id: `custom-${crypto.randomUUID()}`, name } }).then(() => setName(null)).catch((reason) => setError(String(reason))).finally(() => setBusy(false))
    }}><input autoFocus aria-label={zh ? '栏目名称' : 'Section name'} placeholder={zh ? '输入栏目名称' : 'Section name'} value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { setName(null); setError('') } }} /><button className="icon-button" type="submit" disabled={busy || !name.trim()} aria-label={zh ? '创建栏目' : 'Create section'}><CheckIcon /></button><button className="icon-button" type="button" disabled={busy} aria-label={zh ? '取消' : 'Cancel'} onClick={() => { setName(null); setError('') }}><Cross2Icon /></button></form>}
    {error && <p role="alert" className="library-error">{error}</p>}
  </div>
}
