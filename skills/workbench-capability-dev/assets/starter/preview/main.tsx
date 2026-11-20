import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CapabilityEnvironment } from '../contract'
import { createPreviewHost } from './host'
import capability from '../index'
import './theme.css'
import './style.css'

const { host, setEnvironment } = createPreviewHost(capability.manifest)
function Preview() {
  const [current, setCurrent] = useState(host.environment.getSnapshot)
  const [narrow, setNarrow] = useState(false)
  const update = (next: CapabilityEnvironment) => {
    setEnvironment(next); setCurrent(next); document.documentElement.dataset.theme = next.theme
  }
  return <><aside className="preview-toolbar"><strong>Nooki · UI preview</strong><span>模拟存储，刷新清空 · 其他服务需桌面验证 / Simulated storage resets on reload · Other services require desktop Nooki</span>
    <button onClick={() => update({ ...current, theme: current.theme === 'light' ? 'dark' : 'light' })}>{current.theme === 'light' ? 'Dark' : 'Light'}</button>
    <button onClick={() => update({ ...current, language: current.language === 'zh' ? 'en' : 'zh', locale: current.language === 'zh' ? 'en-US' : 'zh-CN' })}>中文 / English</button>
    <button onClick={() => setNarrow(!narrow)}>{narrow ? '1000 px' : '480 px'}</button>
  </aside><div className="preview-content" style={{ maxWidth: narrow ? 480 : 1000 }}><capability.Page host={host} /></div></>
}
createRoot(document.getElementById('root')!).render(<Preview />)
