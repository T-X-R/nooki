import { useState } from 'react'
import { changeLibrary, type LibrarySection, type Topic } from '../../platform/document-library.ts'
import { DocumentPreview, LibraryDialog } from './LibraryDialogs.tsx'
import { DestinationSelect } from '../../shared/DestinationSelect.tsx'

export function CreateDocumentDialog({ language, topic, sections, onClose, onCreated }: {
  language: 'zh' | 'en'; topic?: Topic; sections: LibrarySection[]; onClose(): void; onCreated(id: string): void
}) {
  const zh = language === 'zh'
  const [key] = useState(() => crypto.randomUUID())
  const [documentDate] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sectionId, setSectionId] = useState('workbench.documents')
  const destinations = [{ id: 'workbench.documents', name: zh ? '我的文档' : 'My documents' }, ...sections.filter((section) => section.id !== 'workbench.documents')]
  const section = destinations.find((section) => section.id === sectionId)
  const close = () => { if (title || content) setDiscard(true); else onClose() }
  const save = async () => {
    if (busy || !title.trim() || !content.trim() || !section) return
    setBusy(true); setError('')
    try {
      const doc = await changeLibrary({ kind: 'create', topicId: topic?.id, section: section.id === 'workbench.documents' ? undefined : section, document: {
        key, title: title.trim(), content, documentDate, collectionKey: 'documents', collectionName: 'My documents',
      } })
      if (!doc) throw new Error(zh ? '未能创建文档，请重试。' : 'Document could not be created. Please retry.')
      onCreated(doc.id); onClose()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <LibraryDialog wide className="library-create-dialog" title={zh ? '创建文档' : 'Create document'} busy={busy} onClose={close}>
    <p className="library-create-location">{zh ? '保存至' : 'Save to'} <strong>{topic ? `${topic.name} / ` : ''}{section?.name ?? '—'}</strong></p>
    <div className="library-create-heading">
    <label className="library-field library-create-title">{zh ? '文档标题' : 'Document title'}<input value={title} disabled={busy} maxLength={120} placeholder={zh ? '给这篇文档起个名字' : 'Give your document a name'} onChange={(event) => setTitle(event.target.value)} /></label>
    <DestinationSelect label={zh ? '保存到栏目' : 'Save to section'} value={sectionId} options={destinations} disabled={busy} onChange={(id) => { setSectionId(id); setError('') }} />
    </div>
    {!section && <p role="alert" className="library-error">{zh ? '栏目已不存在，请重新选择。' : 'This section no longer exists. Choose another section.'}</p>}
    <div className="library-create-toolbar">
      <div role="group" aria-label={zh ? '正文视图' : 'Content view'}><button aria-pressed={!preview} onClick={() => setPreview(false)}>{zh ? '编辑' : 'Edit'}</button><button aria-pressed={preview} onClick={() => setPreview(true)}>{zh ? '预览' : 'Preview'}</button></div>
      <span>{zh ? '支持 Markdown 排版' : 'Markdown supported'}</span>
    </div>
    <div className="library-create-body">{preview ? <section aria-label={zh ? '正文预览' : 'Content preview'}>{content.trim() ? <DocumentPreview content={content} /> : <p className="library-create-empty">{zh ? '写下内容后，在这里查看排版效果。' : 'Start writing to see your formatted document here.'}</p>}</section> : <label className="library-field"><span className="sr-only">{zh ? '正文' : 'Content'}</span><textarea className="library-editor" value={content} disabled={busy} placeholder={zh ? '从一个想法开始…\n\n用 # 添加标题，用 - 整理要点。' : 'Start with an idea…\n\nUse # for headings and - for lists.'} onChange={(event) => setContent(event.target.value)} /></label>}</div>
    {error && <p role="alert" className="library-error">{error}</p>}
    {discard ? <footer className="modal-footer library-create-discard"><p role="alert">{zh ? '内容尚未保存，放弃这篇文档？' : 'This document is unsaved. Discard it?'}</p><button className="secondary-button" onClick={() => setDiscard(false)}>{zh ? '继续编辑' : 'Keep editing'}</button><button className="primary-button danger-button" onClick={onClose}>{zh ? '放弃文档' : 'Discard document'}</button></footer> : <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={close}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy || !title.trim() || !content.trim() || !section} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '创建并保存' : 'Create and save')}</button></footer>}
  </LibraryDialog>
}
