import { CheckIcon, Cross2Icon } from '@radix-ui/react-icons'
import { capabilityInvocationStore, type CapabilityInvocationRecord } from './capability-invocations.ts'

export function CapabilityInvocationCard({ invocation, zh }: { invocation: CapabilityInvocationRecord; zh: boolean }) {
  const labels = {
    proposed: zh ? '准备调用' : 'Preparing',
    awaiting_confirmation: zh ? '等待确认' : 'Needs confirmation',
    running: zh ? '执行中' : 'Running',
    completed: zh ? '已完成' : 'Completed',
    failed: zh ? '失败' : 'Failed',
    cancelled: zh ? '已取消' : 'Cancelled',
    interrupted: zh ? '已中断' : 'Interrupted',
  }
  return <article className={`capability-invocation is-${invocation.status}`}>
    <header><span>{invocation.command.capabilityName}</span><strong>{invocation.command.title}</strong><small>{labels[invocation.status]}</small></header>
    <p>{invocation.command.description}</p>
    {!!invocation.sources?.length && <p>{zh ? '将交给此能力的本轮附件：' : 'Attachments shared with this capability: '}{invocation.sources.map((source) => source.title).join('、')}</p>}
    <details><summary>{zh ? '查看输入' : 'View input'}</summary><pre>{JSON.stringify(invocation.input, null, 2)}</pre></details>
    {invocation.status === 'awaiting_confirmation' && <footer>
      <button className="secondary-button" onClick={() => capabilityInvocationStore.decide(invocation.invocationId, false)}><Cross2Icon />{zh ? '取消' : 'Cancel'}</button>
      <button className="primary-button" onClick={() => capabilityInvocationStore.decide(invocation.invocationId, true)}><CheckIcon />{zh ? '确认执行' : 'Confirm'}</button>
    </footer>}
    {invocation.result !== undefined && <details><summary>{zh ? '查看结果' : 'View result'}</summary><pre>{JSON.stringify(invocation.result, null, 2)}</pre></details>}
    {invocation.error && <p className="capability-invocation-error" role="alert">{invocation.error}</p>}
  </article>
}
