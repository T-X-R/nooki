import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { changeLibrary, type LibraryDocument } from '../../platform/document-library.ts'
import { createLibraryDrafts } from '../../platform/library-drafts.ts'

export function LibraryDocumentEditor({ document, language, renameTitle, onRenamed, renderMarkdown, ref }: { ref: Ref<{ save(): Promise<boolean> }>; document: LibraryDocument; language: 'zh' | 'en'; renameTitle: boolean; onRenamed(): void; renderMarkdown(content: string): ReactNode }) {
  const zh = language === 'zh'
  const [drafts] = useState(() => createLibraryDrafts(window.localStorage))
  const [recovered] = useState(() => drafts.get(document))
  const [base, setBase] = useState(document)
  const [title, setTitle] = useState(recovered?.title ?? document.title)
  const [content, setContent] = useState(recovered?.content ?? document.content)
  const [revision, setRevision] = useState(recovered?.revision ?? document.revision ?? document.updatedAt)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingBody, setEditingBody] = useState(!!recovered)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<Promise<boolean> | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const bodyInput = useRef<HTMLTextAreaElement>(null)
  const bodyView = useRef<HTMLDivElement>(null)
  const titleView = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (renameTitle) { setEditingTitle(true); onRenamed() } }, [renameTitle, onRenamed])
  useEffect(() => { if (editingTitle) { titleInput.current?.focus(); titleInput.current?.select() } }, [editingTitle])
  useEffect(() => { if (editingBody) bodyInput.current?.focus() }, [editingBody])
  useEffect(() => { const input = bodyInput.current; if (input) { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px` } }, [content, editingBody])
  const remember = (nextTitle: string, nextContent: string) => {
    try { drafts.save(document.id, { title: nextTitle, content: nextContent, revision }) }
    catch (reason) { setError(String(reason)) }
  }
  const save = (): Promise<boolean> => {
    if (pending.current) return pending.current
    if (!title.trim() || !content.trim()) { setError(zh ? '标题和正文不能为空，草稿已保留。' : 'Title and content cannot be empty. Your draft is kept.'); return Promise.resolve(false) }
    if (title === base.title && content === base.content) return Promise.resolve(true)
    setBusy(true); setError('')
    const operation = (async () => {
      try {
        const metadata = await changeLibrary({ kind: 'edit', id: document.id, title: title.trim(), content, expected: revision })
        const saved = { ...base, ...metadata, title: title.trim(), content }
        setBase(saved); setTitle(saved.title); setRevision(saved.revision ?? saved.updatedAt)
        drafts.remove(document.id)
        return true
      } catch (reason) { setError(String(reason)); return false }
      finally { pending.current = null; setBusy(false) }
    })()
    pending.current = operation
    return operation
  }
  useImperativeHandle(ref, () => ({ save }))
  const finish = async (field: 'title' | 'body') => {
    if (!await save()) return
    if (field === 'title') setEditingTitle(false); else setEditingBody(false)
  }
  const cancel = () => {
    if (busy) return
    setTitle(base.title); setContent(base.content); setRevision(base.revision ?? base.updatedAt)
    drafts.remove(document.id); setError(''); setEditingTitle(false); setEditingBody(false)
  }
  const keys = (event: React.KeyboardEvent, field: 'title' | 'body') => {
    if (event.nativeEvent.isComposing) return
    if ((field === 'title' && event.key === 'Enter') || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault(); void finish(field).then(() => requestAnimationFrame(() => (field === 'title' ? titleView.current : bodyView.current)?.focus()))
    }
    if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); cancel(); requestAnimationFrame(() => (field === 'title' ? titleView.current : bodyView.current)?.focus()) }
  }
  return <section className="library-inline-document">
    <header className="library-reader-header">
      {editingTitle ? <input ref={titleInput} className="library-inline-document-title" aria-label={zh ? '文档标题' : 'Document title'} maxLength={120} value={title} readOnly={busy} onChange={event => { setTitle(event.target.value); remember(event.target.value, content) }} onBlur={() => { void finish('title') }} onKeyDown={event => keys(event, 'title')} /> : <h2 ref={titleView} tabIndex={0} title={zh ? '点击修改标题' : 'Click to edit title'} onClick={() => { if (!busy) setEditingTitle(true) }} onKeyDown={event => { if (event.key === 'Enter' && !busy) { event.preventDefault(); setEditingTitle(true) } }}>{title}</h2>}
      <div className="library-reader-details"><small>{zh ? '更新于' : 'Updated'} {new Date(base.updatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</small>{busy && <small role="status">{zh ? '保存中…' : 'Saving…'}</small>}</div>
    </header>
    {error && <div className="library-inline-save-error"><p role="alert">{error}</p><button className="quiet-button" disabled={busy} onClick={() => { void finish('body') }}>{zh ? '重试保存' : 'Retry save'}</button></div>}
    <div className="library-reader-content">
      {editingBody ? <textarea ref={bodyInput} className="library-inline-markdown" aria-label={zh ? '编辑 Markdown' : 'Edit Markdown'} value={content} readOnly={busy} onChange={event => { setContent(event.target.value); remember(title, event.target.value) }} onBlur={() => { void finish('body') }} onKeyDown={event => keys(event, 'body')} /> : <div ref={bodyView} className="library-reader-document library-editable-preview" role="region" aria-label={zh ? '文档正文' : 'Document content'} tabIndex={0} title={zh ? '点击正文即可编辑' : 'Click to edit'} onClick={event => { if (!busy && !(event.target as HTMLElement).closest('a') && !window.getSelection()?.toString()) setEditingBody(true) }} onKeyDown={event => { if (event.key === 'Enter' && !busy && event.target === event.currentTarget) { event.preventDefault(); setEditingBody(true) } }}>{renderMarkdown(content)}</div>}
    </div>
  </section>
}
