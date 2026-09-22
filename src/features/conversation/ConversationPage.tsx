import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, Cross2Icon, FileTextIcon, MagnifyingGlassIcon, PlusIcon, ReloadIcon, Share1Icon, StopIcon, UploadIcon } from '@radix-ui/react-icons'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DocumentReference, SelectedDocument, TaskRecord } from '../../../packages/capability-contract/src/index.ts'
import { parseReferenceHref } from '../../../packages/capability-contract/src/references.ts'
import { taskRunner } from '../../platform/tasks.ts'
import { conversationClient } from './conversation-client.ts'
import { CONVERSATION_OWNER, LEGACY_REVIEW, conversationRuntimeName, isConversationProcessItem, isConversationAnswer, isAsyncQuestion, asyncQuestionReply, waitingForInitialResponse, conversationDuration, type ConversationInput, type ConversationItem, type ConversationResult, type ConversationTurn, type SaveAnswerInput } from './conversation-model.ts'
import { listLibraryDocuments, searchLibraryContent, type LibraryDocumentMetadata } from '../../platform/document-library.ts'
import './conversation.css'
import { createGreetingRotation, type conversationGreetings } from './conversation-greetings.ts'
import { ConversationSaveDialog } from './ConversationSaveDialog.tsx'
import { ConversationQuestion } from './ConversationQuestion.tsx'
import { ConversationArtifacts } from './ConversationArtifacts.tsx'
import { artifactTitle, decodeAttachment, validateAttachments, type ConversationAttachment } from './conversation-documents.ts'
import { applySkillMention, attachedSkills, matchSkills, skillMention, type SkillMention } from './conversation-skills.ts'
import type { PoolSkill } from '../skills/skill-pool.ts'

// UI drafts only; the selected agent's native session is the authority for session history and messages.
const openingGreetings = createGreetingRotation()
const drafts = new Map<string, { text: string; ids: string[]; uploads: ConversationAttachment[] }>()
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
  if (item.type === 'reasoning') return summary?.trim() ? <pre className="conversation-reasoning" tabIndex={0} aria-label={label}>{summary}</pre> : null
  return <details className="conversation-process"><summary><ChevronDownIcon /><span>{label}</span>{item.status && <small>{item.status}</small>}</summary>{summary && <pre tabIndex={0} aria-label={label}>{summary}</pre>}{item.type === 'fileChange' && <pre>{JSON.stringify(item.changes, null, 2)}</pre>}{item.result != null && <pre>{JSON.stringify(item.result, null, 2)}</pre>}{item.error != null && <pre>{JSON.stringify(item.error, null, 2)}</pre>}</details>
}

function TurnProcess({ turn, zh, children }: { turn: ConversationTurn; zh: boolean; children: ReactNode }) {
  const { status } = turn
  const duration = conversationDuration(turn, zh)
  const [open, setOpen] = useState(status !== 'completed')
  useEffect(() => { setOpen(status !== 'completed') }, [status])
  return <details className="conversation-turn-process" open={open} onToggle={(event) => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open) }}>
    <summary><ChevronDownIcon /><span>{status === 'completed' ? (duration ? `${zh ? '用时' : 'Worked for'} ${duration}` : (zh ? '过程已完成' : 'Work completed')) : (zh ? '思考过程' : 'Process')}</span></summary>
    <div className="conversation-turn-process-body">{children}</div>
  </details>
}

