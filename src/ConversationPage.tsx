import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, Cross2Icon, FileTextIcon, MagnifyingGlassIcon, PlusIcon, ReloadIcon, StopIcon } from '@radix-ui/react-icons'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DocumentReference, SelectedDocument, TaskRecord } from '../packages/capability-contract/src'
import { parseReferenceHref } from '../packages/capability-contract/src/references'
import { taskRunner } from './tasks'
import { conversationClient } from './conversation-client'
import { CONVERSATION_OWNER, LEGACY_REVIEW, type ConversationInput, type ConversationItem, type SaveAnswerInput } from './conversation-model'
import { listLibraryDocuments, searchLibraryContent, readLibraryDocument, type LibraryDocument, type LibraryDocumentMetadata } from './document-library'
import './conversation.css'
import { createGreetingRotation, type conversationGreetings } from './conversation-greetings'
import { LibraryDialog, DocumentComparison } from './LibraryDialogs'

// UI drafts only; Codex is the authority for session history and messages.
const openingGreetings = createGreetingRotation()
const drafts = new Map<string, { text: string; ids: string[] }>()
let currentSession: string | null = null
function ConversationMarkdown({ text, onDocument }: { text: string; onDocument(ref: DocumentReference): void }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => {
    const ref = parseReferenceHref(href ?? '')
    return ref ? <a href={href} onClick={(event) => { event.preventDefault(); onDocument(ref) }}>{children}</a> : <a href={href} target="_blank" rel="noreferrer">{children}</a>
  } }}>{text}</Markdown>
}
function ProcessItem({ item, zh }: { item: ConversationItem; zh: boolean }) {
  const summary = item.type === 'reasoning' ? item.summary?.join('\n\n') : item.type === 'plan' ? item.text : item.aggregatedOutput
  const label = item.type === 'reasoning' ? (zh ? '思考摘要' : 'Thinking summary') : item.type === 'plan' ? (zh ? '计划' : 'Plan') : item.type === 'commandExecution' ? item.command : item.tool ?? item.type
  return <details className="conversation-process"><summary><ChevronDownIcon /><span>{label}</span>{item.status && <small>{item.status}</small>}</summary>{summary && <pre>{summary}</pre>}{item.type === 'fileChange' && <pre>{JSON.stringify(item.changes, null, 2)}</pre>}{item.result != null && <pre>{JSON.stringify(item.result, null, 2)}</pre>}{item.error != null && <pre>{JSON.stringify(item.error, null, 2)}</pre>}</details>
}

