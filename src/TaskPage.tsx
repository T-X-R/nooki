import { ChevronRightIcon } from '@radix-ui/react-icons'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { InstalledCapability } from '../packages/capability-contract/src'
import { taskRunner } from './tasks'
import { CONVERSATION_OWNER, LEGACY_REVIEW } from './conversation-model'

export function TaskPage({ language, installed, selectedId, onOpenCapability, onOpenConversation }: { onOpenConversation?: (id: string) => void; selectedId?: string | null; onOpenCapability?: (id: string) => void; language: 'zh' | 'en'; installed: InstalledCapability[] }) {
  const records = useSyncExternalStore(taskRunner.subscribe, taskRunner.getSnapshot, taskRunner.getSnapshot)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { if (selectedId) document.getElementById(`task-${selectedId}`)?.scrollIntoView({ block: 'center' }) }, [selectedId, records])
  const zh = language === 'zh'
  const statuses = zh
    ? { running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' }
    : { running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' }
  const act = async (id: string, action: () => Promise<void>) => {
    setBusy(id); setError(null)
    try { await action() } catch (reason) { setError(String(reason)) } finally { setBusy(null) }
  }
  return <div className="content-column">
    <div className="page-header-row"><div><h1 className="task-intro-title"><span>{zh ? '接住每一次开始，' : 'Give every beginning'}</span><em><span className="task-intro-accent">{zh ? '继续' : 'a way'}</span>{zh ? '未完的事。' : ' to continue.'}</em></h1><p>{zh ? '查看执行进度，从中断或失败处继续。' : 'Follow ongoing work and resume interrupted or failed tasks.'}</p></div></div>
    {error && <p role="alert">{error}</p>}
    {!records.length && <div className="surface activity-empty">{zh ? '暂无任务。开始一段对话，或运行一个能力。' : 'No tasks yet. Start a conversation or run a capability.'}</div>}
    <div className="capability-cards">{[...records].reverse().map((record) => {
      const capability = installed.find((item) => item.manifest.id === record.capabilityId)
      const platform = record.ownerKind === 'platform' && record.capabilityId === CONVERSATION_OWNER
      const canRetry = platform || capability?.enabled && capability.manifest.version === record.capabilityVersion
      return <article className={`capability-card ${selectedId === record.id ? 'task-selected' : ''}`} id={`task-${record.id}`} key={record.id}>
        <div className="capability-card-copy">
          <div className="capability-card-title"><h3>{platform ? (zh ? '对话' : 'Conversations') : record.capabilityId === LEGACY_REVIEW ? (zh ? '以前的每周回顾' : 'Previous Weekly Review') : capability?.manifest.locales?.[language]?.name ?? capability?.manifest.name ?? record.capabilityId}</h3><span className={`task-status task-status-${record.status}`}>{statuses[record.status]}</span></div>
          <p>{new Date(record.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US')} · {zh ? `已保存 ${Object.keys(record.checkpoints).length} 个步骤 · 第 ${record.attempt} 次执行` : `${Object.keys(record.checkpoints).length} saved steps · Attempt ${record.attempt}`}</p>
          <details className="task-details" open={selectedId === record.id}><summary><ChevronRightIcon aria-hidden="true" />{zh ? '任务详情' : 'Task details'}</summary><dl><div><dt>{zh ? '任务类型' : 'Job'}</dt><dd>{record.job}</dd></div><div><dt>{zh ? '当前步骤' : 'Current step'}</dt><dd>{record.stage ?? '—'}</dd></div><div><dt>{zh ? '任务编号' : 'Task ID'}</dt><dd>{record.id}</dd></div><div><dt>{zh ? '已保存步骤' : 'Saved steps'}</dt><dd>{Object.keys(record.checkpoints).join(' → ') || '—'}</dd></div></dl></details>
          {record.error && <p role="alert">{record.error}</p>}
          {!canRetry && ['failed', 'cancelled', 'interrupted'].includes(record.status) && <small>{zh ? '需要启用原版本能力才能继续；更新后请启动新任务。' : 'Enable the original capability version to resume; start a new task after an update.'}</small>}
        </div>
        <div className="capability-card-actions">
          {platform && (record.input as { threadId?: string }).threadId && onOpenConversation && <button className="quiet-button" onClick={() => onOpenConversation((record.input as { threadId: string }).threadId)}>{zh ? '打开对话' : 'Open conversation'}</button>}
          {capability?.enabled && onOpenCapability && <button className="quiet-button" onClick={() => onOpenCapability(record.capabilityId)}>{zh ? '打开能力' : 'Open capability'}</button>}
          {record.status === 'running' && <button className="quiet-button" disabled={busy === record.id} onClick={() => void act(record.id, () => taskRunner.cancel(record.id))}>{zh ? '取消' : 'Cancel'}</button>}
          {['failed', 'cancelled', 'interrupted'].includes(record.status) && <button className="quiet-button" disabled={!canRetry || busy === record.id} onClick={() => void act(record.id, () => taskRunner.retry(record.id))}>{zh ? '从检查点重试' : 'Retry from checkpoints'}</button>}
        </div>
      </article>
    })}</div>
  </div>
}
