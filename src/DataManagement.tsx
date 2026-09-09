import { useEffect, useRef, useState } from 'react'
import type { InstalledCapability } from './capability-host'
import { LibraryDialog } from './LibraryDialogs'
import { exportUserData, isUserDataKey, localUserData, parseBackup, restoreUserData, type DataBackup } from './user-data'
import { taskRunner } from './tasks'

export function DataManagement({ language, installed }: { language: 'zh' | 'en'; installed: InstalledCapability[] }) {
  const zh = language === 'zh'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [backup, setBackup] = useState<DataBackup | null>(null)
  const [clearId, setClearId] = useState<string | null>(null)
  const [storage, setStorage] = useState<Record<string, string>>({})
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { setStorage(localUserData()) }, [])
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await fn(); setStorage(localUserData()) } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const groups = new Map<string, number>()
  for (const [key, value] of Object.entries(storage)) {
    const id = /^personal-workbench:capability:([^:]+):/.exec(key)?.[1]
    if (id) groups.set(id, (groups.get(id) ?? 0) + new TextEncoder().encode(value).length)
  }
  const name = (id: string) => { const cap = installed.find((c) => c.manifest.id === id); return cap?.manifest.locales?.[language]?.name ?? cap?.manifest.name ?? id }
  return <div className="data-management">
    <p className="modal-copy">{zh ? '备份包含资料、专题、版本历史、回收站、引用快照、任务记录、活动、能力内部数据和界面偏好。能力清单供重新安装时参考；备份不包含能力程序、AI 凭据或由 Codex 保存的会话历史。' : 'Backups include documents, topics, revisions, Trash, source snapshots, tasks, activity, capability data and interface preferences. The capability inventory helps with reinstallation. Executable packages, AI credentials and Codex-owned conversation history are excluded.'}</p>
    <div className="library-management-group"><button className="primary-button" disabled={busy} onClick={() => void act(async () => { setNotice(await exportUserData()) })}>{zh ? '备份数据' : 'Back up data'}</button><button className="secondary-button" disabled={busy} onClick={() => input.current?.click()}>{zh ? '从备份恢复…' : 'Restore backup…'}</button></div>
    <input hidden type="file" ref={input} accept=".json" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void act(async () => { if (file.size > 160_000_000) throw new Error('Backup exceeds 160 MB'); setBackup(parseBackup(await file.text())) }) }} />
    {notice && <p className="library-notice" role="status">{notice}</p>}{!backup && !clearId && error && <p className="library-error" role="alert">{error}</p>}
    {!!groups.size && <><h3>{zh ? '能力保留的数据' : 'Retained capability data'}</h3><p className="modal-copy">{zh ? '清理内部数据不会删除资料库副本、引用快照或任务记录。启用中的能力请先在能力中心停用。' : 'Clearing internal data keeps Library copies, source snapshots and task history. Disable an active capability in Capability Center first.'}</p><div className="data-capability-list">{[...groups].map(([id, bytes]) => <div key={id}><span><strong>{name(id)}</strong><small>{(bytes / 1024).toFixed(1)} KB · {installed.some((c) => c.manifest.id === id) ? (zh ? '已安装' : 'Installed') : (zh ? '已卸载，数据保留' : 'Uninstalled; data retained')}</small></span><button className="quiet-button" disabled={busy || installed.some((c) => c.manifest.id === id && c.enabled)} onClick={() => setClearId(id)}>{zh ? '清理数据…' : 'Clear data…'}</button></div>)}</div></>}
    {backup && <LibraryDialog title={zh ? '恢复备份' : 'Restore backup'} busy={busy} onClose={() => setBackup(null)}><p className="modal-copy">{zh ? `备份时间：${backup.createdAt}。包含 ${Object.keys(backup.files).length} 个数据文件和 ${Object.keys(backup.localStorage).length} 项本地记录。` : `Created ${backup.createdAt}. Contains ${Object.keys(backup.files).length} data files and ${Object.keys(backup.localStorage).length} local records.`}</p><p className="modal-copy">{zh ? '恢复将替换当前 Workbench 用户数据，并重新载入界面。请先备份当前数据。已安装的能力程序保持不变；缺少的能力需重新安装。恢复不会启动 AI 任务。' : 'Restoring replaces current Workbench user data and reloads the interface. Back up current data first. Installed capability programs remain unchanged; missing capabilities need reinstallation. No AI tasks will start automatically.'}</p>{Array.isArray(backup.capabilities) && <details><summary>{zh ? '备份中的能力清单' : 'Capability inventory'}</summary><ul>{(backup.capabilities as InstalledCapability[]).map((c, i) => <li key={i}>{c.manifest?.name ?? 'Unknown'} · {c.manifest?.version}</li>)}</ul></details>}{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setBackup(null)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy} onClick={() => void act(() => restoreUserData(backup))}>{zh ? '替换数据并恢复' : 'Replace data and restore'}</button></footer></LibraryDialog>}
    {clearId && <LibraryDialog title={zh ? '清理能力数据' : 'Clear capability data'} busy={busy} onClose={() => setClearId(null)}><p className="modal-copy">{zh ? `永久清理「${name(clearId)}」的内部数据？请确认已备份。资料库中的文档会保留。` : `Permanently clear internal data for ${name(clearId)}? Make sure you have a backup. Library documents are retained.`}</p>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setClearId(null)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy} onClick={() => void act(async () => { await taskRunner.withMaintenance(async () => { const prefix = `personal-workbench:capability:${clearId}:`; Object.keys(localStorage).filter((k) => isUserDataKey(k) && k.startsWith(prefix)).forEach((k) => localStorage.removeItem(k)) }); setClearId(null) })}>{zh ? '永久清理' : 'Clear permanently'}</button></footer></LibraryDialog>}
  </div>
}
