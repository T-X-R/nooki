import { useEffect, useState } from 'react'
import { ArchiveIcon, ChevronRightIcon, ResetIcon, TrashIcon } from '@radix-ui/react-icons'
import { conversationClient } from './conversation-client'
import type { Conversation } from './conversation-model'

export function ConversationArchives({ language, onRestore }: { language: 'zh' | 'en'; onRestore(id: string): void }) {
  const zh = language === 'zh'
  const [expanded, setExpanded] = useState(false)
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
  return <section className="settings-section settings-archive-section">
    <div className="conversation-archive-header"><h2 className="conversation-archive-heading"><button className="conversation-archive-toggle" aria-label={zh ? '已归档会话' : 'Archived conversations'} aria-expanded={expanded} aria-controls="settings-conversation-archives" disabled={busy} onClick={() => { setExpanded(!expanded); setDeleting(null) }}><span className="settings-number">05</span><span>{zh ? '已归档会话' : 'Archived conversations'}</span><span aria-hidden="true" /><span className="conversation-archive-count" aria-live="polite" aria-label={loading ? (zh ? '正在读取归档数量' : 'Loading archive count') : loaded ? (zh ? `${sessions.length} 个已归档会话` : `${sessions.length} archived conversations`) : (zh ? '归档数量暂不可用' : 'Archive count unavailable')}>{loading ? '…' : loaded ? sessions.length : '—'}</span><ChevronRightIcon aria-hidden="true" /></button></h2><button className="quiet-button library-delete-action conversation-archive-clear" disabled={busy || loading || !!error || !sessions.length || !!deleting} onClick={() => { setExpanded(true); setDeleting(sessions) }}><TrashIcon />{zh ? '清空归档' : 'Delete all archived'}</button></div>
    {expanded && <div className="conversation-archives" id="settings-conversation-archives" role="region" aria-label={zh ? '已归档会话列表' : 'Archived conversation list'}>
    {deleting ? <>
      <p className="archive-copy">{zh ? `永久删除 ${deleting.length} 个已归档会话？会话记录无法恢复，已保存到资料库的资料会保留。` : `Permanently delete ${deleting.length} archived conversations? Conversation history cannot be recovered. Documents saved to the Library will remain.`}</p>
      <div className="archive-delete-preview">{deleting.slice(0, 3).map((session) => <p key={session.id}>{session.name || session.preview || (zh ? '未命名会话' : 'Untitled conversation')}</p>)}</div>
      <footer className="archive-actions"><button className="secondary-button" disabled={busy} onClick={() => { setDeleting(null); setError('') }}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button danger-button" disabled={busy} onClick={() => void act(async () => {
        for (const session of deleting) {
          await conversationClient.change(session.id, 'delete')
          setSessions((rows) => rows.filter((row) => row.id !== session.id))
          setDeleting((rows) => rows?.filter((row) => row.id !== session.id) ?? null)
        }
        setDeleting(null)
      })}>{busy ? (zh ? '删除中…' : 'Deleting…') : (zh ? '永久删除' : 'Delete permanently')}</button></footer>
    </> : <>
      <p className="archive-copy">{zh ? '暂时收起的对话。恢复后可继续讨论，也可以永久删除。' : 'Conversations set aside for later. Restore to continue, or delete permanently.'}</p>
      {loading ? <p className="library-empty-copy" role="status">{zh ? '正在读取归档…' : 'Loading archives…'}</p> : <div className="conversation-archive-list">{sessions.map((session) => <div className="conversation-archive-row" key={session.id}><span><strong>{session.name || session.preview || (zh ? '未命名会话' : 'Untitled conversation')}</strong><small>{new Date(session.updatedAt * 1000).toLocaleDateString(zh ? 'zh-CN' : 'en-US')}</small></span><button className="icon-button" disabled={busy} aria-label={`${zh ? '恢复会话' : 'Restore conversation'}：${session.name || session.preview}`} title={zh ? '恢复并打开' : 'Restore and open'} onClick={() => void act(async () => { await conversationClient.change(session.id, 'restore'); onRestore(session.id) })}><ResetIcon /></button><button className="icon-button library-delete-action" disabled={busy} aria-label={`${zh ? '删除会话' : 'Delete conversation'}：${session.name || session.preview}`} title={zh ? '永久删除' : 'Delete permanently'} onClick={() => setDeleting([session])}><TrashIcon /></button></div>)}{!sessions.length && !error && <div className="conversation-archive-empty"><ArchiveIcon /><p>{zh ? '还没有归档会话' : 'No archived conversations'}</p></div>}</div>}
    </>}
    {error && <div role="alert" className="library-error">{error}{!deleting && <button className="quiet-button" disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>{zh ? '重试' : 'Retry'}</button>}</div>}
    </div>}
  </section>
}
