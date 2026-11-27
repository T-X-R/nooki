import { invoke } from '@tauri-apps/api/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { boardPicker, type BoardPickerRequest } from '../../platform/board-picker.ts'
type Candidate = { id: string; title: string; revision: number; archived?: boolean; description?: string }
import { LibraryDialog } from '../library/LibraryDialogs.tsx'
import '../library/library-selection.css'

function Selection({ request, language }: { request: BoardPickerRequest; language: 'zh' | 'en' }) {
  const zh = language === 'zh'
  const [tasks, setTasks] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let current = true
    setLoading(true); setError('')
    void invoke<{cards: Candidate[]}>('task_board_read').then(board => { if (current) { setTasks(board.cards); setSelected([]) } })
      .catch(() => { if (current) setError(zh ? '无法读取任务列表，请重试。' : 'Could not load tasks. Please retry.') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  // A language change must not replace the task versions already shown or approved.
  }, [refresh])
  const confirm = async () => {
    setApproved(true); setBusy(true); setError('')
    try {
      const grant = await request.confirm(selected.map(id => { const task = tasks.find(task => task.id === id)!; return {id:task.id,revision:task.revision} }))
      boardPicker.complete(request, { status: 'selected', grant })
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : (zh ? '授权失败，请取消后重新选择。' : 'Access failed. Cancel and select again.'))
    } finally { setBusy(false) }
  }
  const visible = tasks.filter(doc => doc.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const titles = new Map<string, number>()
  for (const task of tasks) titles.set(task.title, (titles.get(task.title) ?? 0) + 1)
  return <LibraryDialog title={zh ? '选择允许附加成果的任务' : 'Choose tasks for delivery attachment'} busy={busy} onClose={() => boardPicker.dismiss(request)} className="library-selection-dialog">
    <div className="library-selection-recipient"><strong>{request.name}</strong><small>{request.capabilityId} · {request.version}</small></div>
    <p className="library-selection-purpose"><strong>{zh ? '用途' : 'Purpose'}</strong><span>{request.purpose}</span></p>
    <p className="modal-copy">{zh ? '仅允许此能力为所选任务的当前版本附加成果，不会执行任务或验收成果。任务发生变化后需要重新选择；你可以在任务板中撤销授权。' : 'Allow this capability to attach a delivery to the selected task versions. This does not execute tasks or accept results. Task changes require a new selection. Revoke access from the task board.'}</p>
    <label className="library-selection-search library-field">{zh ? '按标题查找' : 'Find by title'}<input type="search" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} /></label>
    {loading ? <p role="status">{zh ? '正在读取任务列表…' : 'Loading tasks…'}</p> : <fieldset className="library-selection-list" disabled={busy || approved}><legend>{zh ? `已选 ${selected.length} / ${request.limit}` : `${selected.length} / ${request.limit} selected`}</legend>
      {!error && !visible.length && <p role="status">{tasks.length ? (zh ? '没有匹配的任务' : 'No matching tasks') : (zh ? '任务板中还没有任务' : 'No tasks on the board yet')}</p>}
      {visible.map(doc => <label key={doc.id}><input type="checkbox" checked={selected.includes(doc.id)} disabled={!selected.includes(doc.id) && selected.length >= request.limit}
        onChange={event => setSelected(ids => event.target.checked ? [...ids, doc.id] : ids.filter(id => id !== doc.id))} /><span><strong>{doc.title}</strong>
          {doc.description && <small>{doc.description.length > 240 ? `${doc.description.slice(0,240)}…` : doc.description}</small>}
          <small>{doc.archived ? (zh ? '已归档任务' : 'Archived task') : (zh ? '当前任务' : 'Task')}</small>
          {titles.get(doc.title)! > 1 && <small>{zh ? '同名任务标识：' : 'Task identifier: '}{doc.id}</small>}
        </span></label>)}
    </fieldset>}
    {error && <p role="alert" className="library-error">{error}</p>}
    {!approved && error && <button className="quiet-button" onClick={() => setRefresh(value => value + 1)}>{zh ? '重新加载' : 'Reload'}</button>}
    {approved && error && <p className="modal-copy">{zh ? '重试会使用同一组已确认的任务。若要修改选择，请取消后重新打开。' : 'Retry uses the same approved task versions. To change it, cancel and open a new picker.'}</p>}
    <footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={() => boardPicker.dismiss(request)}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={loading || busy || !selected.length} onClick={() => void confirm()}>{busy ? (zh ? '正在授权…' : 'Authorizing…') : approved ? (zh ? '重试授权' : 'Retry authorization') : (zh ? '授权所选任务' : 'Authorize selected tasks')}</button></footer>
  </LibraryDialog>
}
export function TaskSelectionDialog({ language }: { language: 'zh' | 'en' }) {
  const request = useSyncExternalStore(boardPicker.subscribe, boardPicker.getSnapshot)
  return request ? <Selection key={request.selectionId} request={request} language={language} /> : null
}
