import { ArrowRightIcon, ArrowTopRightIcon, CheckCircledIcon, CircleIcon, Cross2Icon, FileTextIcon, Pencil2Icon, PersonIcon, PlusIcon, TrashIcon, UpdateIcon } from '@radix-ui/react-icons'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { LibraryDocumentMetadata } from '../../platform/library-store.ts'
import { listLibraryDocuments } from '../../platform/document-library.ts'
import { taskBoardAgent } from './task-board-agent.ts'
import type { Language } from '../../shared/i18n.ts'
import { taskBoard } from './task-board.ts'
import type { BoardStatus } from './task-board-store.ts'
import agentCat from '../../assets/nooki-agent-cat.png'
import './task-board.css'

const columns: { key: string; zh: string; en: string; hint: [string, string]; icon: ReactNode; statuses: BoardStatus[] }[] = [
  { key: 'todo', zh: '待办', en: 'To do', hint: ['想法与下一步', 'Ideas and next steps'], icon: <CircleIcon />, statuses: ['todo', 'queued'] },
  { key: 'running', zh: '执行中', en: 'In progress', hint: ['Agent 正在推进', 'Agent is working'], icon: <UpdateIcon />, statuses: ['running'] },
  { key: 'review', zh: '待我处理', en: 'Needs attention', hint: ['补充信息或验收成果', 'Input or delivery review'], icon: <PersonIcon />, statuses: ['question', 'review', 'stopped'] },
  { key: 'done', zh: '已完成', en: 'Done', hint: ['已完成与验收的任务', 'Finished and accepted'], icon: <CheckCircledIcon />, statuses: ['done'] },
]

