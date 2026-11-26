import { useState, useSyncExternalStore } from 'react'
import type { CapabilityManifest, CapabilityModule, CapabilityPageProps, ConversationHandoffInput, DocumentPublication, DocumentReference, IdempotencyOptions } from './contract'
import { CapabilityPage, PageHeader, Panel, Button } from './ui'
import manifestJson from './manifest.json'
import './style.css'

const manifest = manifestJson as CapabilityManifest
type Intent = { input: ConversationHandoffInput; options: IdempotencyOptions }
const publication = (changed = false): DocumentPublication => ({ key:'notes',collectionKey:'handoff-tests',collectionName:'Handoff tests',documentDate:'2026-11-26',title:`${manifest.name} notes`,content:changed ? '# Changed original\nCHANGED CURRENT HANDOFF SOURCE' : '# Original notes\nORIGINAL RETAINED HANDOFF\n\nSynthetic meeting notes. No personal data.' })

function Page({ host }: CapabilityPageProps) {
  const environment = useSyncExternalStore(host.environment.subscribe,host.environment.getSnapshot)
  const t = (zh:string,en:string) => environment.language === 'zh' ? zh : en
  const [busy,setBusy] = useState(false), [result,setResult] = useState('Ready'), [foreign,setForeign] = useState('')
  const submit = async(action:()=>Promise<unknown>) => {
    if(busy)return
    setBusy(true);setResult('Pending')
    try {setResult(JSON.stringify(await action(),null,2))}
    catch(error){setResult(error && typeof error==='object' && 'code' in error ? String(error.code) : String(error))}
    finally{setBusy(false)}
  }
  const saved = async() => {const intent=await host.storage.get<Intent>('handoff-intent');if(!intent)throw new Error('Prepare an intent first');return intent}
  const select = async() => {
    const selection=await host.library.requestSelection({purpose:'Include this synthetic document snapshot in a user-reviewed chat draft.',kinds:['document'],limit:1})
    if(selection.status==='selected')await host.storage.set('sources',selection.grant.documents.map(doc=>doc.reference))
    return selection
  }
  const prepare = async(withSources:boolean) => {
    const sources=withSources?await host.storage.get<DocumentReference[]>('sources'):[]
    if(withSources&&!sources?.length)throw new Error('Select a document snapshot first')
    const intent:Intent={input:{title:`${manifest.name} offer`,text:`Please review the synthetic notes from ${manifest.name}.`,sources:sources??[]},options:{idempotencyKey:crypto.randomUUID()}}
    await host.storage.set('handoff-intent',intent);return intent
  }
  return <CapabilityPage environment={environment} className="conversation-handoff-acceptance">
    <PageHeader title={t('聊天草稿交接验收','Conversation handoff acceptance')} description={t('合成资料 · 不发送消息 · 不调用 Agent','Synthetic data · No messages sent · No Agent calls')} />
    <Panel><h2>{t('准备资料与意图','Prepare sources and intent')}</h2><div className="handoff-actions">
      <Button disabled={busy} onClick={()=>void submit(async()=>{await host.documents.publish(publication());return 'Published original synthetic notes'})}>{t('发布原始资料','Publish original notes')}</Button>
      <Button disabled={busy} onClick={()=>void submit(select)}>{t('选择授权资料','Select document snapshot')}</Button>
      <Button disabled={busy} onClick={()=>void submit(()=>prepare(false))}>{t('保存无资料意图','Save text-only intent')}</Button>
      <Button disabled={busy} onClick={()=>void submit(()=>prepare(true))}>{t('保存带资料意图','Save intent with sources')}</Button>
    </div></Panel>
    <Panel><h2>{t('交接草稿','Hand off a draft')}</h2><div className="handoff-actions">
      <Button disabled={busy} onClick={()=>void submit(async()=>{const intent=await saved();return host.conversations.handoff(intent.input,intent.options)})}>{t('交接或原样重试','Hand off or replay unchanged')}</Button>
      <Button disabled={busy} onClick={()=>void submit(saved)}>{t('查看保存的意图','Show saved intent')}</Button>
      <Button disabled={busy} onClick={()=>void submit(async()=>{await host.documents.publish(publication(true));return 'Changed current source; retained offer must stay original'})}>{t('修改当前原文','Change current original')}</Button>
    </div><p>{t('完整意图在交接前保存。确认后由 Nooki 打开独立预览；采用和发送都需手动操作。','The complete intent is saved before handoff. Nooki opens a separate offer after approval; adoption and sending require explicit actions.')}</p></Panel>
    <Panel><h2>{t('拒绝路径对照','Refusal controls')}</h2><div className="handoff-actions">
      <Button disabled={busy} onClick={()=>void submit(async()=>{const intent=await saved();return host.conversations.handoff({...intent.input,text:'Changed intent'},intent.options)})}>{t('尝试同键改内容','Try changed input with same key')}</Button>
      <Button disabled={busy} onClick={()=>void submit(async()=>{const intent=await saved();return host.conversations.handoff(intent.input,{idempotencyKey:`${intent.options.idempotencyKey}-new`})})}>{t('尝试新键交接','Try handoff with new key')}</Button>
      <Button disabled={busy} onClick={()=>void submit(async()=>{const intent=await saved();const input={...intent.input,target:{kind:'conversation',id:'synthetic-unapproved-target'}};return host.conversations.handoff(input,intent.options)})}>{t('尝试指定未经审批的目标','Try unapproved target override')}</Button>
    </div><label>{t('另一包的完整意图 JSON（仅合成资料）','Complete intent JSON from another package (synthetic only)')}<textarea value={foreign} onChange={event=>setForeign(event.target.value)} /></label>
      <Button disabled={busy} onClick={()=>void submit(async()=>{const intent=JSON.parse(foreign) as Intent;return host.conversations.handoff(intent.input,{idempotencyKey:'foreign-source-check'})})}>{t('尝试另一包的来源授权','Try foreign source grant')}</Button>
    </Panel>
    <Panel><h2>{t('结果','Result')}</h2><pre aria-live="polite">{result}</pre></Panel>
  </CapabilityPage>
}
export default {manifest,Page} satisfies CapabilityModule