export function ConversationPage({ onSelected, language, incomingIds, onConsumed, targetId, onTargetConsumed, onDocument }: { onSelected(id: string | null): void; language: 'zh' | 'en'; incomingIds: string[]; onConsumed(): void; targetId: string | null; onTargetConsumed(): void; onDocument(ref: DocumentReference): void }) {
  const zh = language === 'zh'
  const tasks = useSyncExternalStore(taskRunner.subscribe, taskRunner.getSnapshot, taskRunner.getSnapshot)
  const cache = useSyncExternalStore(conversationClient.subscribe, conversationClient.getSnapshot, conversationClient.getSnapshot)
  const [selected, setSelected] = useState<string | null>(targetId === 'new' ? null : targetId ?? currentSession)
  const [text, setText] = useState(() => drafts.get(targetId ?? currentSession ?? 'new')?.text ?? '')
  const [ids, setIds] = useState<string[]>(() => drafts.get(targetId ?? currentSession ?? 'new')?.ids ?? [])
  const [greeting, setGreeting] = useState<(typeof conversationGreetings)[number] | null>(null)
  const handledNewOpening = useRef(false)
  const [documents, setDocuments] = useState<LibraryDocumentMetadata[]>([])
  const [picker, setPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState<SaveAnswerInput | null>(null)
  const [saveTarget, setSaveTarget] = useState<LibraryDocument | null>(null)
  const [saveError, setSaveError] = useState('')
  const [saveCompare, setSaveCompare] = useState(false)
  const saveSelection = useRef(0)
  const [showLegacy, setShowLegacy] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const composer = useRef<HTMLTextAreaElement>(null)
  const thread = selected ? cache[selected] : undefined
  const conversationTasks = tasks.filter((t) => t.capabilityId === CONVERSATION_OWNER && (t.input as { threadId?: string }).threadId === selected)
  const running = conversationTasks.find((t) => t.job === 'respond' && t.status === 'running')
  const stopped = [...conversationTasks].reverse().find((t) => t.job === 'respond' && ['failed', 'cancelled', 'interrupted'].includes(t.status))
  const latestResponseTask = [...conversationTasks].reverse().find((t) => t.job === 'respond')
  const legacy = tasks.filter((t) => t.capabilityId === LEGACY_REVIEW && t.job === 'generate' && t.status === 'completed')
  const act = async (action: () => Promise<unknown>) => { setBusy(true); setError(null); try { await action() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  const select = (id: string | null) => {
    drafts.set(selected ?? 'new', { text, ids }); currentSession = id; setSelected(id)
    const draft = drafts.get(id ?? 'new'); setText(draft?.text ?? ''); setIds(draft?.ids ?? []); setPicker(false); setShowLegacy(false); follow.current = true
  }
  useEffect(() => {
    let current = true
    void listLibraryDocuments().then((docs) => { if (current) setDocuments(docs) }).catch((e) => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [])
  useEffect(() => { if (targetId) { if (targetId === 'new') select(null); else if (targetId !== selected) select(targetId); onTargetConsumed() } }, [targetId])
  useEffect(() => {
    if (incomingIds.length) { setIds((previous) => [...new Set([...previous, ...incomingIds])]); onConsumed() }
  }, [incomingIds])
  useEffect(() => { onSelected(selected) }, [selected, onSelected])
  useEffect(() => { drafts.set(selected ?? 'new', { text, ids }) }, [selected, text, ids])
  useEffect(() => {
    const fresh = targetId === 'new' && !handledNewOpening.current
    handledNewOpening.current = targetId === 'new'
    if (targetId !== 'new' && selected && (!thread || thread.turns.length || running)) return
    setGreeting(openingGreetings.get(targetId === 'new' ? 'new' : selected ?? 'new', { fresh, hasDocuments: ids.length > 0 || incomingIds.length > 0, hasText: !!text.trim() }))
  }, [selected, targetId, ids.length, incomingIds.length, text, thread, running])
  const taskStatus = conversationTasks.map((t) => `${t.id}:${t.status}`).join(',')
  useEffect(() => {
    if (!selected) return
    void conversationClient.read(selected).catch((e) => setError(String(e)))
  }, [selected, taskStatus])
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [thread, running])
  useEffect(() => {
    let current = true
    setMatches([])
    const timer = window.setTimeout(() => { void searchLibraryContent(query).then((next) => { if (current) setMatches(next) }).catch((e) => { if (current) setError(String(e)) }) }, 150)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query])
  const filtered = documents.filter((doc) => !query.trim() || [doc.title, doc.capabilityName, doc.collectionName, doc.documentDate].some((value) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || matches.includes(doc.id))
  const send = () => void act(async () => {
    if (!text.trim() || running || thread?.turns.some((t) => t.status === 'inProgress')) return
    if (ids.length > 50) throw new Error(zh ? '每次最多引用 50 篇资料' : 'Select at most 50 documents')
    let id = selected
    if (!id) { const created = await conversationClient.create(); id = created.id; currentSession = id; setSelected(id) }
    const input: ConversationInput = { threadId: id, message: text.trim(), documentIds: ids, snapshotId: crypto.randomUUID() }
    await taskRunner.start(CONVERSATION_OWNER, 'respond', input)
    setText(''); drafts.set(id, { text: '', ids }); drafts.delete('new'); openingGreetings.clearDraft(); follow.current = true
  })
  const save = (messageId: string, content: string, title?: string) => {
    setSaveTarget(null); setSaveError(''); setSaveCompare(false)
    setSaving({ threadId: selected ?? undefined, messageId: crypto.randomUUID(), sourceMessageId: messageId, content, title: title ?? (thread?.name || thread?.preview || (zh ? '对话成果' : 'Conversation answer')).slice(0, 120), date: new Date().toLocaleDateString('en-CA'), language })
    void listLibraryDocuments().then(setDocuments).catch((e) => setSaveError(String(e)))
  }
  const selectSaveTarget = async (id: string) => {
    const request = ++saveSelection.current
    setSaveTarget(null); setSaveError(''); setSaveCompare(false)
    setSaving((value) => value ? { ...value, targetDocumentId: id || undefined, expectedRevision: undefined } : value)
    if (!id) return
    try {
      const doc = await readLibraryDocument(id)
      if (request !== saveSelection.current) return
      setSaveTarget(doc); setSaving((value) => value ? { ...value, title: doc.title, expectedRevision: doc.revision ?? doc.updatedAt } : value)
    } catch (e) { if (request === saveSelection.current) setSaveError(String(e)) }
  }
  const attachments = (item: ConversationItem) => {
    const task = tasks.find((record) => record.id === item.clientId)
    return (task?.checkpoints.sources as SelectedDocument[] | undefined) ?? []
  }
  const savedTask = (messageId: string) => [...tasks].reverse().find((t) => t.capabilityId === CONVERSATION_OWNER && t.job === 'save-answer' && ((t.input as SaveAnswerInput).sourceMessageId ?? (t.input as SaveAnswerInput).messageId) === messageId && (t.input as SaveAnswerInput).threadId === selected)
  const saveAction = (item: ConversationItem) => {
    const task = savedTask(item.id)
    return task?.status === 'completed' ? <button className="quiet-button" onClick={() => onDocument(task.result as DocumentReference)}><CheckIcon />{zh ? '已保存 · 打开' : 'Saved · Open'}</button> : task && ['failed', 'interrupted', 'cancelled'].includes(task.status) ? <button className="quiet-button" disabled={busy} onClick={() => void act(() => taskRunner.retry(task.id))}>{zh ? '重试保存' : 'Retry save'}</button> : <button className="quiet-button" disabled={task?.status === 'running'} onClick={() => save(item.id, item.text ?? '')}><FileTextIcon />{task?.status === 'running' ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存到资料库' : 'Save to Library')}</button>
  }
  const taskHint = (task: TaskRecord) => task.status === 'interrupted' ? (zh ? '上次执行已中断，可从 Codex 会话继续。' : 'Execution was interrupted. Continue from the Codex session.') : task.status === 'cancelled' ? (zh ? '已停止生成。' : 'Response stopped.') : task.error
  const empty = !showLegacy && !thread?.turns.length && !running
  return <div className="conversation-page">
    <header className="conversation-toolbar">
      {selected && <span className="conversation-thread-title">{thread?.name || thread?.preview}</span>}
      <span className="conversation-runtime">Codex</span>
      {!!legacy.length && <button className="quiet-button" onClick={() => setShowLegacy(!showLegacy)}>{zh ? '以前的回顾草稿' : 'Previous review drafts'}</button>}
      {selected && <button className="icon-button" aria-label={zh ? '刷新对话' : 'Refresh conversation'} onClick={() => void act(() => conversationClient.read(selected))}><ReloadIcon /></button>}
    </header>
    <div className="conversation-layout">
      <section className={`conversation-main ${empty ? 'is-empty' : ''}`} aria-label={zh ? '当前对话' : 'Current conversation'}>

        <div className="conversation-messages" ref={scroll} onScroll={() => { const el = scroll.current!; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70 }}>
          {showLegacy ? <div className="conversation-legacy">{legacy.map((task) => { const draft = task.result as { id: string; title: string; content: string }; return <article key={task.id}><h3>{draft.title}</h3><div className="conversation-markdown"><ConversationMarkdown text={draft.content} onDocument={onDocument} /></div><button className="quiet-button" onClick={() => save(draft.id, draft.content, draft.title)}>{zh ? '保存到资料库' : 'Save to Library'}</button></article> })}</div> : !thread?.turns.length && !running ? <div className="conversation-empty"><h2>{greeting?.[language]}</h2><p>{zh ? '带上一个问题，或几份资料，慢慢理出头绪。' : 'Bring a question or a few documents, and work through them at your own pace.'}</p></div> : <>
            {thread?.nextCursor && <button className="quiet-button" disabled={busy} onClick={() => void act(() => conversationClient.read(selected!, thread.nextCursor))}>{zh ? '加载更早消息' : 'Load earlier messages'}</button>}
            {thread?.turns.map((turn) => <div className="conversation-turn" key={turn.id}>{turn.items.map((item) => item.type === 'userMessage' ? <article className="conversation-user" key={item.id}>{item.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n')}{!!attachments(item).length && <div className="conversation-message-sources">{attachments(item).map((doc) => <button key={doc.reference.documentId} onClick={() => onDocument(doc.reference)}><FileTextIcon />{doc.reference.title}</button>)}</div>}</article> : item.type === 'agentMessage' ? <article className={`conversation-answer ${item.phase === 'commentary' ? 'is-commentary' : ''}`} key={item.id}>{item.phase === 'commentary' && <span className="conversation-speaker">{zh ? '进展' : 'Progress'}</span>}<div className="conversation-markdown"><ConversationMarkdown text={item.text ?? ''} onDocument={onDocument} /></div>{turn.status === 'completed' && item.phase !== 'commentary' && item.text && <div className="conversation-answer-actions">{saveAction(item)}</div>}</article> : ['reasoning', 'plan', 'commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'contextCompaction', 'collabAgentToolCall'].includes(item.type) ? <ProcessItem key={item.id} item={item} zh={zh} /> : null)}{turn.error && <p className="conversation-error" role="alert">{turn.error.message}</p>}</div>)}
          </>}
        </div>
        <div className="conversation-composer-area">
          {error && <div className="conversation-error" role="alert"><span>{error}</span><button className="icon-button" aria-label={zh ? '关闭提示' : 'Dismiss'} onClick={() => setError(null)}><Cross2Icon /></button></div>}
          {stopped && stopped.id === latestResponseTask?.id && !running && <div className="conversation-recovery"><span>{taskHint(stopped)}</span><button className="quiet-button" disabled={busy} onClick={() => void act(() => taskRunner.retry(stopped.id))}><ReloadIcon />{zh ? '重试' : 'Retry'}</button></div>}
          {picker && <section className="conversation-picker"><header><label><MagnifyingGlassIcon /><input autoFocus placeholder={zh ? '搜索标题、正文或来源' : 'Search titles, content or sources'} value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="icon-button" aria-label={zh ? '关闭资料选择' : 'Close document picker'} onClick={() => setPicker(false)}><Cross2Icon /></button></header><div className="conversation-picker-list">{filtered.map((doc) => <label key={doc.id}><input type="checkbox" checked={ids.includes(doc.id)} disabled={!ids.includes(doc.id) && ids.length >= 50} onChange={() => setIds((current) => current.includes(doc.id) ? current.filter((id) => id !== doc.id) : [...current, doc.id])} /><FileTextIcon /><span><strong>{doc.title}</strong><small>{doc.collectionName} · {doc.documentDate}</small></span></label>)}{!filtered.length && <p>{zh ? '没有找到资料。' : 'No documents found.'}</p>}</div></section>}
          <form className="conversation-composer" onSubmit={(event) => { event.preventDefault(); send() }}>
            {!!ids.length && <div className="conversation-attachments">{ids.map((id) => <span key={id}><button type="button" onClick={() => onDocument({ kind: 'library-document', documentId: id, title: documents.find((d) => d.id === id)?.title ?? id })}><FileTextIcon />{documents.find((d) => d.id === id)?.title ?? id}</button><button type="button" aria-label={`${zh ? '移除引用' : 'Remove reference'} ${documents.find((d) => d.id === id)?.title ?? id}`} onClick={() => setIds((current) => current.filter((value) => value !== id))}><Cross2Icon /></button></span>)}</div>}
            <textarea ref={composer} aria-label={zh ? '消息' : 'Message'} placeholder={zh ? '输入消息，或引用资料一起讨论…' : 'Write a message, or add documents to discuss…'} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) send() } }} />
            <footer><button className={`quiet-button ${picker ? 'is-active' : ''}`} type="button" onClick={() => { setPicker(!picker); void listLibraryDocuments().then(setDocuments).catch((e) => setError(String(e))) }}><PlusIcon />{zh ? '引用资料' : 'Add documents'}</button><span>{zh ? 'Enter 发送 · Shift Enter 换行' : 'Enter to send · Shift Enter for a new line'}</span>{running ? <button className="conversation-send" type="button" aria-label={zh ? '停止生成' : 'Stop response'} onClick={() => void act(() => taskRunner.cancel(running.id))}><StopIcon /></button> : <button className="conversation-send" type="submit" disabled={!text.trim() || busy || !!thread?.turns.some((turn) => turn.status === 'inProgress')} aria-label={zh ? '发送消息' : 'Send message'}><ArrowUpIcon /></button>}</footer>
          </form>
        </div>
      </section>
    </div>
    {saving && <LibraryDialog wide title={zh ? '保存对话成果' : 'Save this answer'} busy={busy} onClose={() => { saveSelection.current++; setSaving(null) }}>
      <label className="library-field">{zh ? '保存位置' : 'Destination'}<select value={saving.targetDocumentId ?? ''} disabled={busy} onChange={(event) => void selectSaveTarget(event.target.value)}><option value="">{zh ? '保存为新文档' : 'Save as a new document'}</option>{documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.title} · {doc.capabilityName} · {doc.documentDate}</option>)}</select></label>
      <label className="library-field">{zh ? '文档标题' : 'Document title'}<input autoFocus value={saving.title} disabled={busy} maxLength={120} onChange={(event) => setSaving({ ...saving, title: event.target.value })} /></label>
      {saveCompare && saveTarget ? <DocumentComparison before={`# ${saveTarget.title}\n\n${saveTarget.content}`} after={`# ${saving.title}\n\n${saving.content}`} /> : <label className="library-field">{zh ? '正文' : 'Content'}<textarea className="library-editor" value={saving.content} disabled={busy} onChange={(event) => setSaving({ ...saving, content: event.target.value })} /></label>}
      <p className="modal-copy">{saving.targetDocumentId ? (zh ? '保存为所选文档的新版本，原内容和历史引用继续保留。' : 'Save a new revision of the selected document, retaining its previous content and citations.') : (zh ? '将编辑后的成果及来源引用保存到资料库。' : 'Save the edited answer and source links to the Library.')}</p>
      {saveError && <p role="alert" className="library-error">{saveError}</p>}
      <footer className="modal-footer">{saveTarget && <button className="secondary-button" disabled={busy} onClick={() => setSaveCompare(!saveCompare)}>{saveCompare ? (zh ? '继续编辑' : 'Keep editing') : (zh ? '查看差异' : 'Compare changes')}</button>}<button className="primary-button" disabled={!saving.title.trim() || !saving.content.trim() || busy || (!!saving.targetDocumentId && !saving.expectedRevision)} onClick={() => { setBusy(true); setSaveError(''); void taskRunner.start(CONVERSATION_OWNER, 'save-answer', saving).then(() => setSaving(null)).catch((e) => setSaveError(String(e))).finally(() => setBusy(false)) }}>{zh ? '保存到资料库' : 'Save to Library'}</button></footer>
    </LibraryDialog>}
  </div>
}
