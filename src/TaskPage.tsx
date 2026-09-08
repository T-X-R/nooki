import { ChevronRightIcon } from '@radix-ui/react-icons'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { InstalledCapability, TaskRecord } from '../packages/capability-contract/src'
import { taskRunner } from './tasks'
import { CONVERSATION_OWNER, LEGACY_REVIEW } from './conversation-model'
import { conversationClient } from './conversation-client'
import { groupTasks, taskInputText } from './task-groups'

export function TaskPage({ language, installed, selectedId, onOpenCapability, onOpenConversation }: { onOpenConversation?: (id: string) => void; selectedId?: string | null; onOpenCapability?: (id: string) => void; language: 'zh' | 'en'; installed: InstalledCapability[] }) {
  const records = useSyncExternalStore(taskRunner.subscribe, taskRunner.getSnapshot, taskRunner.getSnapshot)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const groups = groupTasks(records)
  const threadIds = JSON.stringify(groups.flatMap((group) => group.kind === 'conversation' ? [group.threadId] : []).sort())
  const [titles, setTitles] = useState<Record<string, string>>({})
  useEffect(() => {
    const remaining = new Set<string>(JSON.parse(threadIds))
    if (!remaining.size) return
    let current = true
    void (async () => {
      let cursor: string | null = null
      do {
        const page = await conversationClient.list(cursor)
        if (!current) return
        const found: Record<string, string> = {}
        for (const thread of page.data) {
          if (remaining.delete(thread.id)) found[thread.id] = thread.name || thread.preview
        }
        setTitles((previous) => ({ ...previous, ...found }))
        cursor = page.nextCursor
      } while (cursor && remaining.size)
    })().catch(() => { /* Persisted task inputs remain available when Codex is offline. */ })
    return () => { current = false }
  }, [threadIds])
  useEffect(() => {
    if (!selectedId) return
    const task = document.getElementById(`task-${selectedId}`)
    const group = task?.closest('details.task-group') as HTMLDetailsElement | null
    if (group) group.open = true
    task?.scrollIntoView({ block: 'center' })
  }, [selectedId, records])
  const zh = language === 'zh'
  const statuses = zh
    ? { running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' }
    : { running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' }
  const act = async (id: string, action: () => Promise<void>) => {
    setBusy(id); setError(null)
    try { await action() } catch (reason) { setError(String(reason)) } finally { setBusy(null) }
  }
  const renderRecord = (record: TaskRecord, nested = false) => {
    const capability = installed.find((item) => item.manifest.id === record.capabilityId)
    const platform = record.ownerKind === 'platform' && record.capabilityId === CONVERSATION_OWNER
    const canRetry = platform || capability?.enabled && capability.manifest.version === record.capabilityVersion
    return <article className={`capability-card ${nested ? 'task-group-entry' : ''} ${selectedId === record.id ? 'task-selected' : ''}`} id={`task-${record.id}`} key={record.id}>
      <div className="capability-card-copy">
        <div className="capability-card-title"><h3>{platform ? (record.job === 'respond' ? (zh ? '生成回复' : 'Generate reply') : record.job === 'save-answer' ? (zh ? '保存资料' : 'Save to Library') : record.job) : record.capabilityId === LEGACY_REVIEW ? (zh ? '以前的每周回顾' : 'Previous Weekly Review') : capability?.manifest.locales?.[language]?.name ?? capability?.manifest.name ?? record.capabilityId}</h3><span className={`task-status task-status-${record.status}`}>{statuses[record.status]}</span></div>
        {nested && <p className="task-entry-subject">{taskInputText(record, 'message') || taskInputText(record, 'title')}</p>}
        <p>{new Date(record.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US')} · {zh ? `已保存 ${Object.keys(record.checkpoints).length} 个步骤 · 第 ${record.attempt} 次执行` : `${Object.keys(record.checkpoints).length} saved steps · Attempt ${record.attempt}`}</p>
        <details className="task-details" open={selectedId === record.id}><summary><ChevronRightIcon aria-hidden="true" />{zh ? '任务详情' : 'Task details'}</summary><dl><div><dt>{zh ? '任务类型' : 'Job'}</dt><dd>{record.job}</dd></div><div><dt>{zh ? '当前步骤' : 'Current step'}</dt><dd>{record.stage ?? '—'}</dd></div><div><dt>{zh ? '任务编号' : 'Task ID'}</dt><dd>{record.id}</dd></div><div><dt>{zh ? '已保存步骤' : 'Saved steps'}</dt><dd>{Object.keys(record.checkpoints).join(' → ') || '—'}</dd></div></dl></details>
        {record.error && <p role="alert">{record.error}</p>}
        {!canRetry && ['failed', 'cancelled', 'interrupted'].includes(record.status) && <small>{zh ? '需要启用原版本能力才能继续；更新后请启动新任务。' : 'Enable the original capability version to resume; start a new task after an update.'}</small>}
      </div>
      <div className="capability-card-actions">
        {capability?.enabled && onOpenCapability && <button className="quiet-button" onClick={() => onOpenCapability(record.capabilityId)}>{zh ? '打开能力' : 'Open capability'}</button>}
        {record.status === 'running' && <button className="quiet-button" disabled={busy === record.id} onClick={() => void act(record.id, () => taskRunner.cancel(record.id))}>{zh ? '取消' : 'Cancel'}</button>}
        {['failed', 'cancelled', 'interrupted'].includes(record.status) && <button className="quiet-button" disabled={!canRetry || busy === record.id} onClick={() => void act(record.id, () => taskRunner.retry(record.id))}>{zh ? '从检查点重试' : 'Retry from checkpoints'}</button>}
      </div>
    </article>
  }
  return <div className="content-column">
    <div className="page-header-row"><div><h1 className="task-intro-title"><span>{zh ? '每一步，' : 'Every step'}</span><em>{zh ? '都' : ''}<span className="task-intro-accent">{zh ? '有迹可循' : 'leaves a trace'}</span>{zh ? '。' : '.'}</em></h1><p>{zh ? '查看执行进度与结果，处理失败或中断的任务。' : 'Review progress and results, and resume failed or interrupted tasks.'}</p></div></div>
    {error && <p role="alert">{error}</p>}
    {!records.length && <div className="surface activity-empty">{zh ? '暂无任务。开始一段对话，或运行一个能力。' : 'No tasks yet. Start a conversation or run a capability.'}</div>}

    <div className="capability-cards">{groups.map((group) => {
      if (group.kind === 'task') return renderRecord(group.record)
      const latest = group.records[0]
      const state = group.running ? 'running' : group.attention ? (group.records.some((task) => task.status === 'failed') ? 'failed' : 'interrupted') : latest.status
      const label = group.running ? (zh ? `${group.running} 项执行中` : `${group.running} running`) : group.attention ? (zh ? `${group.attention} 项待处理` : `${group.attention} need attention`) : (zh ? `最近执行${statuses[latest.status]}` : `Latest execution: ${statuses[latest.status]}`)
      return <details className="capability-card task-group" key={group.id}>
        <summary className="task-group-summary">
          <ChevronRightIcon aria-hidden="true" />
          <div className="capability-card-copy">
            <div className="capability-card-title"><h3>{titles[group.threadId] || group.fallbackTitle || (zh ? '未命名对话' : 'Untitled conversation')}</h3><span className={`task-status task-status-${state}`}>{label}</span>{group.running > 0 && group.attention > 0 && <span className="task-status task-status-failed">{zh ? `${group.attention} 项待处理` : `${group.attention} need attention`}</span>}</div>
            <p>{new Date(group.updatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')} · {zh ? `${group.records.length} 次执行` : `${group.records.length} executions`}</p>
          </div>
          {onOpenConversation && <button className="quiet-button" onClick={(event) => { event.preventDefault(); onOpenConversation(group.threadId) }}>{zh ? '打开对话' : 'Open conversation'}</button>}
        </summary>
        <div className="task-group-entries">{group.records.map((record) => renderRecord(record, true))}</div>
      </details>
    })}</div>
  </div>
}
