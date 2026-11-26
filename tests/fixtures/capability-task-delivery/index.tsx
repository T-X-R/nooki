import { useState, useSyncExternalStore } from 'react'
import type { BoardAttachDeliveryInput, CapabilityManifest, CapabilityModule, CapabilityPageProps, DocumentPublication, DocumentReference, IdempotencyOptions } from './contract'
import { publicationReference } from './contract/references'
import { CapabilityPage, PageHeader, Panel, Button } from './ui'
import manifestJson from './manifest.json'
import './style.css'

const manifest = manifestJson as CapabilityManifest
type Intent = { input: BoardAttachDeliveryInput; options: IdempotencyOptions }
const publication = (changed = false): DocumentPublication => ({ key:'notes',collectionKey:'attachment-tests',collectionName:'Attachment tests',documentDate:'2026-11-26',title:`${manifest.name} notes`,content:changed ? '# Changed source\nCHANGED CURRENT DOCUMENT' : '# Original notes\nORIGINAL RETAINED DELIVERY\n\n- [x] Reviewed synthetic meeting\n- [ ] Follow up' })

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
  const saved = async() => { const intent=await host.storage.get<Intent>('attachment-intent');if(!intent)throw new Error('Select a task and save an intent first');return intent }
  const useOwn = async() => {const documents=[publicationReference(manifest.id,publication())];await host.storage.set('documents',documents);return documents}
  const selectDocuments = async() => {
    const selection=await host.library.requestSelection({purpose:'Retain explicitly selected synthetic notes as a task delivery.',kinds:['document'],limit:1})
    if(selection.status==='selected')await host.storage.set('documents',selection.grant.documents.map(doc=>doc.reference))
    return selection
  }
  const selectTask = async() => {
    const documents=await host.storage.get<DocumentReference[]>('documents');if(!documents?.length)throw new Error('Choose a document source first')
    const selection=await host.board.requestSelection({purpose:'Attach synthetic meeting notes to this task only. No execution or acceptance.',operations:['attachDelivery'],limit:1})
    if(selection.status==='dismissed')return selection
    const {id,revision}=selection.grant.items[0]
    const intent:Intent={input:{grantId:selection.grant.id,item:{id,revision},title:`Reviewed notes — ${manifest.id}`,documents},options:{idempotencyKey:crypto.randomUUID()}}
    await host.storage.set('attachment-intent',intent)
    return intent
  }
  return <CapabilityPage environment={environment} className="task-delivery-acceptance">
    <PageHeader title={t('任务成果附加验收','Task delivery acceptance')} description={t('公开 SDK · 合成资料 · 不调用 Agent','Public SDK · Synthetic data · No agent calls')} />
    <Panel><h2>{t('准备任务与资料','Prepare task and documents')}</h2><div className="delivery-actions">
      <Button disabled={busy} onClick={()=>void submit(async()=>{await host.documents.publish(publication());return 'Published original synthetic notes'})}>{t('发布原始资料','Publish original notes')}</Button>
      <Button disabled={busy} onClick={()=>void submit(()=>host.board.create({title:`Delivery review — ${manifest.id}`,description:'Synthetic acceptance task. Do not execute.'},{idempotencyKey:'synthetic-task'}))}>{t('创建测试待办','Create synthetic todo')}</Button>
      <Button disabled={busy} onClick={()=>void submit(useOwn)}>{t('使用本包发布的资料','Use own published notes')}</Button>
      <Button disabled={busy} onClick={()=>void submit(selectDocuments)}>{t('选择授权资料','Select document snapshot')}</Button>
    </div></Panel>
    <Panel><h2>{t('选择与附加','Select and attach')}</h2><div className="delivery-actions">
      <Button disabled={busy} onClick={()=>void submit(selectTask)}>{t('选择任务并保存意图','Select task and save intent')}</Button>
      <Button disabled={busy} onClick={()=>void submit(async()=>{const intent=await saved();return host.board.attachDelivery(intent.input,intent.options)})}>{t('附加或原样重试','Attach or replay unchanged')}</Button>
      <Button disabled={busy} onClick={()=>void submit(saved)}>{t('查看保存的意图','Show saved intent')}</Button>
      <Button disabled={busy} onClick={()=>void submit(async()=>{await host.documents.publish(publication(true));return 'Changed current source; retained text must stay original'})}>{t('修改当前原文','Change current original')}</Button>
    </div><p>{t('先保存完整意图，再提交。重启后原样重试，不重新选任务、不更换键。','The whole intent is saved before submission. After restart, replay unchanged without selecting again or replacing its key.')}</p></Panel>
    <Panel><h2>{t('拒绝路径对照','Refusal controls')}</h2><div className="delivery-actions">
      <Button disabled={busy} onClick={()=>void submit(async()=>{const intent=await saved();return host.board.attachDelivery({...intent.input,title:'Changed intent'},intent.options)})}>{t('尝试同键改内容','Try changed input with same key')}</Button>
      <Button disabled={busy} onClick={()=>void submit(async()=>{const intent=await saved();return host.board.attachDelivery(intent.input,{idempotencyKey:`${intent.options.idempotencyKey}-new`})})}>{t('尝试新键附加','Try attachment with new key')}</Button>
    </div><label>{t('另一包的完整意图 JSON（仅合成测试资料）','Complete intent JSON from another package (synthetic only)')}<textarea value={foreign} onChange={event=>setForeign(event.target.value)} /></label>
      <Button disabled={busy} onClick={()=>void submit(async()=>{const intent=JSON.parse(foreign) as Intent;return host.board.attachDelivery(intent.input,{idempotencyKey:'foreign-task-grant-check'})})}>{t('尝试另一包的任务授权','Try foreign task grant')}</Button>
      <Button disabled={busy} onClick={()=>void submit(async()=>{const own=await saved(),other=JSON.parse(foreign) as Intent;return host.board.attachDelivery({...own.input,documents:other.input.documents},{idempotencyKey:'foreign-document-check'})})}>{t('自己的任务授权配另一包来源','Own task grant with foreign source')}</Button>
    </Panel>
    <Panel><h2>{t('结果','Result')}</h2><pre aria-live="polite">{result}</pre></Panel>
  </CapabilityPage>
}
export default {manifest,Page} satisfies CapabilityModule
