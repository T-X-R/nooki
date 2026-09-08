import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { CheckCircledIcon, CodeIcon, CopyIcon, Cross2Icon, DownloadIcon, ReloadIcon } from '@radix-ui/react-icons'

type Tool = 'codex' | 'claude'
type Integration = {
  tool: Tool
  detected: boolean
  directory: string
  status: 'missing' | 'current' | 'update' | 'modified' | 'newer' | 'recovery'
  installedVersion: string | null
  bundledVersion: string
  platformVersion: string
  changedFiles: string[]
  detail: string | null
}

export function DeveloperCenterModal({ language, onClose }: { language: 'zh' | 'en'; onClose(): void }) {
  const { t } = useTranslation()
  const sections = [
    { title: t('developerGuideStructure'), copy: t('developerGuideStructureCopy') },
    { title: t('developerGuideHost'), copy: t('developerGuideHostCopy') },
    { title: t('developerGuideLifecycle'), copy: t('developerGuideLifecycleCopy') },
  ]
  const zh = language === 'zh'
  const desktop = Boolean(window.__TAURI_INTERNALS__)
  const [tab, setTab] = useState<'integration' | 'guide'>('guide')
  const [items, setItems] = useState<Integration[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const dialog = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const active = useRef(false)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !active.current) { event.preventDefault(); close.current() }
      if (event.key !== 'Tab') return
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length > 0)
      if (!controls.length) { event.preventDefault(); dialog.current?.focus(); return }
      const first = controls[0], last = controls.at(-1)!
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus() }
  }, [])

  const perform = async (name: string, operation: () => Promise<void>) => {
    if (active.current) return
    active.current = true; setBusy(name); setError(''); setNotice('')
    try { await operation() } catch (reason) { setError(String(reason)) }
    finally { active.current = false; setBusy(null) }
  }
  const refresh = () => perform('refresh', async () => { setItems(await invoke<Integration[]>('developer_integrations')) })
  useEffect(() => { if (desktop) void refresh() }, [desktop])

  const copyPrompt = () => perform('copy', async () => {
    const prompt = t('developerPrompt', { lng: language, skill: 'workbench-capability-dev' })
    await navigator.clipboard.writeText(prompt)
    setNotice(zh ? '开发指令已复制，请粘贴到你的开发工具中并填写需求。' : 'Prompt copied. Paste it into your coding tool and add your requirements.')
  })
  const install = (item: Integration) => perform(item.tool, async () => {
    const next = await invoke<Integration>('developer_integration_install', { tool: item.tool })
    setItems((current) => current.map((value) => value.tool === next.tool ? next : value))
    setNotice(zh ? 'Skill 已准备好。复制开发指令，在你的工具中开始；若未发现 Skill，请重启开发工具。' : 'Skill is ready. Copy the prompt to get started; restart your tool if the skill does not appear.')
  })
  const statusText = (item: Integration) => ({
    missing: zh ? '未集成' : 'Not integrated', current: zh ? '已集成' : 'Integrated',
    update: zh ? '可更新' : 'Update available', modified: zh ? '本地内容已保留' : 'Local content preserved',
    newer: zh ? '已安装更新版本' : 'Newer version installed', recovery: zh ? '需要恢复' : 'Recovery needed',
  })[item.status]
  const row = (item: Integration) => <section className="integration-tool" key={item.tool}>
    <div className="integration-tool-header">
      <div className="integration-tool-heading"><CodeIcon /><strong>{item.tool === 'codex' ? 'Codex' : 'Claude Code'}</strong><span className={`integration-badge ${item.status === 'current' ? 'ready' : ''}`}>{statusText(item)}</span></div>
      {item.status !== 'current' && item.status !== 'newer' && <div className="integration-tool-actions">
        {item.status === 'modified' ? <span className="integration-preserved">{zh ? '下载开发包进行比较' : 'Download kit to compare'}</span>
            : <button className="primary-button" disabled={Boolean(busy)} onClick={() => void install(item)}>{busy === item.tool ? (zh ? '处理中…' : 'Working…') : item.status === 'update' ? (zh ? '更新' : 'Update') : item.status === 'recovery' ? (zh ? '恢复之前的版本' : 'Restore previous version') : (zh ? '集成' : 'Integrate')}</button>}
      </div>}
    </div>
    <p>{item.detected ? (zh ? '已检测到' : 'Detected') : (zh ? '未检测到，可先集成 Skill' : 'Not detected. You can still integrate the skill.')}{item.installedVersion && ` · v${item.installedVersion}`}</p>
    <code className="integration-path">{item.directory}</code>
    {(item.detail || item.changedFiles.length > 0) && <details className="integration-changes"><summary>{zh ? '查看保留内容' : 'View preserved content'}</summary>{item.detail && <p>{item.detail}</p>}{item.changedFiles.map((file) => <code key={file}>{file}</code>)}</details>}
  </section>

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section ref={dialog} tabIndex={-1} className="modal integration-modal" role="dialog" aria-modal="true" aria-labelledby="integration-title">
      <div className="modal-header"><div><span className="section-kicker">BUILD WITH YOUR TOOLS</span><h2 id="integration-title">{t('developerCenter')}</h2></div><button className="icon-button" disabled={Boolean(busy)} onClick={onClose} aria-label={zh ? '关闭' : 'Close'}><Cross2Icon /></button></div>
      <div className="developer-center-tabs" role="tablist" aria-label={t('developerCenter')}>
        {(['guide', 'integration'] as const).map((value) => <button key={value} id={`developer-${value}-tab`} type="button" role="tab" aria-selected={tab === value} aria-controls={`developer-${value}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'guide' : event.key === 'End' ? 'integration' : value === 'integration' ? 'guide' : 'integration'
          setTab(next)
          dialog.current?.querySelector<HTMLElement>(`#developer-${next}-tab`)?.focus()
        }}>{value === 'integration' ? (zh ? '工具集成' : 'Tool integration') : t('developerGuide')}</button>)}
      </div>
      <div id="developer-guide-panel" role="tabpanel" aria-labelledby="developer-guide-tab" tabIndex={0} hidden={tab !== 'guide'}>
        <p className="modal-copy">{t('developerGuideIntro')}</p>
        <div className="developer-guide-list">
          {sections.map((section, index) => <section className="developer-guide-item" key={section.title}><span>{index + 1}</span><div><h3>{section.title}</h3><p>{section.copy}</p></div></section>)}
        </div>
        <p className="developer-guide-reference">{t('developerGuideReference')}</p>
      </div>
      <div id="developer-integration-panel" role="tabpanel" aria-labelledby="developer-integration-tab" tabIndex={0} hidden={tab !== 'integration'}>
        <p className="modal-copy">{zh ? '集成 Skill 后，复制开发指令到你的工具中开始制作能力包。' : 'Integrate the skill, then copy the development prompt into your coding tool to get started.'}</p>
        {!desktop ? <p className="integration-preview">{zh ? '请在桌面版 Workbench 中集成。浏览器预览无法检测或修改本机开发工具。' : 'Use desktop Workbench to integrate. Browser preview cannot detect or modify local coding tools.'}</p> : <>
          <div className="integration-section-heading"><span>{zh ? '当前用户的开发工具' : 'Your coding tools'}</span><button className="quiet-button" disabled={Boolean(busy)} onClick={() => void refresh()}><ReloadIcon />{zh ? '重新检测' : 'Refresh'}</button></div>
          {busy === 'refresh' && <p role="status">{zh ? '正在检测…' : 'Detecting…'}</p>}
          <div className="integration-tools">{items.map((item) => row(item))}</div>
          {items[0] && <p className="integration-version">Skill {items[0].bundledVersion} · Workbench {items[0].platformVersion} · {zh ? '可离线集成' : 'Offline integration'}</p>}
        </>}
        <div className="integration-resources">
          {desktop && <section>
            <button className="quiet-button" disabled={Boolean(busy)} onClick={() => void perform('export', async () => { const path = await invoke<string>('developer_kit_export'); setNotice(`${zh ? '开发包已保存到' : 'Kit saved to'} ${path}`) })}><DownloadIcon />{zh ? '下载开发包' : 'Download kit'}</button>
            <p>{zh ? '其他工具或自定义目录：解压后将完整文件夹放入 skills 目录。' : 'For other tools or custom paths: extract the kit into your skills directory.'}</p>
          </section>}
          <section>
            <button className="quiet-button" disabled={Boolean(busy)} onClick={() => void copyPrompt()}><CopyIcon />{zh ? '复制开发指令' : 'Copy development prompt'}</button>
            <p>{zh ? '粘贴到开发工具，填写需求后开始制作。' : 'Paste into your coding tool and add your requirements to get started.'}</p>
          </section>
        </div>
      </div>
      {notice && <p className="integration-notice" role="status"><CheckCircledIcon />{notice}</p>}
      {error && <p className="integration-error" role="alert">{error}</p>}
    </section>
  </div>
}
