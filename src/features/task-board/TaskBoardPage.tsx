import { Cross2Icon, PlusIcon } from '@radix-ui/react-icons'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
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

export function TaskBoardPage({ language, toolbar, activity }: { language: Language; toolbar: ReactNode; activity: ReactNode }) {
  const zh = language === 'zh'
  const state = useSyncExternalStore(taskBoard.subscribe, taskBoard.snapshot)
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const board = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const titleInput = useRef<HTMLInputElement>(null)
  const card = state.cards.find(item => item.id === selected)
  const open = creating || !!card

  const load = () => {
    setError('')
    void taskBoard.initialize().then(() => setReady(true)).catch(reason => setError(String(reason)))
  }
  useEffect(load, [])

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
  }, [open, state])

  useLayoutEffect(() => {
    if (creating) titleInput.current?.focus()
    else if (selected) closeButton.current?.focus()
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

  return <div className="task-board" ref={board} onKeyDown={event => { if (event.key === 'Escape' && open && !event.nativeEvent.isComposing) { event.preventDefault(); close() } }}>
    <div className="task-board-content" ref={content}>
      {toolbar}
      <div className="content-column">
        <header className="page-intro">
          <div><div className="eyebrow">WORKSPACE</div><h1>{zh ? '任务板' : 'Task board'}</h1></div>
          <button className="primary-button task-board-add" disabled={!ready} onClick={event => create(event.currentTarget)}><PlusIcon />{zh ? '新建任务' : 'New task'}</button>
        </header>
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
              }}><strong>{item.title}</strong><span>{zh ? '自己处理' : 'Personal'}</span></button>)}
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
        <div><div className="eyebrow">{creating ? 'TASK BOARD' : 'TASK'}</div><h2 id="task-board-detail-title">{creating ? (zh ? '新建任务' : 'New task') : card?.title}</h2></div>
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
          {error && <p className="task-board-error" role="alert">{error}</p>}
        </div>
        {card.status === 'todo' && <footer><button className="primary-button" disabled={busy} onClick={() => void act(() => taskBoard.complete(card.id))}>{zh ? '标记完成' : 'Mark done'}</button></footer>}
      </>}
    </aside>}
  </div>
}
