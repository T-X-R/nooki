import { useEffect, useState } from 'react'
import { ResetIcon, TrashIcon } from '@radix-ui/react-icons'
import { LibraryDialog } from '../library/LibraryDialogs.tsx'
import { conversationClient } from './conversation-client.ts'
import type { Conversation } from './conversation-model.ts'

// Archives are conversation data, so they are reached from the conversation list in the sidebar.
// They are not a section of the conversation itself: the conversation surface shows one thread and
// the composer, and nothing that is put away belongs above it.
export function ConversationArchivesDialog({ language, onRestore, onClose }: { language: 'zh' | 'en'; onRestore(id: string): void; onClose(): void }) {
  const zh = language === 'zh'
  const [loaded, setLoaded] = useState(false)
  const [sessions, setSessions] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [deleting, setDeleting] = useState<Conversation[] | null>(null)
  const readArchive = async (current = () => true) => {
    const all = new Map<string, Conversation>()
    let cursor: string | null = null
    const seen = new Set<string>()
    do {
      const page = await conversationClient.list(cursor, true)
      page.data.forEach((session) => all.set(session.id, session))
      cursor = page.nextCursor
      if (cursor && seen.has(cursor)) throw new Error(zh ? '归档列表读取不完整，请重试。' : 'Incomplete archive listing. Please retry.')
      if (cursor) seen.add(cursor)
    } while (cursor && current())
    return [...all.values()]
  }
  useEffect(() => {
    let current = true
    setLoading(true); setLoaded(false); setError('')
    void readArchive(() => current).then((rows) => { if (current) { setSessions(rows); setLoaded(true) } })
      .catch((reason) => { if (current) setError(String(reason)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [reload, zh])
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn() } catch (reason) {
      setError(String(reason))
      // A lost response can follow a successful mutation. Reconcile before retrying.
      try {
        const rows = await readArchive()
        setSessions(rows); setLoaded(true)
        setDeleting((pending) => { const remaining = pending?.filter((session) => rows.some((row) => row.id === session.id)); return remaining?.length ? remaining : null })
      } catch (refreshError) { setError(`${String(reason)} · ${String(refreshError)}`) }
    } finally { setBusy(false) }
  }
  const summary = loading ? (zh ? '正在读取归档…' : 'Loading archives…')
    : !loaded ? (zh ? '归档数量暂不可用。' : 'Archive count unavailable.')
      : zh ? `${sessions.length} 个已归档会话。恢复后可继续讨论，也可以永久删除。` : `${sessions.length} archived conversations. Restore to continue, or delete permanently.`
  return <LibraryDialog className="conversation-archive-dialog" title={zh ? '已归档会话' : 'Archived conversations'} busy={busy} onClose={onClose}>
    <p className="modal-copy conversation-archive-copy" aria-live="polite">{summary}</p>
    {!loading && <div className="conversation-archive-list" role="region" aria-label={zh ? '已归档会话列表' : 'Archived conversation list'}>
      {sessions.map((session) => <div className="conversation-archive-row" key={session.id}>
        <span><strong>{session.name || session.preview || (zh ? '未命名会话' : 'Untitled conversation')}</strong><small>{new Date(session.updatedAt * 1000).toLocaleDateString(zh ? 'zh-CN' : 'en-US')}</small></span>
        <button className="icon-button" disabled={busy} aria-label={`${zh ? '恢复会话' : 'Restore conversation'}：${session.name || session.preview}`} title={zh ? '恢复并打开' : 'Restore and open'} onClick={() => void act(async () => { await conversationClient.change(session.id, 'restore'); onRestore(session.id); onClose() })}><ResetIcon /></button>
        <button className="icon-button library-delete-action" disabled={busy} aria-label={`${zh ? '删除会话' : 'Delete conversation'}：${session.name || session.preview}`} title={zh ? '永久删除' : 'Delete permanently'} onClick={() => setDeleting([session])}><TrashIcon /></button>
      </div>)}
      {!sessions.length && !error && <div className="conversation-archive-empty"><p>{zh ? '还没有归档会话' : 'No archived conversations'}</p></div>}
    </div>}
    {error && <div role="alert" className="library-error">{error}{!deleting && <button className="quiet-button" disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>{zh ? '重试' : 'Retry'}</button>}</div>}
    {deleting
      ? <div className="conversation-archive-confirm">
        <p className="modal-copy" role="alert">{zh ? `永久删除 ${deleting.length} 个已归档会话？会话记录无法恢复，已保存到资料库的资料会保留。` : `Permanently delete ${deleting.length} archived conversations? Conversation history cannot be recovered. Documents saved to the Library will remain.`}</p>
        <footer className="modal-footer">
          <button className="secondary-button" disabled={busy} onClick={() => { setDeleting(null); setError('') }}>{zh ? '取消' : 'Cancel'}</button>
          <button className="primary-button danger-button" disabled={busy} onClick={() => void act(async () => {
            for (const session of deleting) {
              await conversationClient.change(session.id, 'delete')
              setSessions((rows) => rows.filter((row) => row.id !== session.id))
              setDeleting((rows) => rows?.filter((row) => row.id !== session.id) ?? null)
            }
            setDeleting(null)
          })}>{busy ? (zh ? '删除中…' : 'Deleting…') : (zh ? '永久删除' : 'Delete permanently')}</button>
        </footer>
      </div>
      : <footer className="modal-footer">
        <button className="quiet-button library-delete-action conversation-archive-clear" disabled={busy || loading || !!error || !sessions.length} onClick={() => setDeleting(sessions)}><TrashIcon />{zh ? '删除全部' : 'Delete all'}</button>
        <button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '关闭' : 'Close'}</button>
      </footer>}
  </LibraryDialog>
}
