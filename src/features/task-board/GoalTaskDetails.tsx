import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { goalCommand } from './task-board.ts'
import type { BoardCard } from './task-board-store.ts'
import { ConversationArtifacts } from '../conversation/ConversationArtifacts.tsx'
import { ConversationSaveDialog } from '../conversation/ConversationSaveDialog.tsx'
import type { Conversation, SaveAnswerInput } from '../conversation/conversation-model.ts'
import type { ConversationArtifact } from '../conversation/conversation-documents.ts'

export function GoalTaskDetails({ card, zh, act }: { card: BoardCard; zh: boolean; act(operation: () => Promise<unknown>): Promise<void> }) {
  const [history, setHistory] = useState<Conversation | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<SaveAnswerInput | null>(null)
  useEffect(() => { setHistory(null); setHistoryError(''); setHistoryOpen(false); setAnswers({}) }, [card.id])
  useEffect(() => {
    if (!historyOpen || !card.threadId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      try {
        const result = await invoke<Conversation>('task_board_command', { request: { op: 'history', id: card.id } })
        if (!cancelled) { setHistory(result); setHistoryError('') }
      } catch (error) { if (!cancelled) setHistoryError(String(error)) }
      if (!cancelled) timer = setTimeout(() => void read(), 3000)
    }
    void read()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [historyOpen, card.id, card.threadId])
  function save(content: string, name: string, artifactId?: string) {
    setSaving({ threadId: card.threadId, messageId: `goal-${card.id}`, sourceArtifactId: artifactId, title: name.replace(/\.(md|txt)$/i, ''), content, date: new Date().toLocaleDateString('en-CA'), language: zh ? 'zh' : 'en' })
  }
  const saveFile = (file: ConversationArtifact) => save(file.content, file.name, file.id)
  return <div className="task-goal-details">
    <p className="task-board-text">{zh ? '工作目录：' : 'Workspace: '}{card.execution?.cwd || card.cwd || (zh ? '独立任务目录' : 'Dedicated task workspace')}</p>
    {card.goal && <p className="task-board-text">{zh ? '原生目标：' : 'Native goal: '}{card.goal.status} · {card.goal.tokensUsed?.toLocaleString()} tokens</p>}
    {card.execution && <details><summary>{zh ? '执行配置' : 'Execution settings'}</summary><p className="task-board-text">{card.execution.model} · {card.execution.approvalPolicy} · {card.execution.sandbox}</p><p className="task-board-text">{zh ? '文档输出：' : 'Document outputs: '}{card.execution.outputs}</p></details>}
    {card.requests?.map(request => <section className="task-goal-request" key={request.id}>
      <h3>{request.method.includes('requestApproval') ? (zh ? 'Codex 请求授权' : 'Codex requests approval') : (zh ? 'Codex 需要你的输入' : 'Codex needs your input')}</h3>
      {request.params.reason && <p>{request.params.reason}</p>}
      {request.params.command && <pre>{request.params.command}</pre>}
      {request.method.includes('requestApproval') ? <>
        <details><summary>{zh ? '查看请求范围' : 'Review requested scope'}</summary><pre>{JSON.stringify(request.params, null, 2)}</pre></details>
        <button className="secondary-button" onClick={() => void act(() => goalCommand({ op: 'reply', id: card.id, requestId: request.id, decision: 'decline' }))}>{zh ? '拒绝' : 'Decline'}</button>
        <button className="primary-button" onClick={() => void act(() => goalCommand({ op: 'reply', id: card.id, requestId: request.id, decision: 'accept' }))}>{zh ? '允许此次操作' : 'Allow this action'}</button>
      </> : request.params.questions ? <form onSubmit={event => {
        event.preventDefault()
        void act(async () => {
          await goalCommand({ op: 'reply', id: card.id, requestId: request.id, answers: Object.fromEntries(request.params.questions!.map(q => [q.id, { answers: [answers[`${request.id}:${q.id}`] ?? ''] }])) })
          setAnswers({})
        })
      }}>
        {request.params.questions.map(question => <fieldset key={question.id}><legend>{question.question}</legend>
          {question.options?.map(option => <button type="button" className="secondary-button" key={option.label} title={option.description} onClick={() => setAnswers(current => ({ ...current, [`${request.id}:${question.id}`]: option.label }))}>{option.label}</button>)}
          <textarea aria-label={question.question} required value={answers[`${request.id}:${question.id}`] ?? ''} onChange={event => setAnswers(current => ({ ...current, [`${request.id}:${question.id}`]: event.target.value }))} />
        </fieldset>)}
        <button className="primary-button">{zh ? '提交回答' : 'Submit answers'}</button>
      </form> : <p>{zh ? '此请求暂不支持，请停止后在 Codex 中处理。' : 'This request is not supported. Stop the task and handle it in Codex.'}</p>}
    </section>)}
    {card.delivery && <section><h3>{zh ? '任务成果' : 'Delivery'}</h3>
      <div className="conversation-markdown"><Markdown remarkPlugins={[remarkGfm]}>{card.delivery.text}</Markdown></div>
      {card.delivery.text && <button className="secondary-button" onClick={() => save(card.delivery!.text, card.title)}>{zh ? '保存到资料库' : 'Save to Library'}</button>}
      <ConversationArtifacts files={card.delivery.artifacts} zh={zh} onSave={saveFile} onDocument={() => {}} saveAction={file => <button className="quiet-button" onClick={() => saveFile(file)}>{zh ? '保存' : 'Save'}</button>} />
    </section>}
    {card.threadId && <section>
      <button className="text-button" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>{zh ? '查看执行过程' : 'View execution history'}</button>
      {historyOpen && <div className="task-goal-history">{historyError && <p role="alert">{historyError}</p>}{history?.turns.map(turn => <details key={turn.id} open={turn.status === 'inProgress'}><summary>{turn.status} · {turn.id}</summary>{turn.items.map(item => <div key={item.id}>
        {item.type === 'agentMessage' ? <div className="conversation-markdown"><Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown></div> : item.type === 'reasoning' ? <p>{item.summary?.join('\n')}</p> : <details><summary>{item.type}{item.command ? ` · ${item.command}` : ''}{item.tool ? ` · ${item.tool}` : ''}</summary>
          {item.aggregatedOutput && <pre>{item.aggregatedOutput}</pre>}
          {item.changes && <pre>{JSON.stringify(item.changes, null, 2)}</pre>}
          {item.error != null && <pre>{JSON.stringify(item.error, null, 2)}</pre>}
          {item.type === 'userMessage' && <p>{item.content?.map(part => part.text ?? '').join('\n')}</p>}
        </details>}
      </div>)}{turn.error && <p role="alert">{turn.error.message}</p>}</details>)}</div>}
    </section>}
    {saving && <ConversationSaveDialog input={saving} onClose={() => setSaving(null)} />}
  </div>
}
