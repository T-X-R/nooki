import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CapabilityHost, CapabilityManifest, CapabilityModule, CapabilityPageProps } from './contract'
import { CapabilityPage, PageHeader, Panel, Button, StateMessage } from './ui'
import manifestJson from './manifest.json'
import './style.css'

const manifest: CapabilityManifest = manifestJson as CapabilityManifest

async function persistNote(host: Pick<CapabilityHost, 'storage'>, note: string) {
  if (typeof note !== 'string' || note.length > 100_000) throw new Error('Note must be at most 100,000 characters')
  await host.storage.set('note', note)
  return { saved: true }
}

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
    try { await persistNote(host, note); setSaved(true) }
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

export default {
  manifest,
  Page,
  jobs: { 'save-note': { run: (input, { host }) => persistNote(host, (input as { note: string }).note) } },
  commands: {
    'save-note': {
      job: 'save-note',
      title: 'Save a quick note',
      description: 'Replace the note stored by this capability.',
      locales: { zh: { title: '保存随手记', description: '替换这个能力保存的记录。' }, en: { title: 'Save a quick note', description: 'Replace the note stored by this capability.' } },
      inputSchema: { type: 'object', properties: { note: { type: 'string', maxLength: 100000 } }, required: ['note'], additionalProperties: false },
      outputSchema: { type: 'object', properties: { saved: { const: true } }, required: ['saved'], additionalProperties: false },
      effect: 'write',
      confirmation: 'always',
    },
  },
} satisfies CapabilityModule
