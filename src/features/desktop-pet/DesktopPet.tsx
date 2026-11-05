import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import petAnimation from '../../assets/nooki-pet-idle.webp'
import petStill from '../../assets/nooki-agent-cat.png'
import workingAnimation from '../../assets/nooki-pet-working.gif'
import workingStill from '../../assets/nooki-pet-working-still.png'
import { petActivity, petStatusLabels, type PetBoard } from './pet-activity.ts'
import './desktop-pet.css'

type Snapshot = { board: PetBoard; preferences: { language: 'zh' | 'en'; theme: 'light' | 'dark' } }
type PetView = { right: number; bottom: number; below: boolean }

export function DesktopPet() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [placement, setPlacement] = useState<PetView>({ right: 0, bottom: 0, below: false })
  const [error, setError] = useState('')
  const [navigationError, setNavigationError] = useState('')
  const [opening, setOpening] = useState(false)
  const gesture = useRef<{ x: number; y: number; dragged: boolean } | null>(null)
  const dragging = useRef(false)
  const zh = snapshot?.preferences.language !== 'en'
  const activity = petActivity(snapshot?.board ?? { cards: [] })
  const working = !error && activity.status === 'running'
  const label = error ? (zh ? '状态暂不可用' : 'Status unavailable') : !snapshot ? (zh ? '读取状态…' : 'Loading…') : petStatusLabels[activity.status][zh ? 0 : 1]

  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout>
    let movedTimer: ReturnType<typeof setTimeout>
    const off: (() => void)[] = []
    const subscribe = (promise: Promise<() => void>) => { void promise.then(unlisten => { if (current) off.push(unlisten); else unlisten() }).catch(reason => { if (current) setError(String(reason)) }) }
    async function refresh() {
      try {
        const next = await invoke<Snapshot>('desktop_pet_snapshot')
        if (current) {
          setSnapshot(next); setError('')
          document.documentElement.dataset.theme = next.preferences.theme
          document.documentElement.lang = next.preferences.language === 'zh' ? 'zh-CN' : 'en'
        }
      } catch (reason) { if (current) setError(String(reason)) }
      finally { if (current) timer = setTimeout(() => void refresh(), 2000) }
    }
    subscribe(listen('desktop-pet:collapsed', () => { dragging.current = false; clearTimeout(movedTimer); setExpanded(false) }))
    subscribe(listen('tauri://move', () => {
      if (!dragging.current) return
      clearTimeout(movedTimer)
      movedTimer = setTimeout(() => { if (dragging.current) void invoke('desktop_pet_save_position').catch(reason => setNavigationError(String(reason))) }, 350)
    }))
    void refresh()
    void invoke('desktop_pet_ready').catch(reason => setError(String(reason)))
    return () => { current = false; clearTimeout(timer); clearTimeout(movedTimer); off.forEach(unlisten => unlisten()) }
  }, [])

  async function expand(next: boolean) {
    try {
      if (dragging.current) await invoke('desktop_pet_save_position')
      dragging.current = false
      const view = await invoke<PetView | null>('desktop_pet_expand', { expanded: next })
      if (view) setPlacement(view)
      setExpanded(next); setNavigationError('')
    }
    catch (reason) { setNavigationError(String(reason)) }
  }
  async function open(id: string) {
    dragging.current = false
    setOpening(true); setNavigationError('')
    try { await invoke('desktop_pet_open_conversation', { id }); setExpanded(false) }
    catch (reason) { setNavigationError(String(reason)) }
    finally { setOpening(false) }
  }
  function drag(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current
    if (!start || start.dragged || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return
    start.dragged = true
    dragging.current = true
    void getCurrentWindow().startDragging().catch(reason => { dragging.current = false; setNavigationError(String(reason)) })
  }
  return <div className="desktop-pet" data-panel-below={expanded && placement.below} style={{ '--pet-right': `${expanded ? placement.right : 0}px`, '--pet-bottom': `${expanded ? placement.bottom : 0}px` } as CSSProperties} onKeyDown={event => { if (event.key === 'Escape') void expand(false) }}>
    {expanded && <section className="pet-activity" aria-label={zh ? '任务状态' : 'Task activity'}>
      <header><strong>{zh ? '任务状态' : 'Task activity'}{activity.tasks.length ? ` · ${activity.tasks.length}` : ''}</strong><button type="button" aria-label={zh ? '收起任务列表' : 'Collapse task list'} onClick={() => void expand(false)}>×</button></header>
      {error ? <p role="alert">{zh ? '暂时无法读取任务状态，正在重试。' : 'Unable to read task status. Retrying.'}</p> : activity.tasks.length === 0 ? <p>{zh ? '暂无待关注的任务' : 'No tasks need attention'}</p> : <ul>{activity.tasks.map(task => <li key={task.id}>
        <button type="button" disabled={!task.threadId || opening} onClick={() => void open(task.id)}>
          <strong>{task.title}</strong><span><span>{petStatusLabels[task.status][zh ? 0 : 1]}</span><span>{task.threadId ? (zh ? '打开会话 ↗' : 'Open chat ↗') : (zh ? '等待开始' : 'Not started')}</span></span>
        </button>
      </li>)}</ul>}
      {navigationError && <p role="alert" className="pet-error">{navigationError}</p>}
    </section>}
    <div className="pet-companion">
      <button type="button" className="pet-avatar pet-art" aria-label={zh ? `查看任务状态：${label}；拖动可移动桌宠` : `View task activity: ${label}; drag to move pet`} aria-expanded={expanded}
        onPointerDown={event => { if (event.button === 0) gesture.current = { x: event.clientX, y: event.clientY, dragged: false } }} onPointerMove={drag}
        onPointerCancel={() => { gesture.current = null }} onClick={() => { if (!gesture.current?.dragged) void expand(!expanded); gesture.current = null }}>
        <img className="pet-animated" src={working ? workingAnimation : petAnimation} alt="" draggable={false} /><img className="pet-still" src={working ? workingStill : petStill} alt="" draggable={false} />
      </button>
    </div>
  </div>
}
