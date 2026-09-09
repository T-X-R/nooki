import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CapabilityEnvironment, CapabilityHost } from '../contract'
import capability from '../index'
import './theme.css'
import './style.css'

let environment: CapabilityEnvironment = { language: 'zh', locale: 'zh-CN', theme: 'light' }
const listeners = new Set<() => void>()
const unavailable = async (): Promise<never> => { throw new Error('This Host operation requires desktop Nooki; preview does not execute it.') }
const tasks: [] = []
const prefix = `workbench-preview:${capability.manifest.id}:`
const requireStorage = () => { if (!capability.manifest.permissions.includes('storage')) throw new Error('Declare storage permission') }
const host: CapabilityHost = {
  environment: { getSnapshot: () => environment, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
  storage: {
    async get<T>(key: string) { requireStorage(); return JSON.parse(localStorage.getItem(prefix + key) ?? 'null') as T | null },
    async set(key, value) { requireStorage(); localStorage.setItem(prefix + key, JSON.stringify(value)) },
    async remove(key) { requireStorage(); localStorage.removeItem(prefix + key) },
  },
  ai: { invoke: unavailable }, codex: { sessions: { readTodayFiles: unavailable } },
  documents: { publish: unavailable, listGrants: async () => [], readSelected: unavailable, open: () => { window.alert('Open this reference in desktop Nooki.') } },
  activity: { write: unavailable },
  tasks: { getSnapshot: () => tasks, subscribe: () => () => {}, start: unavailable, cancel: unavailable, retry: unavailable },
}
function Preview() {
  const [current, setCurrent] = useState(environment)
  const [narrow, setNarrow] = useState(false)
  const update = (next: CapabilityEnvironment) => {
    environment = next; setCurrent(next); document.documentElement.dataset.theme = next.theme; listeners.forEach((listener) => listener())
  }
  return <><aside className="preview-toolbar"><strong>Nooki · UI preview</strong><span>模拟数据 / Simulated data</span>
    <button onClick={() => update({ ...current, theme: current.theme === 'light' ? 'dark' : 'light' })}>{current.theme === 'light' ? 'Dark' : 'Light'}</button>
    <button onClick={() => update({ ...current, language: current.language === 'zh' ? 'en' : 'zh', locale: current.language === 'zh' ? 'en-US' : 'zh-CN' })}>中文 / English</button>
    <button onClick={() => setNarrow(!narrow)}>{narrow ? '1000 px' : '480 px'}</button>
  </aside><div className="preview-content" style={{ maxWidth: narrow ? 480 : 1000 }}><capability.Page host={host} /></div></>
}
createRoot(document.getElementById('root')!).render(<Preview />)
