import { ArrowTopRightIcon, Cross2Icon, LightningBoltIcon, PlusIcon } from '@radix-ui/react-icons'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { LibraryDocumentMetadata } from '../../platform/library-store.ts'
import { listLibraryDocuments } from '../../platform/document-library.ts'
import { taskBoardAgent } from './task-board-agent.ts'
import type { Language } from '../../shared/i18n.ts'
import { taskBoard } from './task-board.ts'
import type { BoardStatus } from './task-board-store.ts'
import './task-board.css'

const columns: { key: string; zh: string; en: string; statuses: BoardStatus[] }[] = [
  { key: 'todo', zh: '待办', en: 'To do', statuses: ['todo', 'queued'] },
  { key: 'running', zh: '执行中', en: 'In progress', statuses: ['running'] },
  { key: 'review', zh: '待我处理', en: 'Needs attention', statuses: ['question', 'review', 'stopped'] },
  { key: 'done', zh: '已完成', en: 'Done', statuses: ['done'] },
]

export function TaskBoardPage({ language, toolbar, activity, agentAvailable, onConversation }: { language: Language; toolbar: ReactNode; activity: ReactNode; agentAvailable: boolean; onConversation(id: string): void }) {
  const zh = language === 'zh'
  const state = useSyncExternalStore(taskBoard.subscribe, taskBoard.snapshot)
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [response, setResponse] = useState('')
  const [revising, setRevising] = useState(false)
  const [documents, setDocuments] = useState<LibraryDocumentMetadata[] | null>(null)
  const [sources, setSources] = useState<string[]>([])
  const [loadingDocuments, setLoadingDocuments] = useState(false)
  const board = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const card = state.cards.find(item => item.id === selected)
  const open = creating || !!card
  const statuses: Record<BoardStatus, string> = zh
    ? { todo: '待办', queued: '排队中', running: '执行中', question: '待补充', review: '待验收', stopped: '已停止', done: '已完成' }
    : { todo: 'To do', queued: 'Queued', running: 'Running', question: 'Needs input', review: 'Ready for review', stopped: 'Stopped', done: 'Done' }
  const queued = state.cards.filter(item => item.status === 'queued').length
  const running = state.cards.some(item => item.status === 'running')
  const agentStatus = running ? (zh ? '正在处理 1 项' : 'Working on 1 task')
    : agentAvailable ? (zh ? '空闲' : 'Idle') : (zh ? 'Codex 不可用' : 'Codex unavailable')

  const load = () => {
    setError('')
    void taskBoard.initialize().then(() => setReady(true)).catch(reason => setError(String(reason)))
  }
  useEffect(load, [])
  useEffect(() => {
    setSources([])
    setResponse('')
    setRevising(false)
  }, [selected])

  useLayoutEffect(() => {
    const background = content.current
    const sidebar = panel.current
    if (!background || !sidebar || !open) return
    const sync = () => {
      const edge = background.getBoundingClientRect().right - sidebar.offsetWidth
      for (const control of background.querySelectorAll<HTMLElement>('button, summary, a[href]')) {
        const rect = control.getBoundingClientRect()
        control.inert = rect.left + rect.width / 2 >= edge
      }
    }
    sync()
    const resize = new ResizeObserver(sync)
    resize.observe(background)
    resize.observe(sidebar)
    return () => {
      resize.disconnect()
      background.querySelectorAll<HTMLElement>('[inert]').forEach(control => { control.inert = false })
    }
  }, [open, state, ready, agentAvailable])

  useLayoutEffect(() => {
    if (creating) titleInput.current?.focus({ preventScroll: true })
    else if (selected) closeButton.current?.focus({ preventScroll: true })
  }, [creating, selected])

  function close() {
    setCreating(false)
    setSelected(null)
    setError('')
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected && !trigger.current.inert) trigger.current.focus({ preventScroll: true })
      else board.current?.querySelector<HTMLButtonElement>('.task-board-add')?.focus({ preventScroll: true })
    })
  }

  function create(origin: HTMLElement) {
    trigger.current = origin
    setSelected(null)
    setCreating(true)
    setTitle('')
    setDescription('')
    setError('')
  }

  async function act(operation: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try { await operation() }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }

  async function loadDocuments() {
    if (documents || loadingDocuments) return
    setLoadingDocuments(true)
    try { setDocuments(await listLibraryDocuments()) }
    catch (reason) { setError(String(reason)) }
    finally { setLoadingDocuments(false) }
  }

  function submitResponse(id: string) {
    return act(async () => {
      await taskBoard.continue(id, response)
      setResponse('')
      setRevising(false)
    })
  }

  const statusBadge = (status: BoardStatus) => <span className={`task-board-status ${status}`}>{statuses[status]}</span>
  const agentName = (delegated: boolean) => delegated ? 'Nooki Agent' : zh ? '自己处理' : 'Personal'
  return <div className="task-board" ref={board} onKeyDown={event => { if (event.key === 'Escape' && open && !event.nativeEvent.isComposing) { event.preventDefault(); close() } }}>
    <div className="task-board-content" ref={content}>
      {toolbar}
      <div className="content-column">
        <header className="page-intro">
          <div><div className="eyebrow">WORKSPACE</div><h1>{zh ? '任务板' : 'Task board'}</h1></div>
          <button className="primary-button task-board-add" disabled={!ready} onClick={event => create(event.currentTarget)}><PlusIcon />{zh ? '新建任务' : 'New task'}</button>
        </header>
        <div className="task-board-agent">
          <span><LightningBoltIcon /><strong>Nooki Agent</strong><span role="status">{agentStatus}{queued > 0 ? (zh ? ` · ${queued} 项排队` : ` · ${queued} queued`) : ''}</span></span>
          <button className="text-button" disabled={!ready || busy} aria-pressed={!state.paused} onClick={() => void act(() => taskBoard.setPaused(!state.paused))}>{state.paused ? (zh ? '自动接取 · 暂停' : 'Auto-pickup paused') : (zh ? '自动接取 · 开启' : 'Auto-pickup on')}</button>
        </div>
        {!open && error && <p className="task-board-error" role="alert">{error} {!ready && <button className="secondary-button" onClick={load}>{zh ? '重试' : 'Retry'}</button>}</p>}
        <div className="task-board-columns">
          {columns.map(column => {
            const cards = state.cards.filter(item => column.statuses.includes(item.status))
            return <section className="task-board-lane" key={column.key} aria-label={zh ? column.zh : column.en}>
              <h2><span className={`task-board-dot ${column.key}`} />{zh ? column.zh : column.en}<span className="task-board-count">{cards.length}</span></h2>
              {cards.map(item => <button key={item.id} className="task-board-card" aria-controls={open ? 'task-board-detail' : undefined} aria-pressed={item.id === selected} onClick={event => {
                trigger.current = event.currentTarget
                setCreating(false)
                setSelected(item.id)
                setError('')
              }}><strong>{item.title}</strong><span className="task-board-card-meta">{agentName(!!item.authorization)}{['queued', 'question', 'review', 'stopped'].includes(item.status) && statusBadge(item.status)}</span></button>)}
              {column.key === 'todo' ? <button className="text-button task-board-quick-add" disabled={!ready} onClick={event => create(event.currentTarget)}><PlusIcon />{zh ? '添加待办' : 'Add to-do'}</button>
                : !cards.length && <p className="task-board-empty">{zh ? '暂无任务' : 'No tasks'}</p>}
            </section>
          })}
        </div>
        <details className="task-board-activity"><summary>{zh ? '最近活动' : 'Recent activity'}</summary>{activity}</details>
      </div>
    </div>
    {open && <aside ref={panel} className="task-board-panel" id="task-board-detail" aria-labelledby="task-board-detail-title">
      <header>
        <div><div className="eyebrow">{creating ? 'TASK BOARD' : 'TASK'}</div><h2 id="task-board-detail-title">{creating ? (zh ? '新建任务' : 'New task') : card?.title}</h2>
          {!creating && card && <div className="task-board-card-meta">{statusBadge(card.status)}<span>{agentName(!!card.authorization)}</span></div>}
        </div>
        <button className="icon-button" ref={closeButton} onClick={close} aria-label={zh ? '关闭任务详情' : 'Close task details'}><Cross2Icon /></button>
      </header>
      {creating ? <form className="task-board-form" onSubmit={event => {
        event.preventDefault()
        void act(async () => { const id = await taskBoard.add(title, description); setCreating(false); setSelected(id) })
      }}>
        <div className="task-board-panel-body">
          <label>{zh ? '任务名称' : 'Title'}<input ref={titleInput} value={title} onChange={event => setTitle(event.target.value)} required maxLength={120} /></label>
          <label>{zh ? '任务要求或备注' : 'Task requirements or notes'}<textarea value={description} onChange={event => setDescription(event.target.value)} rows={5} maxLength={20_000} /></label>
          {error && <p className="task-board-error" role="alert">{error}</p>}
        </div>
        <footer><button type="button" className="secondary-button" onClick={close}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy || !title.trim()}>{zh ? '创建任务' : 'Create task'}</button></footer>
      </form> : card && <>
        <div className="task-board-panel-body">
          <section><h3>{zh ? '任务要求' : 'Task requirements'}</h3><p className="task-board-text">{card.description || (zh ? '暂无补充说明' : 'No additional notes')}</p></section>
          {card.status === 'todo' && agentAvailable && <details className="task-board-sources" onToggle={event => { if (event.currentTarget.open) void loadDocuments() }}>
            <summary>{zh ? '关联资料（可选）' : 'Attach Library documents (optional)'}{sources.length > 0 && ` · ${sources.length}`}</summary>
            <p>{zh ? '委托时会将所选资料的当前版本提供给 Codex。' : 'Delegating shares a snapshot of the selected documents with Codex.'}</p>
            {loadingDocuments && <p role="status">{zh ? '正在读取资料…' : 'Loading documents…'}</p>}
            {documents?.length === 0 && <p>{zh ? '资料库暂无文档。' : 'The Library has no documents.'}</p>}
            {documents?.map(doc => <label key={doc.id}>
              <input type="checkbox" checked={sources.includes(doc.id)} disabled={busy || (sources.length >= 50 && !sources.includes(doc.id))} onChange={event => {
                const checked = event.target.checked
                setSources(current => checked ? [...current, doc.id] : current.filter(id => id !== doc.id))
              }} />{doc.title}
            </label>)}
          </details>}
          {!!card.authorization?.documentIds.length && <p className="task-board-muted">{zh ? `已关联 ${card.authorization.documentIds.length} 份资料快照` : `${card.authorization.documentIds.length} attached document snapshots`}</p>}
          {card.threadId && <button className="text-button task-board-conversation" onClick={() => onConversation(card.threadId!)}>{zh ? '打开执行会话' : 'Open conversation'}<ArrowTopRightIcon /></button>}
          {card.status === 'question' && <section><h3>{zh ? 'Agent 想确认' : 'Agent needs input'}</h3><p className="task-board-text">{card.delivery?.text}</p></section>}
          {card.delivery && !card.delivery.question && (card.status === 'review' || card.status === 'done') && <section>
            <h3>{zh ? '交付物' : 'Delivery'}</h3>
            {card.delivery.artifacts.map(file => <details className="task-board-file" key={file.id}><summary>{file.name}</summary><BoardMarkdown>{file.content}</BoardMarkdown></details>)}
            {card.delivery.text && <BoardMarkdown>{card.delivery.text}</BoardMarkdown>}
          </section>}
          {(card.status === 'question' || (card.status === 'review' && revising)) && <label>{card.status === 'question' ? (zh ? '补充信息' : 'Additional details') : (zh ? '修改意见' : 'Revision feedback')}
            <textarea value={response} onChange={event => setResponse(event.target.value)} rows={4} maxLength={20_000} />
          </label>}
          {card.error && <p className="task-board-error" role="alert">{card.error}</p>}
          {error && <p className="task-board-error" role="alert">{error}</p>}
        </div>
        {card.status !== 'done' && <footer>
          {card.status === 'todo' && <>
            <button className="secondary-button" disabled={busy} onClick={() => void act(() => taskBoard.complete(card.id))}>{zh ? '标记完成' : 'Mark done'}</button>
            <button className="primary-button" disabled={busy || !agentAvailable || loadingDocuments} onClick={() => void act(() => taskBoardAgent.delegate(card.id, sources))}>{zh ? '交给 Agent' : 'Delegate to Agent'}</button>
          </>}
          {card.status === 'running' && <button className="secondary-button" disabled={busy} onClick={() => void act(() => taskBoardAgent.stop(card.id))}>{zh ? '停止执行' : 'Stop execution'}</button>}
          {['queued', 'question', 'stopped'].includes(card.status) && <button className="secondary-button" disabled={busy} onClick={() => void act(() => taskBoard.withdraw(card.id))}>{zh ? '撤回委托' : 'Withdraw delegation'}</button>}
          {card.status === 'stopped' && <button className="primary-button" disabled={busy || !agentAvailable} onClick={() => void act(() => taskBoard.retry(card.id))}>{zh ? '重新排队' : 'Queue again'}</button>}
          {card.status === 'review' && (revising
            ? <button className="secondary-button" disabled={busy} onClick={() => { setRevising(false); setResponse('') }}>{zh ? '取消修改' : 'Cancel revision'}</button>
            : <>
              <button className="secondary-button" disabled={busy} onClick={() => setRevising(true)}>{zh ? '要求修改' : 'Request changes'}</button>
              <button className="primary-button" disabled={busy} onClick={() => void act(() => taskBoard.complete(card.id))}>{zh ? '验收通过' : 'Accept delivery'}</button>
            </>)}
          {(card.status === 'question' || (card.status === 'review' && revising)) && <button className="primary-button" disabled={busy || !response.trim()} onClick={() => void submitResponse(card.id)}>
            {card.status === 'question' ? (zh ? '提交并继续' : 'Submit and continue') : (zh ? '提交修改意见' : 'Submit feedback')}
          </button>}
        </footer>}
      </>}
    </aside>}
  </div>
}

function BoardMarkdown({ children }: { children: string }) {
  return <div className="conversation-markdown task-board-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img', 'a']} unwrapDisallowed>{children}</Markdown></div>
}
