import { useRef, useState } from 'react'
import { conversationClient } from './conversation-client.ts'
import type { ConversationItem } from './conversation-model.ts'

export function ConversationQuestion({ threadId, turnId, item, active, reply, zh }: { threadId: string; turnId: string; item: ConversationItem; active: boolean; reply?: ConversationItem; zh: boolean }) {
  const questions = item.questions ?? []
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''))
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const done = !!reply || sent
  const replyText = reply?.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n') ?? answers.join('\n')
  const title = done ? (zh ? '已回答' : 'Answered') : active ? (zh ? '待你回答' : 'Your input requested') : (zh ? '执行中的提问' : 'Question asked during the task')
  const send = async () => {
    if (pending.current || done || !active) return
    pending.current = true; setSending(true); setError(null)
    try { await conversationClient.answerQuestion(threadId, turnId, item.id, answers); setSent(true) }
    catch (e) { setError(String(e)); void conversationClient.read(threadId).catch(() => {}) }
    finally { pending.current = false; setSending(false) }
  }
  if (done) return <form className="conversation-question is-answered" aria-label={zh ? '执行中的提问' : 'Task question'}>
    <details>
      <summary><strong>{zh ? '已回答' : 'Answered'}</strong><span>{zh ? '查看问答' : 'View question and answer'}</span></summary>
      <div className="conversation-question-history">{questions.map((question, index) => <fieldset key={index} disabled>
        <legend>{question.title}</legend>
      </fieldset>)}<div className="conversation-question-response"><strong>{zh ? '你的回答' : 'Your answer'}</strong><p>{replyText}</p></div></div>
    </details>
  </form>
  return <form className="conversation-question" aria-label={zh ? '执行中的提问' : 'Task question'} onSubmit={(event) => { event.preventDefault(); void send() }}>
    <header role="status"><strong>{title}</strong><span>{active ? (zh ? '任务仍在继续' : 'The task is still running') : (zh ? '本轮已结束' : 'This turn has ended')}</span></header>
    {questions.map((question, index) => <fieldset key={index} disabled={done || sending}>
      <legend>{question.title}</legend>
      {!done && (active || answers[index]) ? <>
        {!!question.options?.length && <div className="conversation-question-options">{question.options.map((option, optionIndex) => <label key={optionIndex}><input type="radio" name={`${item.id}-${index}`} disabled={!active} checked={answers[index] === option} onChange={() => setAnswers((previous) => previous.map((answer, i) => i === index ? option : answer))} />{option}</label>)}</div>}
        <label className="conversation-question-custom"><span>{zh ? '填写回答' : 'Write an answer'}</span><input value={answers[index] ?? ''} readOnly={!active} maxLength={10000} onChange={(event) => setAnswers((previous) => previous.map((answer, i) => i === index ? event.target.value : answer))} /></label>
      </> : <ul>{question.options?.map((option, optionIndex) => <li key={optionIndex}>{option}</li>)}</ul>}
    </fieldset>)}
    {active && !done && <button className="quiet-button" type="submit" disabled={sending || questions.some((_, index) => !answers[index]?.trim())}>{sending ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送回答' : 'Send answer')}</button>}
    {!active && !done && <p>{zh ? '如需补充，请在下方输入框继续发送消息。' : 'To add your answer, send a message in the composer below.'}</p>}
    {error && <p className="conversation-error" role="alert">{error}</p>}
  </form>
}
