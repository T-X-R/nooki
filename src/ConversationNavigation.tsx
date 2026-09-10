import { ArchiveIcon, ChatBubbleIcon, ChevronRightIcon, PlusIcon } from '@radix-ui/react-icons'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { conversationClient } from './conversation-client'
import { CONVERSATION_OWNER, type Conversation, type ConversationInput } from './conversation-model'
import { taskRunner } from './tasks'

export function ConversationNavigation({ language, active, selectedId, onEnter, onSelect }: {
  language: 'zh' | 'en'; active: boolean; selectedId: string | null; onEnter(): void; onSelect(id: string | null): void
}) {
  const zh = language === 'zh'
  const [changing, setChanging] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { const changed = () => setRefresh((value) => value + 1); window.addEventListener('workbench:conversations-changed', changed); return () => window.removeEventListener('workbench:conversations-changed', changed) }, [])
  const [expanded, setExpanded] = useState(active)
  const [sessions, setSessions] = useState<Conversation[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tasks = useSyncExternalStore(taskRunner.subscribe, taskRunner.getSnapshot, taskRunner.getSnapshot)
  const cache = useSyncExternalStore(conversationClient.subscribe, conversationClient.getSnapshot, conversationClient.getSnapshot)
  const history = new Map(sessions.map((session) => [session.id, session]))
  for (const task of tasks) {
    if (task.capabilityId !== CONVERSATION_OWNER || task.job !== 'respond') continue
    const input = task.input as ConversationInput
    const session = history.get(input.threadId) ?? (task.status === 'running' ? cache[input.threadId] : undefined)
    if (!session) continue
    history.set(input.threadId, {
      ...session, id: input.threadId, preview: session?.preview || input.message,
      updatedAt: Math.max(session?.updatedAt ?? 0, Date.parse(task.createdAt) / 1000), turns: [],
    })
  }
  const visibleSessions = [...history.values()].filter((session) => !cache[session.id]?.archived).sort((a, b) => b.updatedAt - a.updatedAt)
  const taskStatus = tasks.filter((task) => task.capabilityId === CONVERSATION_OWNER && task.job === 'respond').map((task) => `${task.id}:${task.status}`).join(',')
  useEffect(() => { if (active) setExpanded(true) }, [active])
  useEffect(() => {
    if (!expanded) return
    let current = true
    setBusy(true); setError(null)
    void conversationClient.list().then((page) => {
      if (current) { setSessions(page.data); setCursor(page.nextCursor) }
    }).catch((reason) => { if (current) setError(String(reason)) }).finally(() => { if (current) setBusy(false) })
    return () => { current = false }
  }, [expanded, taskStatus, refresh])
  const more = async () => {
    setBusy(true); setError(null)
    try {
      const page = await conversationClient.list(cursor)
      setSessions((previous) => [...previous, ...page.data.filter((item) => !previous.some((p) => p.id === item.id))]); setCursor(page.nextCursor)
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <div className="nav-conversations">
    <button className={`nav-item ${active ? 'is-active' : ''}`} aria-label={zh ? '对话' : 'Conversations'} aria-current={active ? 'page' : undefined} aria-expanded={expanded} aria-controls="sidebar-conversation-history" onClick={() => { setExpanded(active ? !expanded : true); onEnter() }}><span className="nav-item-main"><ChatBubbleIcon />{zh ? '对话' : 'Conversations'}</span><ChevronRightIcon /></button>
    {expanded && <div className="nav-conversation-history" id="sidebar-conversation-history">
      <button aria-current={active && !selectedId ? 'page' : undefined} onClick={() => onSelect(null)}><PlusIcon /><span>{zh ? '新对话' : 'New conversation'}</span></button>
      {visibleSessions.map((session) => {
        const running = tasks.some((task) => task.capabilityId === CONVERSATION_OWNER && task.job === 'respond' && (task.input as ConversationInput).threadId === session.id && task.status === 'running') || session.status?.type === 'active'
        return <div className="nav-list-row" key={session.id}><button className="nav-row-label" title={session.name || session.preview} aria-current={active && selectedId === session.id ? 'page' : undefined} onClick={() => onSelect(session.id)}><span>{session.name || session.preview || (zh ? '新对话' : 'New conversation')}</span></button><div className="nav-row-actions"><button className="icon-button" disabled={!!changing || running} aria-label={`${zh ? '归档会话' : 'Archive conversation'}：${session.name || session.preview}`} title={running ? (zh ? '会话完成后可归档' : 'Archive after this conversation finishes') : (zh ? '归档会话' : 'Archive conversation')} onClick={() => {
          setChanging(session.id); setError(null)
          void conversationClient.change(session.id, 'archive').then(() => { setSessions((rows) => rows.filter((row) => row.id !== session.id)); if (selectedId === session.id) onSelect(null) }).catch((reason) => setError(String(reason))).finally(() => setChanging(null))
        }}><ArchiveIcon /></button></div></div>
      })}
      {busy && <p role="status">{zh ? '正在读取会话…' : 'Loading conversations…'}</p>}
      {error && <><p role="alert">{error}</p><button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>{zh ? '重试' : 'Retry'}</button></>}
      {!busy && !error && !visibleSessions.length && <p>{zh ? '还没有历史会话' : 'No conversations yet'}</p>}
      {cursor && <button disabled={busy} onClick={() => void more()}>{zh ? '更早的对话' : 'Older conversations'}</button>}
    </div>}
  </div>
}