export function TaskBoardPage({ language, toolbar, agentAvailable, onConversation }: { language: Language; toolbar: ReactNode; agentAvailable: boolean; onConversation(id: string): void }) {
  const zh = language === 'zh'
  const [today, setToday] = useState(() => new Date())
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
  const locale = zh ? 'zh-CN' : 'en-US'
  const dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(today)
  const shortDate = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(today)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(today)
  const dateStamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      const now = new Date()
      setToday(now)
      clearTimeout(timer)
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      timer = setTimeout(refresh, midnight.getTime() - now.getTime())
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

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
    <div className="task-board-content" ref={content} onClick={event => {
      if (open && event.target instanceof Element && !event.target.closest('button, a, input, textarea, select, label, summary')) close()
    }}>
      {toolbar}
      <div className="content-column">
        <header className="task-board-heading">
          <div className="task-board-title-group">
            <time className="task-board-date" dateTime={dateStamp} aria-label={dateLabel}><span>{shortDate}</span><span>{weekday}</span></time>
            <h1>{zh ? '任务板' : 'Task board'}</h1>
          </div>
          <button className="primary-button task-board-add" disabled={!ready} onClick={event => create(event.currentTarget)}><PlusIcon />{zh ? '新建任务' : 'New task'}</button>
        </header>
        <div className="task-board-agent">
          <span><span className={`task-board-agent-avatar ${agentAvailable ? 'available' : ''}`} aria-hidden="true"><img src={agentCat} alt="" /></span><strong>Nooki Agent</strong><span role="status">{agentStatus}{queued > 0 ? (zh ? ` · ${queued} 项排队` : ` · ${queued} queued`) : ''}</span></span>
          <button className="text-button" disabled={!ready || busy} aria-pressed={!state.paused} onClick={() => void act(() => taskBoard.setPaused(!state.paused))}>{state.paused ? (zh ? '自动接取 · 暂停' : 'Auto-pickup paused') : (zh ? '自动接取 · 开启' : 'Auto-pickup on')}</button>
        </div>
        {!open && error && <p className="task-board-error" role="alert">{error} {!ready && <button className="secondary-button" onClick={load}>{zh ? '重试' : 'Retry'}</button>}</p>}
        <div className="task-board-columns">
          {columns.map(column => {
            const cards = state.cards.filter(item => column.statuses.includes(item.status))
            return <section className={`task-board-lane ${column.key}`} key={column.key} aria-label={zh ? column.zh : column.en}>
              <header className="task-board-lane-heading"><h2><span className="task-board-stage-icon" aria-hidden="true">{column.icon}</span>{zh ? column.zh : column.en}<span className="task-board-count">{cards.length}</span></h2><p>{column.hint[zh ? 0 : 1]}</p></header>
              <div className="task-board-lane-cards">{cards.map(item => <button key={item.id} className="task-board-card" aria-controls={open ? 'task-board-detail' : undefined} aria-pressed={item.id === selected} onClick={event => {
                if (selected === item.id && !creating) { close(); return }
                trigger.current = event.currentTarget
                setCreating(false)
                setSelected(item.id)
                setError('')
              }}><strong>{item.title}</strong>{item.description && <span className="task-board-card-preview">{item.description}</span>}<span className="task-board-card-meta">{agentName(!!item.authorization)}{['queued', 'question', 'review', 'stopped'].includes(item.status) && statusBadge(item.status)}</span></button>)}
              {!cards.length && <div className="task-board-empty"><span aria-hidden="true">{column.icon}</span><p>{zh ? '暂无任务' : 'No tasks'}</p></div>}</div>
            </section>
          })}
        </div>
      </div>
    </div>
    {open && <aside ref={panel} className={`task-board-panel ${creating ? 'task-board-panel-create' : ''}`} id="task-board-detail" aria-labelledby="task-board-detail-title">
      <header>
        <div className="task-board-create-heading"><span className="task-board-compose-icon">{creating ? <Pencil2Icon /> : <FileTextIcon />}</span><h2 id={creating ? 'task-board-detail-title' : undefined}>{creating ? (zh ? '新建任务' : 'New task') : (zh ? '任务详情' : 'Task details')}</h2></div>
        <div className="task-board-panel-tools">
          {!creating && card && <button className="icon-button task-board-delete" disabled={busy} aria-label={zh ? '删除任务' : 'Delete task'} title={zh ? '删除任务' : 'Delete task'} onClick={() => void act(async () => {
            await taskBoardAgent.remove(card.id)
            setSelected(current => current === card.id ? null : current)
            requestAnimationFrame(() => {
              if (!panel.current) board.current?.querySelector<HTMLButtonElement>('.task-board-add')?.focus({ preventScroll: true })
            })
          })}><TrashIcon /></button>}
          <button className="icon-button" ref={closeButton} onClick={close} aria-label={zh ? '关闭任务详情' : 'Close task details'}><Cross2Icon /></button>
        </div>
      </header>
      {creating ? <form className="task-board-form" onSubmit={event => {
        event.preventDefault()
        void act(async () => { await taskBoard.add(title, description); setTitle(''); setDescription(''); close() })
      }}>
        <div className="task-board-panel-body">
          <div className="task-board-composer">
            <label><span className="visually-hidden">{zh ? '任务名称' : 'Title'}</span><input ref={titleInput} className="task-board-title-input" value={title} onChange={event => setTitle(event.target.value)} placeholder={zh ? '你想完成什么？' : 'What would you like to do?'} required maxLength={120} /></label>
            <label className="task-board-description-label"><span>{zh ? '任务要求或备注' : 'Task requirements or notes'}</span><textarea value={description} onChange={event => setDescription(event.target.value)} placeholder={zh ? '补充背景、需要的结果，或一条完成标准…' : 'Add context, the result you need, or what success looks like…'} rows={7} maxLength={20_000} /></label>
          </div>
          {error && <p className="task-board-error" role="alert">{error}</p>}
        </div>
        <footer><div><button type="button" className="task-board-compose-cancel" onClick={() => { setTitle(''); setDescription(''); close() }}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy || !title.trim()}>{zh ? '创建任务' : 'Create task'}<ArrowRightIcon /></button></div></footer>
      </form> : card && <>
        <div className="task-board-panel-body">
          <div className="task-board-detail-intro">
            <div className="task-board-detail-meta">{statusBadge(card.status)}<span>{card.authorization ? <img src={agentCat} alt="" /> : <PersonIcon />}{agentName(!!card.authorization)}</span></div>
            <h2 id="task-board-detail-title">{card.title}</h2>
            <ol className="task-board-progress" aria-label={zh ? '任务阶段' : 'Task stages'}>{columns.map(column => <li key={column.key} aria-current={column.statuses.includes(card.status) ? 'step' : undefined}><span /><span>{zh ? column.zh : column.en}</span></li>)}</ol>
          </div>
          <section className="task-board-requirements"><h3><FileTextIcon />{zh ? '任务要求' : 'Task requirements'}</h3><p className={`task-board-text ${!card.description ? 'task-board-muted' : ''}`}>{card.description || (zh ? '暂无补充说明' : 'No additional notes')}</p></section>
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
