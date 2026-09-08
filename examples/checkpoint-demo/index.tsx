import { useState, useSyncExternalStore } from 'react'
import type { CapabilityModule, CapabilityPageProps } from '../../packages/capability-contract/src'
import manifest from './manifest.json'

function Page({ host }: CapabilityPageProps) {
  const { language } = useSyncExternalStore(host.environment.subscribe, host.environment.getSnapshot)
  const tasks = useSyncExternalStore(host.tasks.subscribe, host.tasks.getSnapshot)
  const [error, setError] = useState<string | null>(null)
  const zh = language === 'zh'
  return <div className="content-column">
    <h1>{zh ? '检查点示例' : 'Checkpoint demo'}</h1>
    <p>{zh ? '运行后会等待 10 秒，并故意失败一次。到任务页重试时，会跳过已完成的等待并发布文档。' : 'Waits 10 seconds, then fails once. Retry from Tasks to skip the completed wait and publish a document.'}</p>
    <button className="primary-button" onClick={() => { void host.tasks.start('demo', { key: crypto.randomUUID(), date: new Date().toLocaleDateString('en-CA') }).catch((reason) => setError(String(reason))) }}>{zh ? '运行示例' : 'Run demo'}</button>
    <p>{zh ? '已提交任务数' : 'Submitted tasks'}: {tasks.length}</p>
    {error && <p role="alert">{error}</p>}
  </div>
}

const capability: CapabilityModule = {
  manifest,
  Page,
  jobs: {
    demo: {
      async run(input, { host, signal, step }) {
        const { key, date } = input as { key: string; date: string }
        await step('prepare', () => new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new Error('Cancelled')) }
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 10_000)
          signal.addEventListener('abort', abort, { once: true })
        }))
        await step('publish', async () => {
          if (!await host.storage.get(key)) {
            await host.storage.set(key, true)
            throw new Error('示例故意失败一次；请从检查点重试。 / Deliberate first failure; retry from checkpoints.')
          }
          await host.documents.publish({ key, title: 'Checkpoint demo', collectionKey: 'examples', collectionName: 'Examples', documentDate: date, content: '# Checkpoint demo\n\nPublished after a checkpoint retry.' })
        })
        return 'Published'
      },
    },
  },
}
export default capability
