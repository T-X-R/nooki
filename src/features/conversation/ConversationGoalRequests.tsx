import { useState } from 'react'
import { goalCommand } from '../task-board/task-board.ts'
import type { BoardCard } from '../task-board/task-board-store.ts'
import { conversationClient } from './conversation-client.ts'

// Async question items use ConversationQuestion in the native turn timeline.
export function ConversationGoalRequests({ task, zh, busy, act }: { task: BoardCard; zh: boolean; busy: boolean; act(operation: () => Promise<unknown>): Promise<void> }) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const reply = async (requestId: string | number, response: Record<string, unknown>) => {
    await goalCommand({ op: 'reply', id: task.id, requestId, ...response })
    await conversationClient.read(task.threadId!)
  }
  return <>{task.requests?.filter(request => request.method !== 'nooki/asyncQuestion').map(request => <section className="conversation-question conversation-goal-request" key={request.id} aria-label={zh ? 'Codex 请求' : 'Codex request'}>
    <header><strong>{request.method.includes('requestApproval') ? (zh ? 'Codex 请求授权' : 'Codex requests approval') : (zh ? 'Codex 需要你的输入' : 'Codex needs your input')}</strong></header>
    {request.params.reason && <p>{request.params.reason}</p>}
    {request.params.command && <pre>{request.params.command}</pre>}
    {request.method.includes('requestApproval') ? <>
      <details><summary>{zh ? '查看请求范围' : 'Review requested scope'}</summary><pre>{JSON.stringify(request.params, null, 2)}</pre></details>
      <div className="conversation-request-actions"><button className="secondary-button" disabled={busy} onClick={() => void act(() => reply(request.id, { decision: 'decline' }))}>{zh ? '拒绝' : 'Decline'}</button>
      <button className="primary-button" disabled={busy} onClick={() => void act(() => reply(request.id, { decision: 'accept' }))}>{request.method === 'item/permissions/requestApproval' ? (zh ? '允许本轮权限' : 'Allow for this turn') : (zh ? '允许此次操作' : 'Allow this action')}</button></div>
    </> : request.params.questions ? <form onSubmit={event => {
      event.preventDefault()
      void act(async () => {
        await reply(request.id, { answers: Object.fromEntries(request.params.questions!.map(q => [q.id, { answers: [answers[`${request.id}:${q.id}`] ?? ''] }])) })
        setAnswers({})
      })
    }}>
      {request.params.questions.map(question => <fieldset key={question.id} disabled={busy}><legend>{question.question}</legend>
        <div className="conversation-request-options">{question.options?.map(option => <button type="button" className="secondary-button" key={option.label} title={option.description} onClick={() => setAnswers(current => ({ ...current, [`${request.id}:${question.id}`]: option.label }))}>{option.label}</button>)}</div>
        <label className="conversation-question-custom"><span>{zh ? '填写回答' : 'Write an answer'}</span><input aria-label={question.question} required maxLength={10000} value={answers[`${request.id}:${question.id}`] ?? ''} onChange={event => setAnswers(current => ({ ...current, [`${request.id}:${question.id}`]: event.target.value }))} /></label>
      </fieldset>)}
      <button className="quiet-button" disabled={busy}>{zh ? '提交回答' : 'Submit answers'}</button>
    </form> : <p>{zh ? '此请求暂不支持，请停止后在 Codex 中处理。' : 'This request is not supported. Stop the task and handle it in Codex.'}</p>}
  </section>)}</>
}
