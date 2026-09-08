import { ChevronRightIcon, ClockIcon, FileTextIcon } from '@radix-ui/react-icons'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { DocumentReference, InstalledCapability } from '../packages/capability-contract/src'
import { activityStore } from './activity'
import { todayFeed } from './activity-store'
import { taskRunner } from './tasks'

export function TodayActivity({ language, installed, onDocument, onTask, onCapability }: {
  language: 'zh' | 'en'; installed: InstalledCapability[]
  onDocument(reference: DocumentReference): void; onTask(id: string): void; onCapability(id: string): void
}) {
  const events = useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot, activityStore.getSnapshot)
  const tasks = useSyncExternalStore(taskRunner.subscribe, taskRunner.getSnapshot, taskRunner.getSnapshot)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(20)
  const zh = language === 'zh'
  useEffect(() => { try { activityStore.load() } catch (reason) { setError(String(reason)) } }, [])
  const feed = todayFeed(events, tasks)
  const name = (id: string) => { const item = installed.find((cap) => cap.manifest.id === id); return item?.manifest.locales?.[language]?.name ?? item?.manifest.name ?? id }
  const timestamp = (date: string) => new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date))
  const statuses = zh ? { running: '执行中', failed: '失败，待处理', interrupted: '已中断，待恢复', completed: '已完成', cancelled: '已取消' } : { running: 'Running', failed: 'Failed · action needed', interrupted: 'Interrupted · resume', completed: 'Completed', cancelled: 'Cancelled' }
  return <section className="activity-section">
    {!!feed.tasks.length && <><div className="section-heading-row"><h2>{zh ? '正在进行与待处理' : 'In progress and needs attention'}</h2><span className="activity-count">{feed.tasks.length}</span></div><div className="activity-list" role="region" aria-label={zh ? '待处理任务' : 'Tasks needing attention'} tabIndex={0}>{feed.tasks.map((task) => <button className="activity-row" key={task.id} onClick={() => onTask(task.id)}><span className={`activity-row-icon activity-row-icon-${task.status}`}><ClockIcon /></span><span className="activity-row-copy"><strong>{name(task.capabilityId)}</strong><small>{statuses[task.status]}</small></span><time dateTime={task.updatedAt} title={new Date(task.updatedAt).toLocaleString()}>{timestamp(task.updatedAt)}</time><ChevronRightIcon className="activity-row-arrow" /></button>)}</div></>}
    <div className="section-heading-row"><div><span className="section-kicker">ACTIVITY</span><h2>{zh ? '最近活动' : 'Recent activity'}</h2></div><span className="activity-count">{feed.events.length}</span></div>
    {error && <p role="alert">{error}</p>}
    {!feed.events.length ? <div className="activity-empty">{zh ? '保存日记或生成文档后，活动会出现在这里。' : 'Your saved entries and generated documents will appear here.'}</div> : <div className="activity-list" role="region" aria-label={zh ? '最近活动' : 'Recent activity'} tabIndex={0}>{feed.events.slice(0, limit).map((event) => {
      const installedSource = installed.some((cap) => cap.manifest.id === event.source && cap.enabled)
      return <button className="activity-row" key={event.id} disabled={!event.target && !event.taskId && !installedSource} onClick={() => event.target ? onDocument(event.target) : event.taskId ? onTask(event.taskId) : onCapability(event.source)} title={!event.target && !event.taskId ? (zh ? '打开来源能力' : 'Open source capability') : undefined}><span className="activity-row-icon"><FileTextIcon /></span><span className="activity-row-copy"><strong>{event.title}</strong><small>{name(event.source)}</small></span><time dateTime={event.occurredAt} title={new Date(event.occurredAt).toLocaleString()}>{timestamp(event.occurredAt)}</time><ChevronRightIcon className="activity-row-arrow" /></button>
    })}</div>}
    {feed.events.length > limit && <button className="quiet-button" onClick={() => setLimit(limit + 20)}>{zh ? '查看更早活动' : 'Show earlier activity'}</button>}
  </section>
}