export function ConversationPage({ onSelected, language, selectedAgent, incomingIds, onConsumed, targetId, onTargetConsumed, onDocument }: { onSelected(id: string | null): void; language: 'zh' | 'en'; selectedAgent: string; incomingIds: string[]; onConsumed(): void; targetId: string | null; onTargetConsumed(): void; onDocument(ref: DocumentReference): void }) {
  const zh = language === 'zh'
  const tasks = useSyncExternalStore(taskRunner.subscribe, taskRunner.getSnapshot, taskRunner.getSnapshot)
  const cache = useSyncExternalStore(conversationClient.subscribe, conversationClient.getSnapshot, conversationClient.getSnapshot)
  const [selected, setSelected] = useState<string | null>(targetId === 'new' ? null : targetId ?? currentSession)
  const [text, setText] = useState(() => drafts.get(targetId ?? currentSession ?? 'new')?.text ?? '')
  const [ids, setIds] = useState<string[]>(() => drafts.get(targetId ?? currentSession ?? 'new')?.ids ?? [])
  const [uploads, setUploads] = useState<ConversationAttachment[]>(() => drafts.get(targetId ?? currentSession ?? 'new')?.uploads ?? [])
  const uploadInput = useRef<HTMLInputElement>(null)
  const [greeting, setGreeting] = useState<(typeof conversationGreetings)[number] | null>(null)
  const handledNewOpening = useRef(false)
  const [documents, setDocuments] = useState<LibraryDocumentMetadata[]>([])
  const [skills, setSkills] = useState<PoolSkill[]>([])
  const [mention, setMention] = useState<SkillMention | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const [picker, setPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState<{ threadId: string | null; message: string; documentIds: string[]; uploads: ConversationAttachment[] } | null>(null)
  const [saving, setSaving] = useState<SaveAnswerInput | null>(null)
  const [showLegacy, setShowLegacy] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const composer = useRef<HTMLTextAreaElement>(null)
  const thread = selected ? cache[selected] : undefined
  const conversationTasks = tasks.filter((t) => t.capabilityId === CONVERSATION_OWNER && (t.input as { threadId?: string }).threadId === selected)
  const running = conversationTasks.find((t) => t.job === 'respond' && t.status === 'running')
  const stopped = [...conversationTasks].reverse().find((t) => t.job === 'respond' && ['failed', 'cancelled', 'interrupted'].includes(t.status))
  const latestResponseTask = [...conversationTasks].reverse().find((t) => t.job === 'respond')
  const pending = running
    ? (thread?.turns.some((turn) => turn.items.some((item) => item.type === 'userMessage' && item.clientId === running.id)) ? null : running.input as ConversationInput)
    : preparing?.threadId === selected ? preparing : null
  const loading = !!selected && !thread && !error && !pending
  const legacy = tasks.filter((t) => t.capabilityId === LEGACY_REVIEW && t.job === 'generate' && t.status === 'completed')
  const act = async (action: () => Promise<unknown>) => { setBusy(true); setError(null); try { await action() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  const select = (id: string | null) => {
    drafts.set(selected ?? 'new', { text, ids, uploads }); currentSession = id; setSelected(id); setMention(null)
    const draft = drafts.get(id ?? 'new'); setText(draft?.text ?? ''); setIds(draft?.ids ?? []); setUploads(draft?.uploads ?? []); setPicker(false); setShowLegacy(false); setError(null); follow.current = true
  }
  useEffect(() => {
    let current = true
    void listLibraryDocuments().then((docs) => { if (current) setDocuments(docs) }).catch((e) => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [])
  // The pool is the list; Nooki only passes the name on. A machine without one simply has no menu.
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return
    let current = true
    void invoke<PoolSkill[]>('skill_pool_list').then((pooled) => { if (current) setSkills(pooled) }).catch(() => {})
    return () => { current = false }
  }, [])
  useEffect(() => { if (targetId) { if (targetId === 'new') select(null); else if (targetId !== selected) select(targetId); onTargetConsumed() } }, [targetId])
  useEffect(() => {
    if (incomingIds.length) { setIds((previous) => [...new Set([...previous, ...incomingIds])]); onConsumed() }
  }, [incomingIds])
  useEffect(() => { onSelected(selected) }, [selected, onSelected])
  useEffect(() => { drafts.set(selected ?? 'new', { text, ids, uploads }) }, [selected, text, ids, uploads])
  useEffect(() => {
    const fresh = targetId === 'new' && !handledNewOpening.current
    handledNewOpening.current = targetId === 'new'
    if (targetId !== 'new' && selected && (!thread || thread.turns.length || running)) return
    setGreeting(openingGreetings.get(targetId === 'new' ? 'new' : selected ?? 'new', { fresh, hasDocuments: ids.length > 0 || incomingIds.length > 0, hasText: !!text.trim() }))
  }, [selected, targetId, ids.length, incomingIds.length, text, thread, running])
  const taskStatus = conversationTasks.map((t) => `${t.id}:${t.status}`).join(',')
  useEffect(() => {
    if (!selected) return
    let current = true
    void conversationClient.read(selected).catch((e) => { if (current) setError(String(e)) })
    return () => { current = false }
  }, [selected, taskStatus])
  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [thread, running, pending])
  useEffect(() => {
    let current = true
    setMatches([])
    const timer = window.setTimeout(() => { void searchLibraryContent(query).then((next) => { if (current) setMatches(next) }).catch((e) => { if (current) setError(String(e)) }) }, 150)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query])
  const filtered = documents.filter((doc) => !query.trim() || [doc.title, doc.capabilityName, doc.collectionName, doc.documentDate].some((value) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || matches.includes(doc.id))
  const attached = attachedSkills(text, skills)
  // The whole pool is offered and the menu scrolls: a person who keeps 40 skills means to see them.
  const suggestions = mention ? matchSkills(skills, mention.query) : []
  const editComposer = (next: { text: string; caret: number }) => {
    setText(next.text); setMention(null)
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.setSelectionRange(next.caret, next.caret) })
  }
  const trackMention = (element: HTMLTextAreaElement) => {
    const found = element.selectionStart === element.selectionEnd ? skillMention(element.value, element.selectionStart) : null
    setMention(found); setHighlighted(0)
  }
  const chooseSkill = (skill: PoolSkill) => { if (mention) editComposer(applySkillMention(text, mention, skill)) }
  const send = () => void act(async () => {
    if (!text.trim() || running || thread?.turns.some((t) => t.status === 'inProgress')) return
    validateAttachments(uploads, ids.length)
    setPreparing({ threadId: selected, message: text.trim(), documentIds: ids, uploads }); follow.current = true
    try {
      let id = selected
      if (!id) { const created = await conversationClient.create(); id = created.id; currentSession = id; setSelected(id); setPreparing((value) => value ? { ...value, threadId: id } : value) }
      const input: ConversationInput = { threadId: id, message: text.trim(), documentIds: ids, uploads, skills: attached, snapshotId: crypto.randomUUID() }
      await taskRunner.start(CONVERSATION_OWNER, 'respond', input)
      setText(''); setUploads([]); drafts.set(id, { text: '', ids, uploads: [] }); drafts.delete('new'); openingGreetings.clearDraft(); follow.current = true
    } finally { setPreparing(null) }
  })
  const attachFiles = async (files: File[]) => {
    const session = selected
    await act(async () => {
      const added = await Promise.all(files.map(async (file) => {
        if (file.size > 2_000_000) throw new Error(zh ? '单个附件不能超过 2 MB' : 'Each attachment must be at most 2 MB')
        return decodeAttachment(file.name, await file.arrayBuffer())
      }))
      validateAttachments([...uploads, ...added], ids.length)
      if (currentSession === session) setUploads((previous) => [...previous, ...added])
    })
  }
  const uploadAttachments = (item: ConversationItem) => (tasks.find((record) => record.id === item.clientId)?.input as ConversationInput | undefined)?.uploads ?? []
  const turnArtifacts = (turnId: string) => conversationTasks.filter((task) => task.job === 'respond' && task.status === 'completed' && (task.result as ConversationResult | null)?.turnId === turnId).flatMap((task) => (task.result as ConversationResult).artifacts ?? [])
  const artifactSource = (turn: ConversationTurn) => [...turn.items].reverse().find(isConversationAnswer)?.id ?? turn.items[0]?.id
  const save = (messageId: string, content: string, title?: string, sourceArtifactId?: string) => {
    setSaving({ threadId: selected ?? undefined, messageId: crypto.randomUUID(), sourceMessageId: messageId, sourceArtifactId, content, title: title ?? (thread?.name || thread?.preview || (zh ? '对话成果' : 'Conversation answer')).slice(0, 120), date: new Date().toLocaleDateString('en-CA'), language })
  }
  const attachments = (item: ConversationItem) => {
    const task = tasks.find((record) => record.id === item.clientId)
    return (task?.checkpoints.sources as SelectedDocument[] | undefined) ?? []
  }
  const savedTask = (messageId: string) => [...tasks].reverse().find((t) => t.capabilityId === CONVERSATION_OWNER && t.job === 'save-answer' && ((t.input as SaveAnswerInput).sourceArtifactId ?? (t.input as SaveAnswerInput).sourceMessageId ?? (t.input as SaveAnswerInput).messageId) === messageId && (t.input as SaveAnswerInput).threadId === selected)
  const saveAction = (item: ConversationItem, title?: string, artifactId?: string) => {
    const task = savedTask(artifactId ?? item.id)
    return task?.status === 'completed' ? <button className="quiet-button" onClick={() => onDocument(task.result as DocumentReference)}><CheckIcon />{zh ? '已保存 · 打开' : 'Saved · Open'}</button> : task && ['failed', 'interrupted', 'cancelled'].includes(task.status) ? <button className="quiet-button" disabled={busy} onClick={() => void act(() => taskRunner.retry(task.id))}>{zh ? '重试保存' : 'Retry save'}</button> : <button className="quiet-button" disabled={task?.status === 'running'} onClick={() => save(item.id, item.text ?? '', title, artifactId)}><FileTextIcon />{task?.status === 'running' ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存到资料库' : 'Save to Library')}</button>
  }
  const renderItem = (turn: ConversationTurn, item: ConversationItem) => item.type === 'userMessage' ? <article className="conversation-user" key={item.id}>{item.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n')}{!!attachments(item).length && <div className="conversation-message-sources">{attachments(item).map((doc) => <button key={doc.reference.documentId} onClick={() => onDocument(doc.reference)}><FileTextIcon />{doc.reference.title}</button>)}</div>}{!!uploadAttachments(item).length && <div className="conversation-message-sources">{uploadAttachments(item).map((file) => <span key={file.id}><FileTextIcon />{file.name}</span>)}</div>}</article> : item.type === 'agentMessage' ? <article className={`conversation-answer ${item.phase === 'commentary' ? 'is-commentary' : ''}`} key={item.id}><div className="conversation-markdown"><ConversationMarkdown text={item.text ?? ''} onDocument={onDocument} /></div>{turn.status === 'completed' && isConversationAnswer(item) && item.text && <div className="conversation-answer-actions">{saveAction(item)}</div>}</article> : ['reasoning', 'plan', 'commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'webSearch', 'contextCompaction', 'collabAgentToolCall'].includes(item.type) ? <ProcessItem key={item.id} item={item} zh={zh} /> : null
  const isProcessMessage = (item: ConversationItem) => item.type === 'agentMessage' && item.delivery === 'async'
  const isProcessHistory = (item: ConversationItem) => isConversationProcessItem(item) || isProcessMessage(item)
  const questionReplyIds = new Set(thread?.turns.flatMap((turn) => turn.items.filter(isAsyncQuestion).map((item) => asyncQuestionReply(thread.turns, item.id)?.id)).filter(Boolean))
  const renderQuestion = (turn: ConversationTurn, item: ConversationItem) => isAsyncQuestion(item) ? <ConversationQuestion key={item.id} threadId={thread!.id} turnId={turn.id} item={item} active={turn.status === 'inProgress'} reply={asyncQuestionReply(thread!.turns, item.id)} zh={zh} /> : <aside className="conversation-question" key={item.id}><strong>{zh ? '执行中的消息' : 'Message during the task'}</strong><ConversationMarkdown text={item.text ?? ''} onDocument={onDocument} /></aside>
  const taskHint = (task: TaskRecord) => task.status === 'interrupted' ? (zh ? '会话连接已断开，可重新连接以核对执行状态。' : 'The connection was lost. Reconnect to check the execution state.') : task.status === 'cancelled' ? (zh ? '已请求停止，可重新连接核对状态，或发送新消息继续。' : 'Stop requested. Reconnect to check its state, or send a message to continue.') : task.error
  const showInitialPlaceholder = conversationTasks.filter((task) => task.job === 'respond').length <= 1 && waitingForInitialResponse(thread?.turns ?? [], !!thread?.nextCursor)
  const empty = !showLegacy && !loading && !pending && !thread?.turns.length && !running
  return <div className="conversation-page">
    <header className="conversation-toolbar">
      {selected && <span className="conversation-thread-title">{thread?.name || thread?.preview}</span>}
      <span className="conversation-runtime">{conversationRuntimeName(thread, selectedAgent)}</span>
      {!!legacy.length && <button className="quiet-button" onClick={() => setShowLegacy(!showLegacy)}>{zh ? '以前的回顾草稿' : 'Previous review drafts'}</button>}
      {selected && <button className="icon-button" aria-label={zh ? '刷新对话' : 'Refresh conversation'} onClick={() => void act(() => conversationClient.read(selected))}><ReloadIcon /></button>}
    </header>
    <div className="conversation-layout">
      <section className={`conversation-main ${empty ? 'is-empty' : ''}`} aria-label={zh ? '当前对话' : 'Current conversation'}>

        <div className="conversation-messages" ref={scroll} onWheel={(event) => { if (event.deltaY < 0) follow.current = false }} onKeyDown={(event) => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) follow.current = false }} onClickCapture={(event) => { if ((event.target as HTMLElement).closest('summary')) follow.current = false }} onScroll={() => { const el = scroll.current!; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 2 }}>
          {showLegacy ? <div className="conversation-legacy">{legacy.map((task) => { const draft = task.result as { id: string; title: string; content: string }; return <article key={task.id}><h3>{draft.title}</h3><div className="conversation-markdown"><ConversationMarkdown text={draft.content} onDocument={onDocument} /></div><button className="quiet-button" onClick={() => save(draft.id, draft.content, draft.title)}>{zh ? '保存到资料库' : 'Save to Library'}</button></article> })}</div> : loading ? <div className="conversation-state" role="status"><ReloadIcon className="spin" />{zh ? '正在读取对话…' : 'Loading conversation…'}</div> : empty ? <div className="conversation-empty"><h2>{greeting?.[language]}</h2><p>{zh ? '带上一个问题，或几份资料，慢慢理出头绪。' : 'Bring a question or a few documents, and work through them at your own pace.'}</p></div> : <>
            {thread?.nextCursor && <button className="quiet-button" disabled={busy} onClick={() => void act(() => conversationClient.read(selected!, thread.nextCursor))}>{zh ? '加载更早消息' : 'Load earlier messages'}</button>}
            {thread?.turns.map((turn) => <div className="conversation-turn" key={turn.id}>{turn.items.filter((item) => item.type === 'userMessage' && !questionReplyIds.has(item.id)).map((item) => renderItem(turn, item))}
              {turn.items.some(isProcessHistory) && <TurnProcess turn={turn} zh={zh}>{turn.items.filter(isProcessHistory).map((item) => isProcessMessage(item) ? renderQuestion(turn, item) : renderItem(turn, item))}</TurnProcess>}
              {turn.items.filter(isConversationAnswer).map((item) => renderItem(turn, item))}{turn.error && <p className="conversation-error" role="alert">{turn.error.message}</p>}<ConversationArtifacts files={turnArtifacts(turn.id)} zh={zh} onDocument={onDocument} onSave={(file) => save(artifactSource(turn), file.content, artifactTitle(file.name), file.id)} saveAction={(file) => saveAction({ id: artifactSource(turn), type: 'agentMessage', text: file.content }, artifactTitle(file.name), file.id)} /></div>)}
            {pending && <div className="conversation-turn"><article className="conversation-user">{pending.message}
              {!!pending.documentIds.length && <div className="conversation-message-sources">{pending.documentIds.map((id) => <span key={id}><FileTextIcon />{documents.find((doc) => doc.id === id)?.title ?? id}</span>)}</div>}
              {!!pending.uploads?.length && <div className="conversation-message-sources">{pending.uploads.map((file) => <span key={file.id}><FileTextIcon />{file.name}</span>)}</div>}
            </article></div>}
            {showInitialPlaceholder && (preparing || running) && <div className="conversation-state" role="status"><ReloadIcon className="spin" />{preparing ? (zh ? '正在准备对话…' : 'Preparing conversation…') : (zh ? '正在生成…' : 'Generating…')}</div>}
          </>}
        </div>
        <div className="conversation-composer-area">
          {error && <div className="conversation-error" role="alert"><span>{error}</span><button className="icon-button" aria-label={zh ? '关闭提示' : 'Dismiss'} onClick={() => setError(null)}><Cross2Icon /></button></div>}
          {stopped && stopped.id === latestResponseTask?.id && !running && <div className="conversation-recovery"><span>{taskHint(stopped)}</span><button className="quiet-button" disabled={busy} onClick={() => void act(() => taskRunner.reconnect(stopped.id))}><ReloadIcon />{zh ? '重新连接' : 'Reconnect'}</button></div>}
          {picker && <section className="conversation-picker"><header><label><MagnifyingGlassIcon /><input autoFocus placeholder={zh ? '搜索标题、正文或来源' : 'Search titles, content or sources'} value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="icon-button" aria-label={zh ? '关闭资料选择' : 'Close document picker'} onClick={() => setPicker(false)}><Cross2Icon /></button></header><div className="conversation-picker-list">{filtered.map((doc) => <label key={doc.id}><input type="checkbox" checked={ids.includes(doc.id)} disabled={!ids.includes(doc.id) && ids.length + uploads.length >= 50} onChange={() => setIds((current) => current.includes(doc.id) ? current.filter((id) => id !== doc.id) : [...current, doc.id])} /><FileTextIcon /><span><strong>{doc.title}</strong><small>{doc.collectionName} · {doc.documentDate}</small></span></label>)}{!filtered.length && <p>{zh ? '没有找到资料。' : 'No documents found.'}</p>}</div></section>}
          <form className="conversation-composer" onSubmit={(event) => { event.preventDefault(); send() }}>
            {!!ids.length && <div className="conversation-attachments">{ids.map((id) => <span key={id}><button type="button" onClick={() => onDocument({ kind: 'library-document', documentId: id, title: documents.find((d) => d.id === id)?.title ?? id })}><FileTextIcon />{documents.find((d) => d.id === id)?.title ?? id}</button><button type="button" aria-label={`${zh ? '移除引用' : 'Remove reference'} ${documents.find((d) => d.id === id)?.title ?? id}`} onClick={() => setIds((current) => current.filter((value) => value !== id))}><Cross2Icon /></button></span>)}</div>}
            {!!uploads.length && <div className="conversation-attachments">{uploads.map((file) => <span key={file.id}><span className="conversation-upload-name"><FileTextIcon />{file.name}</span><button type="button" aria-label={`${zh ? '移除附件' : 'Remove attachment'} ${file.name}`} onClick={() => setUploads((current) => current.filter((value) => value.id !== file.id))}><Cross2Icon /></button></span>)}</div>}
            <input ref={uploadInput} type="file" accept=".md,.txt,text/markdown,text/plain" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void attachFiles(files) }} />
            {!!suggestions.length && <div className="conversation-skill-menu" role="listbox" aria-label={zh ? '技能池' : 'Skill pool'}>
              {suggestions.map((skill, index) => <button key={skill.name} type="button" role="option" aria-selected={index === highlighted} className={index === highlighted ? 'is-highlighted' : ''} ref={(element) => { if (index === highlighted) element?.scrollIntoView({ block: 'nearest' }) }} onMouseDown={(event) => { event.preventDefault(); chooseSkill(skill) }} onMouseEnter={() => setHighlighted(index)}>
                <strong>{skill.name}</strong><small>{skill.description}</small>
              </button>)}
            </div>}
            {!!attached.length && <div className="conversation-attachments conversation-skill-chips">{attached.map((name) => <span key={name}><span><Share1Icon />{name}</span></span>)}</div>}
            <textarea ref={composer} aria-label={zh ? '消息' : 'Message'} placeholder={zh ? '输入消息，$ 或 / 调用技能，或添加一份文档开始修改…' : 'Write a message, type $ or / to use a skill, or add a document to revise…'} value={text}
              onChange={(event) => { setText(event.target.value); trackMention(event.target) }}
              onClick={(event) => trackMention(event.currentTarget)}
              onBlur={() => setMention(null)}
              onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) trackMention(event.currentTarget) }}
              onKeyDown={(event) => {
                if (suggestions.length) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setHighlighted((current) => (current + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); return }
                  if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); chooseSkill(suggestions[highlighted]); return }
                  if (event.key === 'Escape') { event.preventDefault(); setMention(null); return }
                }
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) send() }
              }} />
            <footer><button className={`quiet-button ${picker ? 'is-active' : ''}`} type="button" onClick={() => { setPicker(!picker); void listLibraryDocuments().then(setDocuments).catch((e) => setError(String(e))) }}><PlusIcon />{zh ? '引用资料' : 'Add documents'}</button><button className="quiet-button" type="button" disabled={busy} onClick={() => uploadInput.current?.click()}><UploadIcon />{zh ? '上传附件' : 'Attach file'}</button><span>{zh ? 'Enter 发送 · Shift Enter 换行' : 'Enter to send · Shift Enter for a new line'}</span>{running ? <button className="conversation-send" type="button" aria-label={zh ? '停止生成' : 'Stop response'} onClick={() => void act(() => taskRunner.cancel(running.id))}><StopIcon /></button> : <button className="conversation-send" type="submit" disabled={!text.trim() || busy || !!thread?.turns.some((turn) => turn.status === 'inProgress')} aria-label={zh ? '发送消息' : 'Send message'}><ArrowUpIcon /></button>}</footer>
          </form>
        </div>
      </section>
    </div>
    {saving && <ConversationSaveDialog input={saving} onClose={() => setSaving(null)} />}
  </div>
}
