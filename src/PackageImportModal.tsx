import { useRef, useState } from 'react'
import { Cross2Icon, RocketIcon } from '@radix-ui/react-icons'
import { getRuntimeInstalledCapability, inspectCapabilityArchive, installCapabilityArchive } from './capability-runtime'

export function PackageImportModal({ language, onClose, onInstalled }: { language: 'zh' | 'en'; onClose(): void; onInstalled(): Promise<void> }) {
  const zh = language === 'zh'
  const input = useRef<HTMLInputElement>(null)
  const selection = useRef(0)
  const [candidate, setCandidate] = useState<Awaited<ReturnType<typeof inspectCapabilityArchive>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [trusted, setTrusted] = useState(false)
  const inspect = async (file: File) => {
    const current = ++selection.current
    setBusy(true); setError(null); setCandidate(null); setTrusted(false)
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
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="package-import-title">
      <div className="modal-header"><h2 id="package-import-title">{zh ? '安装能力包' : 'Install capability package'}</h2><button className="icon-button" disabled={busy} onClick={onClose} aria-label={zh ? '关闭' : 'Close'}><Cross2Icon /></button></div>
      <p className="modal-copy">{zh ? '选择本地 .capability.zip。检查完成后确认来源和请求的权限。' : 'Choose a local .capability.zip, then review its source and requested permissions.'}</p>
      <button className="dropzone" disabled={busy} onClick={() => input.current?.click()}><RocketIcon /><strong>{busy ? (zh ? '处理中…' : 'Working…') : candidate?.payload.manifest.name ?? (zh ? '选择能力包' : 'Choose a package')}</strong><span>.capability.zip · 12 MB</span></button>
      <input className="visually-hidden" ref={input} type="file" accept=".zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspect(file); event.target.value = '' }} />
      {candidate && <div className="package-review">
        <p><strong>{candidate.payload.manifest.name}</strong> · {candidate.payload.manifest.version}</p>
        <p>{candidate.payload.manifest.id}</p>
        {previous && <p>{zh ? '更新版本' : 'Update'}: {previous.manifest.version} → {candidate.payload.manifest.version}</p>}
        <p>{zh ? '请求的权限' : 'Requested permissions'}: {candidate.payload.manifest.permissions.join(', ') || '—'}</p>
        {previous && addedPermissions.length > 0 && <p>{zh ? '新增授权' : 'New permissions'}: {addedPermissions.join(', ')}</p>}
        <label><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} disabled={busy} /> {zh ? '我信任此包的来源，并同意上述权限。首版能力包与 Workbench 在同一环境执行，不提供不可信代码隔离。' : 'I trust this package and grant these permissions. Packages run alongside Workbench without isolation for untrusted code.'}</label>
      </div>}
      {error && <p className="package-review" role="alert">{error}</p>}
      <div className="modal-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={!candidate || !trusted || busy} onClick={() => void install()}>{zh ? (previous ? '确认更新' : '确认安装') : previous ? 'Confirm update' : 'Confirm installation'}</button></div>
    </section>
  </div>
}
