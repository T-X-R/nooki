import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { BoardGrant } from '../../../packages/capability-contract/src/index.ts'
import { LibraryDialog } from '../library/LibraryDialogs.tsx'
import '../library/library-selection.css'

type Access = { grant: BoardGrant; status: 'active' | 'inactive' | 'revoked' | 'stale' }
export function TaskAccessDialog({ language, onClose }: { language: 'zh' | 'en'; onClose(): void }) {
  const zh = language === 'zh'
  const [records, setRecords] = useState<Access[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    setLoading(true); setError('')
    void invoke<Access[]>('board_task_access', { request: {} }).then(value => { if (current) setRecords(value) })
      .catch(() => { if (current) setError(zh ? '无法读取任务授权，请重试。' : 'Could not load task access. Please retry.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [refresh, zh])
  async function revoke(id: string) {
    setBusy(true); setError('')
    try { await invoke('board_revoke_task_access', { request: { id } }); setRefresh(value => value + 1) }
    catch { setError(zh ? '尚未确认撤销结果，请重试；已附加的成果不会被删除。' : 'Revocation is not confirmed. Retry; retained deliveries are not deleted.') }
    finally { setBusy(false) }
  }
  return <LibraryDialog title={zh ? '任务附加授权' : 'Task attachment access'} onClose={onClose} busy={busy} className="library-selection-dialog">
    <p className="modal-copy">{zh ? '撤销会阻止后续附加成果，不会删除任务或已附加的成果。任务发生变化后，原授权需要重新选择。' : 'Revoking blocks new attachments and preserves your tasks and retained deliveries. Changed tasks require a new selection.'}</p>
    {loading && <p role="status">{zh ? '正在读取授权…' : 'Loading access…'}</p>}
    {error && <p role="alert" className="library-error">{error}</p>}
    {error && <button className="quiet-button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{zh ? '重新加载' : 'Reload'}</button>}
    {!loading && !error && !records.length && <p role="status">{zh ? '还没有任务附加授权' : 'No task access has been granted'}</p>}
    <div className="library-access-list">{records.map(({ grant, status }) => <section key={grant.id}>
      <header><strong>{grant.capabilityId}</strong><span>{status === 'revoked' ? (zh ? '已撤销' : 'Revoked') : status === 'stale' ? (zh ? '任务已变化' : 'Task changed') : status === 'inactive' ? (zh ? '当前不可用' : 'Inactive') : (zh ? '可附加' : 'Active')}</span></header>
      <small>{grant.capabilityId} · {grant.capabilityVersion} · {new Date(grant.createdAt).toLocaleString()}</small>
      {grant.purpose && <p>{grant.purpose}</p>}
      <ul>{grant.items.map(item => <li key={item.id}>{item.title}</li>)}</ul>
      {status !== 'revoked' && <button className="secondary-button" disabled={busy || loading} onClick={() => void revoke(grant.id)}>{zh ? '撤销附加授权' : 'Revoke attachment access'}</button>}
    </section>)}</div>
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '关闭' : 'Close'}</button></footer>
  </LibraryDialog>
}
