import { useEffect, useRef, useState } from 'react'
import { DownloadIcon, UploadIcon, CubeIcon } from '@radix-ui/react-icons'
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
    <div className="data-backup-panel">
      <div className="data-setting-row"><span className="data-setting-icon"><DownloadIcon /></span><div><h3>{zh ? '备份工作区' : 'Back up workspace'}</h3><p>{zh ? '保存资料与本地记录，方便迁移或恢复。' : 'Save documents and local records for migration or recovery.'}</p></div><button className="secondary-button" disabled={busy} onClick={() => void act(async () => { setNotice(await exportUserData()) })}>{busy ? (zh ? '处理中…' : 'Working…') : (zh ? '备份数据' : 'Back up data')}</button></div>
      <div className="data-setting-row"><span className="data-setting-icon"><UploadIcon /></span><div><h3>{zh ? '从备份恢复' : 'Restore from backup'}</h3><p>{zh ? '选择备份文件，确认后替换当前工作区数据。' : 'Choose a backup, then confirm to replace workspace data.'}</p></div><button className="secondary-button" disabled={busy} onClick={() => input.current?.click()}>{zh ? '选择备份…' : 'Choose backup…'}</button></div>
      <details className="data-backup-details"><summary>{zh ? '备份包含哪些内容？' : 'What is included?'}</summary><p>{zh ? '包含资料、专题、版本历史、回收站、引用快照、任务记录、活动、能力内部数据和界面偏好。能力清单供重新安装时参考；不包含能力程序、AI 凭据或 Codex 保存的会话历史。' : 'Includes documents, topics, revisions, Trash, source snapshots, tasks, activity, capability data and preferences. The capability inventory helps with reinstallation. Programs, AI credentials and Codex-owned conversation history are excluded.'}</p></details>
    </div>
    <input hidden type="file" ref={input} accept=".json" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void act(async () => { if (file.size > 160_000_000) throw new Error('Backup exceeds 160 MB'); setBackup(parseBackup(await file.text())) }) }} />
    {notice && <p className="library-notice" role="status">{notice}</p>}{!backup && !clearId && error && <p className="library-error" role="alert">{error}</p>}
    {!!groups.size && <section className="data-retained"><div className="data-retained-heading"><h3>{zh ? '能力数据' : 'Capability data'}</h3><span>{(Array.from(groups.values()).reduce((sum, n) => sum + n, 0) / 1024).toFixed(1)} KB</span></div><p>{zh ? '清理后，资料库中的文档与历史引用仍会保留。' : 'Library documents and historical citations remain after clearing.'}</p><div className="data-capability-list">{[...groups].map(([id, bytes]) => { const enabled = installed.some((c) => c.manifest.id === id && c.enabled); return <div key={id}><span className="data-setting-icon"><CubeIcon /></span><span><strong>{name(id)}</strong><small>{enabled ? (zh ? '使用中 · 停用后可清理' : 'Active · disable to clear') : installed.some((c) => c.manifest.id === id) ? (zh ? '已停用' : 'Disabled') : (zh ? '已卸载 · 数据保留' : 'Uninstalled · data retained')}</small></span><span className="data-size">{(bytes / 1024).toFixed(1)} KB</span><button className="quiet-button library-delete-action" disabled={busy || enabled} title={enabled ? (zh ? '请先在能力中心停用此能力' : 'Disable this capability in Capability Center first') : undefined} onClick={() => setClearId(id)}>{zh ? '清理' : 'Clear'}</button></div> })}</div></section>}
    {backup && <LibraryDialog title={zh ? '恢复备份' : 'Restore backup'} busy={busy} onClose={() => setBackup(null)}><p className="modal-copy">{zh ? `备份时间：${backup.createdAt}。包含 ${Object.keys(backup.files).length} 个数据文件和 ${Object.keys(backup.localStorage).length} 项本地记录。` : `Created ${backup.createdAt}. Contains ${Object.keys(backup.files).length} data files and ${Object.keys(backup.localStorage).length} local records.`}</p><p className="modal-copy">{zh ? '恢复将替换当前 Workbench 用户数据，并重新载入界面。请先备份当前数据。已安装的能力程序保持不变；缺少的能力需重新安装。恢复不会启动 AI 任务。' : 'Restoring replaces current Workbench user data and reloads the interface. Back up current data first. Installed capability programs remain unchanged; missing capabilities need reinstallation. No AI tasks will start automatically.'}</p>{Array.isArray(backup.capabilities) && <details><summary>{zh ? '备份中的能力清单' : 'Capability inventory'}</summary><ul>{(backup.capabilities as InstalledCapability[]).map((c, i) => <li key={i}>{c.manifest?.name ?? 'Unknown'} · {c.manifest?.version}</li>)}</ul></details>}{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setBackup(null)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy} onClick={() => void act(() => restoreUserData(backup))}>{zh ? '替换数据并恢复' : 'Replace data and restore'}</button></footer></LibraryDialog>}
    {clearId && <LibraryDialog title={zh ? '清理能力数据' : 'Clear capability data'} busy={busy} onClose={() => setClearId(null)}><p className="modal-copy">{zh ? `永久清理「${name(clearId)}」的内部数据？请确认已备份。资料库中的文档会保留。` : `Permanently clear internal data for ${name(clearId)}? Make sure you have a backup. Library documents are retained.`}</p>{error && <p role="alert" className="library-error">{error}</p>}<footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => setClearId(null)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={busy} onClick={() => void act(async () => { await taskRunner.withMaintenance(async () => { const prefix = `personal-workbench:capability:${clearId}:`; Object.keys(localStorage).filter((k) => isUserDataKey(k) && k.startsWith(prefix)).forEach((k) => localStorage.removeItem(k)) }); setClearId(null) })}>{zh ? '永久清理' : 'Clear permanently'}</button></footer></LibraryDialog>}
  </div>
}
