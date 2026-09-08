import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CapabilityManifest, CapabilityModule, CapabilityPageProps } from './contract'
import { CapabilityPage, PageHeader, Panel, Button, StateMessage } from './ui'
import manifestJson from './manifest.json'
import './style.css'

const manifest: CapabilityManifest = manifestJson as CapabilityManifest

function Page({ host }: CapabilityPageProps) {
  const environment = useSyncExternalStore(host.environment.subscribe, host.environment.getSnapshot)
  const zh = environment.language === 'zh'
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    host.storage.get<string>('note').then((value) => { if (active) setNote(value ?? '') })
      .catch((reason) => { if (active) setError(String(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [host])
  const save = async () => {
    setSaving(true); setError(''); setSaved(false)
    try { await host.storage.set('note', note); setSaved(true) }
    catch (reason) { setError(String(reason)) }
    finally { setSaving(false) }
  }
  return <CapabilityPage environment={environment} className="quick-notes">
    <PageHeader title={zh ? '随手记' : 'Quick notes'} description={zh ? '留下一段想法，下次打开时继续。' : 'Keep a thought and return to it later.'} />
    <Panel>
      <label htmlFor="note">{zh ? '记录' : 'Note'}</label>
      <textarea id="note" value={note} disabled={loading || saving} placeholder={zh ? '写点什么…' : 'Write something…'} onChange={(event) => { setNote(event.target.value); setSaved(false) }} />
      <Button disabled={loading || saving} onClick={() => void save()}>{saving ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</Button>
      {saved && <StateMessage>{zh ? '已保存' : 'Saved'}</StateMessage>}
      {error && <StateMessage error>{error}</StateMessage>}
    </Panel>
  </CapabilityPage>
}

export default { manifest, Page } satisfies CapabilityModule
