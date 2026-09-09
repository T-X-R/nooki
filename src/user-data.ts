import { invoke } from '@tauri-apps/api/core'
import { readLibraryDocument } from './document-library'
import { taskRunner } from './tasks'
import { createDataRestore, restoreJournalKey } from './data-restore'

export type DataBackup = { format: string; version: number; createdAt: string; files: Record<string, string>; localStorage: Record<string, string>; capabilities: unknown }
export const isUserDataKey = (key: string) => key.startsWith('personal-workbench:capability:') || key === 'personal-workbench:activity-events' || key === 'personal-workbench-preferences'
const previewKeys = ['personal-workbench-library-v2', 'personal-workbench-document-library', 'personal-workbench-tasks-v1', 'personal-workbench-document-grants-v1']
const owned = (key: string) => isUserDataKey(key) || (!window.__TAURI_INTERNALS__ && (previewKeys.includes(key) || key.startsWith('workbench-source-snapshot:')))
export function localUserData(): Record<string, string> {
  return Object.fromEntries(Object.keys(localStorage).filter(owned).map((key) => [key, localStorage.getItem(key)!]))
}
export function downloadText(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
export async function exportMarkdown(ids: string[]): Promise<string> {
  if (window.__TAURI_INTERNALS__) return invoke<string>('library_export_markdown', { ids })
  // Preview provides one readable Markdown file; desktop exports separate files in a ZIP.
  const docs = await Promise.all(ids.map(readLibraryDocument))
  downloadText('Nooki-documents.md', docs.map((doc) => `# ${doc.title}\n\n${doc.content}`).join('\n\n---\n\n'), 'text/markdown')
  return '已下载 Markdown / Markdown downloaded'
}
export async function exportUserData(): Promise<string> {
  return taskRunner.withMaintenance(async () => {
    const localStorage = localUserData()
    if (window.__TAURI_INTERNALS__) return invoke<string>('user_data_export', { localStorage })
    const backup: DataBackup = { format: 'workbench-preview-data', version: 1, createdAt: new Date().toISOString(), files: {}, localStorage, capabilities: [] }
    downloadText(`Nooki-preview-${Date.now()}.workbench.json`, JSON.stringify(backup))
    return '浏览器预览数据已下载 / Browser preview backup downloaded'
  })
}
export function parseBackup(text: string): DataBackup {
  if (new TextEncoder().encode(text).length > 160_000_000) throw new Error('备份过大 / Backup is too large')
  const value = JSON.parse(text) as DataBackup
  const expectedFormat = window.__TAURI_INTERNALS__ ? 'workbench-user-data' : 'workbench-preview-data'
  if (value?.format !== expectedFormat || value.version !== 1 || !value.localStorage || typeof value.localStorage !== 'object' || Array.isArray(value.localStorage) || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error('备份格式不匹配，请使用此环境导出的备份 / Use a backup exported from this environment')
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.capabilities)
    || value.capabilities.some((cap) => !cap || typeof cap !== 'object' || !('manifest' in cap) || !cap.manifest || typeof cap.manifest !== 'object')) throw new Error('备份清单无效 / Invalid backup inventory')
  for (const [key, content] of Object.entries(value.localStorage)) {
    if (!owned(key) || typeof content !== 'string') throw new Error('备份包含不支持的数据 / Unsupported backup data')
    JSON.parse(content)
  }
  if (!window.__TAURI_INTERNALS__ && Object.keys(value.files).length) throw new Error('Invalid preview backup')
  return value
}
export async function recoverLocalRestore() {
  await createDataRestore(localStorage, owned, window.__TAURI_INTERNALS__ ? { commit: async () => {}, committedId: () => invoke<string | null>('user_data_restored_id') } : undefined).recover()
}
export async function restoreUserData(backup: DataBackup): Promise<void> {
  return taskRunner.withMaintenance(async () => {
    try { await createDataRestore(localStorage, owned, window.__TAURI_INTERNALS__ ? {
      commit: (transaction) => invoke('user_data_restore', { backup, transaction }),
      committedId: () => invoke<string | null>('user_data_restored_id'),
    } : undefined).restore(backup.localStorage) } catch (error) {
      if (localStorage.getItem(restoreJournalKey)) window.location.reload()
      throw error
    }
    window.location.reload()
  })
}
