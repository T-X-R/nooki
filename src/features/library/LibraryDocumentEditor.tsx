import type { DocumentReference } from '../../../packages/capability-contract/src/index.ts'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { Editor } from '@tiptap/react'
import { changeLibrary, readLibraryDocument, type LibraryDocument } from '../../platform/document-library.ts'
import { createLibraryDrafts } from '../../platform/library-drafts.ts'
import { LibraryRichText } from './LibraryRichText.tsx'

export function LibraryDocumentEditor({ document, language, renameTitle, onRenamed, onDocument, ref }: { ref: Ref<{ save(): Promise<boolean> }>; document: LibraryDocument; language: 'zh' | 'en'; renameTitle: boolean; onRenamed(): void; onDocument(reference: DocumentReference): void }) {
  const zh = language === 'zh'
  const [drafts] = useState(() => createLibraryDrafts(window.localStorage))
  const [recovered] = useState(() => drafts.get(document))
  const [title, setTitle] = useState(recovered?.title ?? document.title)
  const [content, setContent] = useState(recovered?.content ?? document.content)
  const state = useRef({ base: document, title, content, revision: recovered?.revision ?? document.revision ?? document.updatedAt })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<Promise<boolean> | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const editor = useRef<Editor | null>(null)
  const mounted = useRef(true)
  const deleted = useRef(false)
  const remember = () => {
    if (deleted.current) return
    const draft = state.current
    try { drafts.save(document.id, { title: draft.title, content: draft.content, revision: draft.revision }) }
    catch (reason) { if (mounted.current) setError(String(reason)) }
  }
  const save = async (): Promise<boolean> => {
    if (deleted.current) return false
    if (pending.current) { if (!await pending.current) return false; return save() }
    const { base, title, content, revision } = state.current
    if (!title.trim()) { if (mounted.current) setError(zh ? '标题不能为空，草稿已保留。' : 'A title is required. Your draft is kept.'); return false }
    if (title === base.title && content === base.content) return true
    if (mounted.current) { setBusy(true); setError('') }
    const operation = (async () => {
      try {
        const metadata = await changeLibrary({ kind: 'edit', id: document.id, title: title.trim(), content, expected: revision })
        if (deleted.current) return false
        const saved = { ...base, ...metadata, title: title.trim(), content }
        const current = state.current
        current.base = saved; current.revision = saved.revision ?? saved.updatedAt
        if (current.title === title && current.content === content) { current.title = saved.title; drafts.remove(document.id); if (mounted.current) setTitle(saved.title) }
        else remember()
        return true
      } catch (reason) { if (mounted.current) setError(String(reason)); return false }
      finally { pending.current = null; if (mounted.current) setBusy(false) }
    })()
    pending.current = operation
    if (!await operation) return false
    return state.current.title !== state.current.base.title || state.current.content !== state.current.base.content ? save() : true
  }
  const reload = async () => {
    try {
      const current = await readLibraryDocument(document.id)
      state.current = { base: current, title: current.title, content: current.content, revision: current.revision ?? current.updatedAt }
      drafts.remove(document.id); setTitle(current.title); setContent(current.content); setError('')
      editor.current?.commands.setContent(current.content, { contentType: 'markdown', emitUpdate: false })
    } catch (reason) { setError(String(reason)) }
  }
  const saveRef = useRef(save); saveRef.current = save
  useEffect(() => {
    const removed = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes(document.id)) deleted.current = true }
    window.addEventListener('workbench:library-documents-deleted', removed)
    return () => window.removeEventListener('workbench:library-documents-deleted', removed)
  }, [document.id, drafts])
  useImperativeHandle(ref, () => ({ save: () => saveRef.current() }))
  useEffect(() => { if (renameTitle) { titleInput.current?.focus(); titleInput.current?.select(); onRenamed() } }, [renameTitle, onRenamed])
  useEffect(() => {
    const current = state.current
    if ((document.revision ?? document.updatedAt) === current.revision || pending.current || current.title !== current.base.title || current.content !== current.base.content) return
    current.base = document; current.title = document.title; current.content = document.content; current.revision = document.revision ?? document.updatedAt
    setTitle(document.title); setContent(document.content); editor.current?.commands.setContent(document.content, { contentType: 'markdown', emitUpdate: false })
  }, [document])
  useEffect(() => { const timer = window.setTimeout(() => { void saveRef.current() }, 800); return () => window.clearTimeout(timer) }, [title, content])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; void saveRef.current() } }, [])
  return <section className="library-inline-document" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void saveRef.current() }}>
    <header className="library-reader-header">
      <input ref={titleInput} className="library-inline-document-title" aria-label={zh ? '文档标题' : 'Document title'} maxLength={120} value={title} onChange={event => { state.current.title = event.target.value; setTitle(event.target.value); remember() }} onBlur={() => { void save() }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') { event.preventDefault(); void save().then(ok => { if (ok) editor.current?.commands.focus() }) }
        if (event.key === 'Escape') { event.preventDefault(); state.current.title = state.current.base.title; setTitle(state.current.title); remember(); titleInput.current?.blur() }
      }} />
      {busy && <small className="library-save-status" role="status">{zh ? '保存中…' : 'Saving…'}</small>}
    </header>
    {error && <div className="library-inline-save-error"><p role="alert">{error}</p><button className="quiet-button" disabled={busy} onClick={() => { void save() }}>{zh ? '重试保存' : 'Retry save'}</button>{/Document changed/.test(error) && <button className="quiet-button" disabled={busy} onClick={() => { void reload() }}>{zh ? '放弃草稿，读取最新文档' : 'Discard draft and reload'}</button>}</div>}
    <div className="library-reader-content"><LibraryRichText initial={recovered?.content ?? document.content} language={language} onDocument={onDocument} onReady={value => { editor.current = value }} onSave={() => { void saveRef.current() }} onChange={value => { state.current.content = value; setContent(value); remember() }} /></div>
  </section>
}
