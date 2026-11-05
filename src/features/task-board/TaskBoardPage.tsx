import { ArrowRightIcon, ArrowTopRightIcon, Cross2Icon, Pencil2Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { taskBoardAgent } from './task-board-agent.ts'
import type { Language } from '../../shared/i18n.ts'
import { taskBoard } from './task-board.ts'
import { TaskDescriptionInput } from './TaskDescriptionInput.tsx'
import { TaskReferences } from './TaskReferences.tsx'
import type { BoardSource, BoardStatus } from './task-board-store.ts'
import agentCat from '../../assets/nooki-agent-cat.png'
import './task-board.css'

const columns: { key: string; zh: string; en: string; hint: [string, string]; empty: [string, string]; statuses: BoardStatus[] }[] = [
  { key: 'todo', zh: '待办', en: 'To do', hint: ['想法与下一步', 'Ideas and next steps'], empty: ['等待新的待办', 'Waiting for your next idea'], statuses: ['todo', 'queued'] },
  { key: 'running', zh: '执行中', en: 'In progress', hint: ['Agent 正在推进', 'Agent is working'], empty: ['暂无执行中的任务', 'No tasks in progress'], statuses: ['running'] },
  { key: 'review', zh: '待我处理', en: 'Needs attention', hint: ['补充信息或验收成果', 'Input or delivery review'], empty: ['暂时没有需要你处理的任务', 'Nothing needs your attention'], statuses: ['question', 'review', 'stopped'] },
  { key: 'done', zh: '已完成', en: 'Done', hint: ['已完成与验收的任务', 'Finished and accepted'], empty: ['完成的任务会留在这里', 'Completed tasks will appear here'], statuses: ['done'] },
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
  const [draftSources, setDraftSources] = useState<BoardSource[]>([])
  const [editDraft, setEditDraft] = useState<{ id: string; title: string; description: string; sources: BoardSource[] } | null>(null)
  const board = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const card = state.cards.find(item => item.id === selected)
  const editing = card?.status === 'todo' && editDraft?.id === card.id ? editDraft : null
  const composing = creating || !!editing
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
  const cardDate = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  const fullDate = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' })
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
    if (creating || editing) titleInput.current?.focus({ preventScroll: true })
    else if (selected) closeButton.current?.focus({ preventScroll: true })
  }, [creating, selected, editing?.id])

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

  function submitResponse(id: string) {
    return act(async () => {
      await taskBoard.continue(id, response)
      setResponse('')
      setRevising(false)
    })
  }

  const statusBadge = (status: BoardStatus) => <span className={`task-board-status ${status}`}>{statuses[status]}</span>
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
          {columns.map((column, index) => {
            const cards = state.cards.filter(item => column.statuses.includes(item.status))
            return <section className={`task-board-lane ${column.key}`} key={column.key} aria-label={zh ? column.zh : column.en}>
              <header className="task-board-lane-heading"><h2><span className="task-board-stage-marker" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{zh ? column.zh : column.en}<span className="task-board-count">{cards.length}</span></h2><p>{column.hint[zh ? 0 : 1]}</p></header>
              <div className="task-board-lane-cards">{cards.map(item => <button key={item.id} className="task-board-card" aria-controls={open ? 'task-board-detail' : undefined} aria-pressed={item.id === selected} onClick={event => {
                if (selected === item.id && !creating) { close(); return }
                trigger.current = event.currentTarget
                setCreating(false)
                setSelected(item.id)
                setError('')
              }}><strong>{item.title}</strong>{item.createdAt === undefined
                ? <span className="task-board-card-date" aria-label={zh ? '未记录日期' : 'Date not recorded'}>—</span>
                : <time className="task-board-card-date" dateTime={new Date(item.createdAt).toISOString()}>{cardDate.format(item.createdAt)}</time>}{item.status === 'queued' && <span className="task-board-card-queued">{statuses.queued}</span>}</button>)}
              {!cards.length && <p className="task-board-empty">{column.empty[zh ? 0 : 1]}</p>}</div>
            </section>
          })}
        </div>
      </div>
    </div>
    {open && <aside ref={panel} className={`task-board-panel ${composing ? 'task-board-panel-create' : ''}`} id="task-board-detail" aria-labelledby="task-board-detail-title">
      <header>
        <div className="task-board-detail-heading"><h2 id={composing ? 'task-board-detail-title' : undefined}>{creating ? (zh ? '新建任务' : 'New task') : editing ? (zh ? '编辑任务' : 'Edit task') : (zh ? '任务详情' : 'Task details')}</h2></div>
        <div className="task-board-panel-tools">
          {!creating && !editing && card?.status === 'todo' && <button className="icon-button" disabled={busy} aria-label={zh ? '编辑任务' : 'Edit task'} title={zh ? '编辑任务' : 'Edit task'} onClick={() => {
            setEditDraft({ id: card.id, title: card.title, description: card.description, sources: card.sources ?? [] })
            setError('')
          }}><Pencil2Icon /></button>}
          {!creating && card && <button className="icon-button task-board-delete" disabled={busy} aria-label={zh ? '删除任务' : 'Delete task'} title={zh ? '删除任务' : 'Delete task'} onClick={() => void act(async () => {
            await taskBoardAgent.remove(card.id)
            setEditDraft(current => current?.id === card.id ? null : current)
            setSelected(current => current === card.id ? null : current)
            requestAnimationFrame(() => {
              if (!panel.current) board.current?.querySelector<HTMLButtonElement>('.task-board-add')?.focus({ preventScroll: true })
            })
          })}><TrashIcon /></button>}
          <button className="icon-button" ref={closeButton} onClick={close} aria-label={zh ? '关闭任务详情' : 'Close task details'}><Cross2Icon /></button>
        </div>
      </header>
      {composing ? <form className="task-board-form" onSubmit={event => {
        event.preventDefault()
        void act(async () => {
          if (editing) {
            await taskBoard.edit(editing.id, editing.title, editing.description, editing.sources)
            setEditDraft(null)
          } else {
            await taskBoard.add(title, description, draftSources)
            setTitle(''); setDescription(''); setDraftSources([]); close()
          }
        })
      }}>
        <div className="task-board-panel-body">
          <div className="task-board-sheet task-board-composer">
            <label><span className="visually-hidden">{zh ? '任务名称' : 'Title'}</span><input ref={titleInput} className="task-board-title-input" value={editing ? editing.title : title} onChange={event => editing ? setEditDraft(current => current ? { ...current, title: event.target.value } : current) : setTitle(event.target.value)} placeholder={zh ? '你想完成什么？' : 'What would you like to do?'} required maxLength={120} /></label>
            <TaskDescriptionInput key={editing?.id ?? 'new'} zh={zh} value={editing ? editing.description : description} sources={editing ? editing.sources : draftSources} onChange={value => editing ? setEditDraft(current => current ? { ...current, description: value } : current) : setDescription(value)} onSources={sources => editing ? setEditDraft(current => current ? { ...current, sources } : current) : setDraftSources(sources)} />
            {error && <p className="task-board-error" role="alert">{error}</p>}
          </div>
        </div>
        <footer><div><button type="button" className="task-board-compose-cancel" disabled={busy} onClick={() => {
          if (editing) { setEditDraft(null); setError('') }
          else { setTitle(''); setDescription(''); setDraftSources([]); close() }
        }}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy || !(editing ? editing.title : title).trim()}>{editing ? (zh ? '保存修改' : 'Save changes') : (zh ? '创建任务' : 'Create task')}<ArrowRightIcon /></button></div></footer>
      </form> : card && <>
        <div className="task-board-panel-body">
          <div className="task-board-sheet">
            <div className="task-board-detail-intro">
              <h2 id="task-board-detail-title">{card.title}</h2>
              <div className="task-board-detail-meta">{card.createdAt !== undefined && <time dateTime={new Date(card.createdAt).toISOString()}>{zh ? `${fullDate.format(card.createdAt)}创建` : `Created ${fullDate.format(card.createdAt)}`}</time>}{statusBadge(card.status)}</div>
            </div>
            {card.description && <p className="task-board-text task-board-detail-description">{card.description}</p>}
            <TaskReferences zh={zh} sources={card.sources ?? []} />
            {card.status === 'question' && <section><h3>{zh ? 'Agent 想确认' : 'Agent needs input'}</h3><p className="task-board-text">{card.delivery?.text}</p></section>}
            {(card.status === 'question' || (card.status === 'review' && revising)) && <label>{card.status === 'question' ? (zh ? '补充信息' : 'Additional details') : (zh ? '修改意见' : 'Revision feedback')}
              <textarea value={response} onChange={event => setResponse(event.target.value)} rows={4} maxLength={20_000} />
            </label>}
            {card.error && <p className="task-board-error" role="alert">{card.error}</p>}
            {error && <p className="task-board-error" role="alert">{error}</p>}
          </div>
        </div>
        {(card.threadId || card.status !== 'done') && <footer>
          {card.threadId && <button className="text-button task-board-conversation" onClick={() => onConversation(card.threadId!)}>{zh ? '打开执行会话' : 'Open conversation'}<ArrowTopRightIcon /></button>}
          {card.status === 'todo' && <>
            <button className="text-button task-board-complete" disabled={busy} onClick={() => void act(() => taskBoard.complete(card.id))}>{zh ? '标记完成' : 'Mark done'}</button>
            <button className="primary-button" disabled={busy || !agentAvailable} onClick={() => void act(() => taskBoardAgent.delegate(card.id, card.sources?.map(source => source.id) ?? []))}>{zh ? '交给 Agent' : 'Delegate to Agent'}</button>
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
