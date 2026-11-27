import { useState, useSyncExternalStore } from 'react'
import type { BoardCreateInput, CapabilityManifest, CapabilityModule, CapabilityPageProps, DocumentReference, IdempotencyOptions } from './contract'
import { CapabilityPage, PageHeader, Panel, Button } from './ui'
import manifestJson from './manifest.json'
import './style.css'

const manifest = manifestJson as CapabilityManifest
type Intent = { input: BoardCreateInput; options: IdempotencyOptions }
function Page({ host }: CapabilityPageProps) {
  const environment = useSyncExternalStore(host.environment.subscribe, host.environment.getSnapshot)
  const t = (zh: string, en: string) => environment.language === 'zh' ? zh : en
  const [result, setResult] = useState('Ready'), [busy, setBusy] = useState(false), [foreign, setForeign] = useState('')
  const submit = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true); setResult('Pending')
    try { setResult(JSON.stringify(await action(), null, 2)) }
    catch (error) { setResult(error && typeof error === 'object' && 'code' in error ? String(error.code) : String(error)) }
    finally { setBusy(false) }
  }
  const saved = async () => { const intent = await host.storage.get<Intent>('intent'); if (!intent) throw new Error('Select a source first'); return intent }
  const publish = async (changed: boolean) => {
    await host.documents.publish({ key: 'minutes', collectionKey: 'source-tests', collectionName: 'Source tests', documentDate: '2026-11-24', title: `${manifest.name} notes`, content: changed ? '# Changed notes\nCHANGED CURRENT SOURCE' : '# Original notes\nORIGINAL SELECTED SOURCE' })
    return changed ? 'Changed current source' : 'Published original source'
  }
  const select = async () => {
    const selection = await host.library.requestSelection({ purpose: 'Create a review todo from selected synthetic notes; no agent execution.', kinds: ['document'], limit: 1 })
    if (selection.status === 'dismissed') return selection
    const intent: Intent = { input: { title: `Sourced review — ${manifest.id}`, description: 'Review original selected notes. Creation does not execute work.', sources: selection.grant.documents.map(doc => doc.reference) }, options: { idempotencyKey: crypto.randomUUID() } }
    await host.storage.set('intent', intent)
    return intent
  }
  return <CapabilityPage environment={environment} className="sourced-board-acceptance">
    <PageHeader title={t('带来源待办验收', 'Sourced board acceptance')} description={t('仅公开 SDK · 合成资料 · 不执行 Agent', 'Public SDK only · Synthetic input · No agent execution')} />
    <Panel><div className="sourced-board-actions">
      <Button disabled={busy} onClick={() => void submit(() => publish(false))}>{t('发布原始资料', 'Publish original source')}</Button>
      <Button disabled={busy} onClick={() => void submit(select)}>{t('选择资料并保存意图', 'Select and save intent')}</Button>
      <Button disabled={busy} onClick={() => void submit(async () => { const intent = await saved(); return host.board.create(intent.input, intent.options) })}>{t('创建或重试待办', 'Create or replay todo')}</Button>
      <Button disabled={busy} onClick={() => void submit(saved)}>{t('查看保存的意图', 'Show saved intent')}</Button>
      <Button disabled={busy} onClick={() => void submit(() => publish(true))}>{t('修改当前资料', 'Change current source')}</Button>
      <Button disabled={busy} onClick={() => void submit(async () => { const reference = (await saved()).input.sources![0]; return host.documents.readSelected(reference.grantId!, reference.documentId) })}>{t('读取所选资料', 'Read selected source')}</Button>
      <Button disabled={busy} onClick={() => void submit(async () => { host.documents.open((await saved()).input.sources![0]); return 'Opened retained citation' })}>{t('打开保留引用', 'Open retained citation')}</Button>
    </div></Panel>
    <Panel><h2>{t('拒绝路径对照', 'Refusal controls')}</h2><p>{t('撤销授权后，新键应被拒绝；已提交的原键仍可重试。', 'After revocation, a new key must fail; the committed original key can still replay.')}</p>
      <div className="sourced-board-actions">
        <Button disabled={busy} onClick={() => void submit(async () => { const intent = await saved(); return host.board.create(intent.input, { idempotencyKey: `${intent.options.idempotencyKey}-new` }) })}>{t('尝试新键创建', 'Try creation with new key')}</Button>
        <Button disabled={busy} onClick={() => void submit(async () => { const intent = await saved(); return host.board.create({ ...intent.input, title: 'Conflicting title' }, intent.options) })}>{t('尝试同键改内容', 'Try changed input with same key')}</Button>
      </div>
      <label>{t('另一包的单条引用 JSON', 'One reference JSON from another package')}<textarea value={foreign} onChange={event => setForeign(event.target.value)} /></label>
      <Button disabled={busy} onClick={() => void submit(() => host.board.create({ title: 'Foreign source must fail', sources: [JSON.parse(foreign) as DocumentReference] }, { idempotencyKey: 'foreign-source-check' }))}>{t('尝试另一包来源', 'Try foreign source')}</Button>
    </Panel>
    <Panel><h2>{t('结果', 'Result')}</h2><pre aria-live="polite">{result}</pre></Panel>
  </CapabilityPage>
}
export default { manifest, Page } satisfies CapabilityModule
