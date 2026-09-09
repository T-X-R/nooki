import { useRef, useState } from 'react'
import { CheckCircledIcon, Cross2Icon, CubeIcon, FileIcon, UploadIcon } from '@radix-ui/react-icons'
import { getRuntimeInstalledCapability, inspectCapabilityArchive, installCapabilityArchive } from './capability-runtime'

export function PackageImportModal({ language, onClose, onInstalled }: { language: 'zh' | 'en'; onClose(): void; onInstalled(): Promise<void> }) {
  const zh = language === 'zh'
  const input = useRef<HTMLInputElement>(null)
  const selection = useRef(0)
  const [candidate, setCandidate] = useState<Awaited<ReturnType<typeof inspectCapabilityArchive>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [trusted, setTrusted] = useState(false)
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number } | null>(null)
  const inspect = async (file: File) => {
    const current = ++selection.current
    setBusy(true); setError(null); setCandidate(null); setTrusted(false)
    setFileInfo({ name: file.name, size: file.size })
    try {
      const next = await inspectCapabilityArchive(file)
      if (current === selection.current) setCandidate(next)
    } catch (reason) { if (current === selection.current) setError(String(reason)) }
    finally { if (current === selection.current) setBusy(false) }
  }
  const install = async () => {
    if (!candidate || !trusted) return
    setBusy(true); setError(null)
    try { await installCapabilityArchive(candidate); await onInstalled(); onClose() }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const previous = candidate && getRuntimeInstalledCapability(candidate.payload.manifest.id)
  const addedPermissions = candidate?.payload.manifest.permissions.filter((permission) => !previous?.manifest.permissions.includes(permission)) ?? []
  const manifest = candidate?.payload.manifest
  const name = manifest?.locales?.[language]?.name ?? manifest?.name
  const description = manifest?.locales?.[language]?.description ?? manifest?.description
  const permissionNames = {
    storage: zh ? '保存能力数据' : 'Save capability data',
    'activity.read': zh ? '读取活动记录' : 'Read activity',
    'activity.write': zh ? '写入活动记录' : 'Write activity',
    'ai.invoke': zh ? '调用 AI 模型' : 'Use AI models',
    'codex.sessions.read': zh ? '读取 Codex 会话' : 'Read Codex sessions',
    'documents.publish': zh ? '发布文档' : 'Publish documents',
    'documents.read-selected': zh ? '读取你授权的文档' : 'Read documents you authorize',
  }
  const fileSize = fileInfo && (fileInfo.size < 1024 * 1024
    ? `${(fileInfo.size / 1024).toLocaleString(language, { maximumFractionDigits: 1 })} KB`
    : `${(fileInfo.size / (1024 * 1024)).toLocaleString(language, { maximumFractionDigits: 1 })} MB`)
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <section className="modal package-import-modal" role="dialog" aria-modal="true" aria-labelledby="package-import-title" aria-describedby="package-import-description" aria-busy={busy}>
      <div className="modal-header"><div><h2 id="package-import-title">{zh ? '安装能力包' : 'Install capability'}</h2><p id="package-import-description">{zh ? '将独立开发的能力添加到你的工作台。' : 'Add an independently built capability to your workspace.'}</p></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label={zh ? '关闭' : 'Close'}><Cross2Icon /></button></div>
      <input className="visually-hidden" ref={input} type="file" accept=".zip" aria-label={zh ? '选择能力包文件' : 'Choose capability file'} disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file); event.target.value = '' }} />
      {manifest ? <>
        <section className="package-summary">
          <div className="package-summary-heading"><span className="package-summary-icon"><CubeIcon /></span><div><div className="package-summary-name"><h3>{name}</h3><span>v{manifest.version}</span></div><code>{manifest.id}</code></div></div>
          {description && <p className="package-summary-description">{description}</p>}
          {previous && <p className="package-update">{zh ? '版本更新' : 'Version update'}<span>{previous.manifest.version} → {manifest.version}</span></p>}
          <button className="package-file" disabled={busy} onClick={() => input.current?.click()}><FileIcon /><span><strong>{fileInfo?.name}</strong><small>{fileSize}</small></span><span className="package-file-change">{zh ? '更换文件' : 'Change file'}</span></button>
        </section>
        <section className="package-permissions" aria-labelledby="package-permissions-title">
          <h3 id="package-permissions-title">{zh ? '请求的权限' : 'Requested permissions'}<span>{manifest.permissions.length}</span></h3>
          {manifest.permissions.length ? <ul>{manifest.permissions.map(permission => <li key={permission}><span>{permissionNames[permission]}</span>{previous && addedPermissions.includes(permission) && <small>{zh ? '新增' : 'New'}</small>}</li>)}</ul> : <p className="package-no-permissions"><CheckCircledIcon />{zh ? '此能力未请求额外权限' : 'This capability requests no additional permissions'}</p>}
        </section>
        <div className="package-consent"><label><input type="checkbox" checked={trusted} onChange={event => setTrusted(event.target.checked)} disabled={busy} /><span>{zh ? '我信任此包的来源，并同意授予上述权限' : 'I trust this source and agree to grant the permissions above'}</span></label><p>{zh ? '能力包与 Nooki 在同一环境运行，不提供不可信代码隔离。' : 'Capabilities run alongside Nooki, without isolation for untrusted code.'}</p></div>
      </> : <button className="package-picker" disabled={busy} onClick={() => input.current?.click()}><span className="package-picker-icon"><UploadIcon /></span><strong>{busy ? (zh ? '正在检查能力包…' : 'Checking package…') : (zh ? '选择能力包文件' : 'Choose a capability file')}</strong><span>{zh ? '.capability.zip 格式 · 最大 12 MB' : '.capability.zip format · Up to 12 MB'}</span></button>}
      {error && <p className="package-import-error" role="alert">{error}</p>}
      <div className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={!candidate || !trusted || busy} onClick={() => void install()}>{busy && candidate ? (zh ? '正在安装…' : 'Installing…') : zh ? (previous ? '确认更新' : '确认安装') : previous ? 'Confirm update' : 'Confirm installation'}</button></div>
    </section>
  </div>
}
