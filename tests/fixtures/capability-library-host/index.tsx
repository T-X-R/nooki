import { useState, useSyncExternalStore } from 'react'
import type { CapabilityHost, CapabilityManifest, CapabilityModule, CapabilityPageProps, DocumentGrant } from './contract'
import { CapabilityPage, PageHeader, Panel, Button } from './ui'
import manifestJson from './manifest.json'
import './style.css'
const manifest = manifestJson as CapabilityManifest
const purpose = 'Draft meeting actions from explicitly selected synthetic notes.'
let lateResult = 'Not scheduled'
const failure = (e: unknown) => e && typeof e === 'object' && 'code' in e ? String(e.code) : String(e)
async function select(host: Pick<CapabilityHost, 'library' | 'storage'>) {
  const result = await host.library.requestSelection({ purpose, kinds: ['document'], limit: 1 })
  if (result.status === 'selected') await host.storage.set('selection', result.grant)
  return result
}
function Page({ host }: CapabilityPageProps) {
  const environment = useSyncExternalStore(host.environment.subscribe, host.environment.getSnapshot)
  const tasks = useSyncExternalStore(host.tasks.subscribe, host.tasks.getSnapshot, host.tasks.getSnapshot)
  const [result,setResult] = useState('Ready')
  const [foreign,setForeign] = useState('')
  const t = (zh:string,en:string) => environment.language === 'zh' ? zh : en
  const submit = async(action:()=>Promise<unknown>) => { setResult('Pending'); try { setResult(JSON.stringify(await action(),null,2)) } catch(e) { setResult(failure(e)) } }
  const stored = async() => { const grant=await host.storage.get<DocumentGrant>('selection'); if(!grant)throw new Error('No selected grant');return grant }
  const read = async(grant:DocumentGrant) => host.documents.readSelected(grant.id,grant.documents[0].reference.documentId)
  const seed = async() => { for(const key of ['alpha','beta']) await host.documents.publish({key,title:`Selection ${key}`,content:`# ${key}\nSynthetic ${key} source only.`,collectionKey:'selection-tests',collectionName:'Selection tests',documentDate:'2026-11-20'});return 'Published two synthetic documents' }
  const late = () => { const old=host; lateResult='Waiting 8 seconds'; setResult(lateResult);setTimeout(async()=>{try {await old.library.requestSelection({purpose,kinds:['document']});lateResult='UNEXPECTED SUCCESS'}catch(e){lateResult=failure(e)}},8000) }
  return <CapabilityPage environment={environment} className="library-acceptance">
    <PageHeader title={t('资料 Host 验证','Library Host Acceptance')} description={t('公开 SDK · 合成资料','Public SDK · Synthetic input')} />
    <Panel><div className="library-acceptance-actions">
      <Button onClick={()=>void submit(seed)}>{t('创建测试资料','Publish test documents')}</Button>
      <Button onClick={()=>void submit(()=>select(host))}>{t('请求选择资料','Request selection')}</Button>
      <Button onClick={()=>void submit(async()=>read(await stored()))}>{t('读取所选快照','Read selected snapshot')}</Button>
      <Button onClick={()=>void submit(()=>host.documents.listGrants())}>{t('查看本包授权','List own grants')}</Button>
      <Button onClick={()=>void submit(async()=>{host.documents.open((await stored()).documents[0].reference);return 'Opened retained citation'})}>{t('打开保留引用','Open retained citation')}</Button>
      <Button onClick={()=>void submit(()=>host.library.requestSelection({purpose,kinds:['artifact']}))}>{t('不支持的文件类型','Unsupported artifact')}</Button>
      <Button onClick={()=>void submit(()=>host.library.requestSelection({purpose,kinds:['document'],...{capabilityId:'foreign'}}))}>{t('伪造接收者','Forged recipient')}</Button>
      <Button onClick={()=>void submit(()=>host.tasks.start('select',{}))}>{t('从任务请求选择','Select from job')}</Button>
      <Button onClick={late}>{t('延迟调用旧 Host','Schedule stale selection')}</Button>
    </div><label>{t('另一包的授权元数据','Other package grant metadata')}<textarea value={foreign} onChange={e=>setForeign(e.target.value)} /></label>
      <Button onClick={()=>void submit(()=>read(JSON.parse(foreign) as DocumentGrant))}>{t('尝试读取另一包授权','Read foreign grant')}</Button>
    </Panel>
    <Panel><h2>{t('结果','Result')}</h2><pre>{result}</pre><h2>{t('旧 Host 结果','Stale Host result')}</h2><pre>{lateResult}</pre><h2>{t('任务','Jobs')}</h2><pre>{JSON.stringify(tasks,null,2)}</pre></Panel>
  </CapabilityPage>
}
export default { manifest, Page, jobs:{ select:{run:async(_input,context)=>select(context.host)} } } satisfies CapabilityModule
