import { ArrowRightIcon, CheckCircledIcon, ChevronDownIcon, ChevronRightIcon, FileTextIcon } from '@radix-ui/react-icons'
import { useEffect, useState, useSyncExternalStore } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CapabilityManifest, CapabilityModule, CapabilityPageProps, DocumentGrant, DocumentReference, TaskRecord } from '../../packages/capability-contract/src'
import { parseReferenceHref } from '../../packages/capability-contract/src/references'
import { generateReview, publishReview, type WeeklyDraft, type WeeklyInput } from './review'
import manifestJson from './manifest.json'
import './styles.css'
const manifest: CapabilityManifest = manifestJson

function WeeklyReviewPage({ host }: CapabilityPageProps) {
  const environment = useSyncExternalStore(host.environment.subscribe, host.environment.getSnapshot, host.environment.getSnapshot)
  const tasks = useSyncExternalStore(host.tasks.subscribe, host.tasks.getSnapshot, host.tasks.getSnapshot)
  const zh = environment.language === 'zh'
  const [grants, setGrants] = useState<DocumentGrant[]>([])
  const [grantId, setGrantId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [draftTaskId, setDraftTaskId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let current = true
    host.documents.listGrants().then((next) => { if (current) { setGrants(next); setGrantId(next.at(-1)?.id ?? '') } }).catch((reason) => { if (current) setError(String(reason)) })
    return () => { current = false }
  }, [host])
  const grant = grants.find((item) => item.id === grantId)
  const generations = tasks.filter((item) => item.job === 'generate')
  const task = generations.find((item) => item.id === draftTaskId) ?? generations.at(-1)
  const draft = task?.status === 'completed' ? task.result as WeeklyDraft : null
  const publication = draft ? [...tasks].reverse().find((item) => item.job === 'publish' && (item.input as { draft: WeeklyDraft }).draft.id === draft.id) : undefined
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await action() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const status = (record: TaskRecord) => {
    const labels = zh ? { running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' } : { running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' }
    const stages: Record<string, string> = zh ? { 'read-sources': '读取所选资料', generate: '生成草稿', 'record-activity': '记录活动', 'record-request': '准备发布', publish: '发布到资料库' } : { 'read-sources': 'Reading selected sources', generate: 'Generating draft', 'record-activity': 'Recording activity', 'record-request': 'Preparing publication', publish: 'Publishing to Library' }
    return <div className={`weekly-status weekly-status-${record.status}`} aria-live="polite"><span>{labels[record.status]}{record.status === 'running' && record.stage ? ` · ${stages[record.stage] ?? record.stage}` : ''}<small>{record.error}</small></span>
      {record.status === 'running' && <button disabled={busy} onClick={() => void act(() => host.tasks.cancel(record.id))}>{zh ? '取消任务' : 'Cancel task'}</button>}
      {['failed', 'cancelled', 'interrupted'].includes(record.status) && <button disabled={busy} onClick={() => void act(() => host.tasks.retry(record.id))}>{zh ? '从检查点重试' : 'Retry from checkpoints'}</button>}
    </div>
  }
  return <div className="weekly-page" lang={environment.locale} data-theme={environment.theme}>
    <header className="weekly-header"><span className="weekly-eyebrow">WEEKLY REVIEW</span><h1>{zh ? '每周回顾' : 'Weekly Review'}</h1><p>{zh ? '从你选定的资料中回顾这一周。先生成草稿，确认后再发布。' : 'Reflect on the week using your selected documents. Generate a draft, then approve publication.'}</p></header>
    {error && <p className="weekly-error" role="alert">{error}</p>}
    <section className="weekly-scope"><div className="weekly-section-heading"><div><span className="weekly-eyebrow">INPUT</span><h2>{zh ? '确认输入范围' : 'Confirm input scope'}</h2></div>{grant && <span className="weekly-count">{grant.documents.length} {zh ? '篇资料' : 'documents'}</span>}</div>
      {!grants.length ? <div className="weekly-empty"><span className="weekly-empty-icon"><FileTextIcon /></span><h3>{zh ? '从这一周的资料开始' : 'Start with this week’s documents'}</h3><p>{zh ? '在资料库选择日记、每日总结等资料，再授权“每周回顾”读取。' : 'Choose journals, daily summaries or other documents in the Library, then authorize Weekly Review.'}</p><div className="weekly-empty-steps"><span>{zh ? '选择资料' : 'Select documents'}</span><ChevronRightIcon /><span>{zh ? '确认授权' : 'Authorize access'}</span><ChevronRightIcon /><span>{zh ? '生成回顾' : 'Generate review'}</span></div></div> : <>
        <div className="weekly-select"><select aria-label={zh ? '授权范围' : 'Authorized selection'} value={grantId} onChange={(event) => { setGrantId(event.target.value); setConfirmed(false) }}>
          {grants.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString(environment.locale)} · {item.documents.length} {zh ? '篇资料' : 'documents'}</option>)}
        </select><ChevronDownIcon /></div>
        <ul className="weekly-source-list">{grant?.documents.map((doc) => <li key={doc.reference.documentId}><button onClick={() => host.documents.open(doc.reference)}><FileTextIcon /><span><strong>{doc.reference.title}</strong><small>{doc.documentDate}</small></span><ChevronRightIcon /></button></li>)}</ul>
        <label className="weekly-confirmation"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{zh ? '确认仅使用以上资料快照，并发送给当前平台 AI Provider' : 'Use only these snapshots and send them to the selected platform AI Provider'}</label>
        <button className="weekly-primary" disabled={!confirmed || busy || tasks.some((item) => item.job === 'generate' && item.status === 'running')} onClick={() => void act(async () => {
          const input: WeeklyInput = { draftId: crypto.randomUUID(), grantId, documentIds: grant!.documents.map((doc) => doc.reference.documentId), date: new Date().toLocaleDateString('en-CA'), language: environment.language }
          setDraftTaskId(await host.tasks.start('generate', input))
        })}>{zh ? '开始生成草稿' : 'Generate draft'}<ArrowRightIcon /></button>
      </>}
    </section>
    {task && <section className="weekly-draft"><div className="weekly-section-heading"><div><span className="weekly-eyebrow">DRAFT</span><h2>{zh ? '回顾草稿' : 'Review draft'}</h2></div><div className="weekly-select"><select aria-label={zh ? '生成历史' : 'Generation history'} value={task.id} onChange={(event) => setDraftTaskId(event.target.value)}>{[...generations].reverse().map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString(environment.locale)}</option>)}</select><ChevronDownIcon /></div></div>
      {status(task)}
      {draft && <><div className="weekly-draft-sources"><span>{zh ? '引用来源' : 'Sources'} </span> {draft.sources.map((reference) => <button key={reference.documentId} onClick={() => host.documents.open(reference)}><FileTextIcon />{reference.title}</button>)}</div><div className="weekly-output"><Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => { const ref = parseReferenceHref(href ?? ''); return ref ? <a href={href} onClick={(event) => { event.preventDefault(); host.documents.open(ref) }}>{children}</a> : <a href={href}>{children}</a> } }}>{draft.content}</Markdown></div>
        {publication ? <>{status(publication)}{publication.status === 'completed' && <button className="weekly-open-published" onClick={() => host.documents.open(publication.result as DocumentReference)}><CheckCircledIcon />{zh ? '打开已发布文档' : 'Open published document'}<ArrowRightIcon /></button>}</> : <div className="weekly-publish"><p>{zh ? '草稿尚未发布。请检查内容和来源引用后确认。' : 'This draft is unpublished. Check its content and source citations before confirming.'}</p><button className="weekly-primary" disabled={busy || tasks.some((item) => item.job === 'publish' && item.status === 'running')} onClick={() => void act(() => host.tasks.start('publish', { draft }))}>{zh ? '确认并发布到资料库' : 'Confirm and publish to Library'}</button></div>}
      </>}
    </section>}
  </div>
}
const capability: CapabilityModule = { manifest, Page: WeeklyReviewPage, jobs: { generate: generateReview, publish: publishReview } }
export default capability
