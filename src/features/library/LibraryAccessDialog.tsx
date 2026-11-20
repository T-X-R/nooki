import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { DocumentGrant } from '../../../packages/capability-contract/src/index.ts'
import { LibraryDialog } from './LibraryDialogs.tsx'
import './library-selection.css'

type Access = { grant: DocumentGrant; status: 'active' | 'inactive' | 'revoked' }
export function LibraryAccessDialog({ language, names, onClose }: { language: 'zh' | 'en'; names: Map<string,string>; onClose(): void }) {
  const zh = language === 'zh'
  const [records, setRecords] = useState<Access[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    setLoading(true); setError('')
    void invoke<Access[]>('library_document_access', { request: {} }).then(value => { if (current) setRecords(value) })
      .catch(() => { if (current) setError(zh ? '无法读取资料授权，请重试。' : 'Could not load document access. Please retry.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [refresh, zh])
  async function revoke(id: string) {
    setBusy(true); setError('')
    try { await invoke('library_revoke_document_access', { request: { id } }); setRefresh(value => value + 1) }
    catch { setError(zh ? '尚未确认撤销结果，请重试；已保存的引用不会被删除。' : 'Revocation is not confirmed. Retry; retained citations are not deleted.') }
    finally { setBusy(false) }
  }
  return <LibraryDialog title={zh ? '资料读取授权' : 'Document access'} onClose={onClose} busy={busy} className="library-selection-dialog">
    <p className="modal-copy">{zh ? '撤销会阻止能力后续读取，不会删除你的资料和已有引用，也不会收回已经交给能力的内容。' : 'Revoking blocks future reads. It preserves your documents and citations and cannot recall content already delivered.'}</p>
    {loading && <p role="status">{zh ? '正在读取授权…' : 'Loading access…'}</p>}
    {error && <p role="alert" className="library-error">{error}</p>}
    {error && <button className="quiet-button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{zh ? '重新加载' : 'Reload'}</button>}
    {!loading && !error && !records.length && <p role="status">{zh ? '还没有资料读取授权' : 'No document access has been granted'}</p>}
    <div className="library-access-list">{records.map(({ grant, status }) => <section key={grant.id}>
      <header><strong>{names.get(grant.capabilityId) ?? grant.capabilityId}</strong><span>{status === 'revoked' ? (zh ? '已撤销' : 'Revoked') : status === 'inactive' ? (zh ? '当前不可用' : 'Inactive') : (zh ? '可读取' : 'Active')}</span></header>
      <small>{grant.capabilityId} · {grant.capabilityVersion} · {new Date(grant.createdAt).toLocaleString()}</small>
      {grant.purpose && <p>{grant.purpose}</p>}
      <ul>{grant.documents.map(doc => <li key={doc.reference.documentId}>{doc.reference.title}</li>)}</ul>
      {status !== 'revoked' && <button className="secondary-button" disabled={busy || loading} onClick={() => void revoke(grant.id)}>{zh ? '撤销读取授权' : 'Revoke read access'}</button>}
    </section>)}</div>
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '关闭' : 'Close'}</button></footer>
  </LibraryDialog>
}
