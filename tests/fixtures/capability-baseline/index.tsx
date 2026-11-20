import { useEffect, useState } from 'react'
import type { CapabilityManifest, CapabilityModule, CapabilityPageProps } from '../../../packages/capability-contract/src'
import manifest from './manifest.json'

function Page({ host }: CapabilityPageProps) {
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { void host.storage.get<number>('count').then(value => setCount(value ?? 0)).catch(reason => setError(String(reason))) }, [host])
  const publish = async () => {
    try {
      const next = (count ?? 0) + 1
      await host.documents.publish({ key: 'baseline', title: 'Synthetic profile receipt', collectionKey: 'baseline', collectionName: 'Baseline fixtures', documentDate: '2026-11-19', content: `# Synthetic profile receipt\n\nPublication ${next}. No personal data.` })
      await host.storage.set('count', next)
      setCount(next)
    } catch (reason) { setError(String(reason)) }
  }
  return <div className="wb-cap-page content-column"><h1>Profile baseline</h1><p>Stored count: {count ?? 'loading'}</p><button className="primary-button" disabled={count === null} onClick={() => void publish()}>Publish synthetic receipt</button>{error && <p role="alert">{error}</p>}</div>
}

export default { manifest: manifest as CapabilityManifest, Page } satisfies CapabilityModule
