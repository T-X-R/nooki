import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { libraryPicker, type LibraryPickerRequest } from '../../platform/library-picker.ts'
import type { LibraryDocumentMetadata } from '../../platform/document-library.ts'
import { LibraryDialog } from './LibraryDialogs.tsx'
import './library-selection.css'

function Selection({ request, language }: { request: LibraryPickerRequest; language: 'zh' | 'en' }) {
  const zh = language === 'zh'
  const [documents, setDocuments] = useState<LibraryDocumentMetadata[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    setLoading(true); setError('')
    void invoke<LibraryDocumentMetadata[]>('library_list_documents').then(docs => { if (current) setDocuments(docs) })
      .catch(() => { if (current) setError(zh ? '无法读取资料列表，请重试。' : 'Could not load documents. Please retry.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [refresh, zh])
  const confirm = async () => {
    setApproved(true); setBusy(true); setError('')
    try {
      const grant = await request.confirm([...selected])
      libraryPicker.complete(request, { status: 'selected', grant })
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : (zh ? '授权失败，请取消后重新选择。' : 'Access failed. Cancel and select again.'))
    } finally { setBusy(false) }
  }
  const visible = documents.filter(doc => `${doc.title} ${doc.collectionName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <LibraryDialog title={zh ? '选择要分享的资料' : 'Choose documents to share'} busy={busy} onClose={() => libraryPicker.dismiss(request)} className="library-selection-dialog">
    <div className="library-selection-recipient"><strong>{request.name}</strong><small>{request.capabilityId} · {request.version}</small></div>
    <p className="library-selection-purpose"><strong>{zh ? '用途' : 'Purpose'}</strong><span>{request.purpose}</span></p>
    <p className="modal-copy">{zh ? '只允许此能力读取所选资料的当前快照。它可能将内容用于 AI 生成；你可以随时在资料库中撤销后续读取。' : 'Allow this capability to read snapshots of the selected documents. It may use them for AI generation. You can revoke future reads in the Library.'}</p>
    <label className="library-selection-search library-field">{zh ? '按标题查找' : 'Find by title'}<input type="search" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} /></label>
    {loading ? <p role="status">{zh ? '正在读取资料列表…' : 'Loading documents…'}</p> : <fieldset className="library-selection-list" disabled={busy || approved}><legend>{zh ? `已选 ${selected.length} / ${request.limit}` : `${selected.length} / ${request.limit} selected`}</legend>
      {!visible.length && <p role="status">{documents.length ? (zh ? '没有匹配的资料' : 'No matching documents') : (zh ? '资料库中还没有文档' : 'No documents in the Library yet')}</p>}
      {visible.map(doc => <label key={doc.id}><input type="checkbox" checked={selected.includes(doc.id)} disabled={!selected.includes(doc.id) && selected.length >= request.limit}
        onChange={event => setSelected(ids => event.target.checked ? [...ids, doc.id] : ids.filter(id => id !== doc.id))} /><span><strong>{doc.title}</strong><small>{doc.capabilityName} · {doc.documentDate}</small></span></label>)}
    </fieldset>}
    {error && <p role="alert" className="library-error">{error}</p>}
    {!approved && error && <button className="quiet-button" onClick={() => setRefresh(value => value + 1)}>{zh ? '重新加载' : 'Reload'}</button>}
    {approved && error && <p className="modal-copy">{zh ? '重试会使用同一组已确认的资料。若要修改选择，请取消后重新打开。' : 'Retry uses the same approved selection. To change it, cancel and open a new picker.'}</p>}
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => libraryPicker.dismiss(request)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={loading || busy || !selected.length} onClick={() => void confirm()}>{busy ? (zh ? '正在授权…' : 'Authorizing…') : approved ? (zh ? '重试授权' : 'Retry authorization') : (zh ? '授权所选资料' : 'Authorize selected documents')}</button></footer>
  </LibraryDialog>
}
export function LibrarySelectionDialog({ language }: { language: 'zh' | 'en' }) {
  const request = useSyncExternalStore(libraryPicker.subscribe, libraryPicker.getSnapshot)
  return request ? <Selection key={request.selectionId} request={request} language={language} /> : null
}
