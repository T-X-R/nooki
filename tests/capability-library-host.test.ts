import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLibraryClient, invalidateLibraryClients } from '../src/platform/capability-library-host.ts'
import { createLibraryPicker } from '../src/platform/library-picker.ts'

function fixture() {
  const calls: { command: string; args: any }[] = []
  const picker = createLibraryPicker()
  const grant = { id: 'a'.repeat(64), capabilityId: 'example.reader', capabilityVersion: '1.0.0', createdAt: 'now', documents: [] }
  const config = { id: 'example.reader', version: '1.0.0', name: 'Reader', permission: true, desktop: true, assertActive() {}, onDispose() {}, open: picker.open,
    invoke: async(command:string,args:any):Promise<any> => { calls.push({command,args}); if(command==='library_selection_begin')return {handle:grant.id,requestId:args.request.requestId,capabilityId:'example.reader',version:'1.0.0'};if(command==='library_selection_commit')return grant } }
  return { calls, picker, grant, config }
}
const input = { purpose: 'Draft actions', kinds: ['document'] as ('document')[], limit: 1 }
const tick = () => new Promise(resolve => setImmediate(resolve))

test('dismissal captures no content and caller fields never choose native authority', async () => {
  const f=fixture();const client=createLibraryClient(f.config)
  const pending=client.library.requestSelection(input);await tick()
  const shown=f.picker.getSnapshot()!;assert.equal(shown.name,'Reader');assert.equal(shown.purpose,'Draft actions')
  f.picker.dismiss(shown);assert.deepEqual(await pending,{status:'dismissed'})
  assert.deepEqual(f.calls.map(c=>c.command),['library_selection_begin','library_selection_cancel'])
  await assert.rejects(client.library.requestSelection({...input,capabilityId:'forged'} as never),{code:'INVALID_INPUT'})
  await client.dispose()
})
test('selection confirms only chosen IDs, returns grant metadata and releases its approval session', async () => {
  const f=fixture();const client=createLibraryClient(f.config);const mutable={...input}
  const pending=client.library.requestSelection(mutable);mutable.purpose='Changed later';await tick()
  const shown=f.picker.getSnapshot()!;assert.equal(shown.purpose,'Draft actions')
  const grant=await shown.confirm(['one']);f.picker.complete(shown,{status:'selected',grant})
  assert.deepEqual(await pending,{status:'selected',grant:f.grant})
  assert.deepEqual(f.calls.find(c=>c.command==='library_selection_commit')!.args,{request:{handle:f.grant.id,ids:['one']}})
  await client.dispose()
})
test('disposal closes an open picker and lifecycle invalidation closes an unused Host', async () => {
  const f=fixture();const client=createLibraryClient(f.config)
  const pending=client.library.requestSelection(input);const denied=assert.rejects(pending,{code:'CANCELLED'});await tick()
  await client.dispose();await denied;assert.equal(f.picker.getSnapshot(),null)
  assert.equal(f.calls.some(c=>c.command==='library_selection_commit'),false)
  const other=createLibraryClient({...f.config,id:'example.lifecycle'});await invalidateLibraryClients('example.lifecycle')
  await assert.rejects(other.library.requestSelection(input),{code:'CANCELLED'})
})
test('unsupported requests and denied permissions never open a picker or issue approval', async () => {
  for(const [override,request,code] of [[{desktop:false},input,'UNSUPPORTED_SERVICE'],[{permission:false},input,'PERMISSION_DENIED'],[{}, {...input,kinds:['artifact']},'UNSUPPORTED_SERVICE'],[{}, {...input,mediaTypes:['image/png']},'UNSUPPORTED_SERVICE'],[{}, {...input,limit:0},'INVALID_INPUT']] as const) {
    const f=fixture();const client=createLibraryClient({...f.config,...override});await assert.rejects(client.library.requestSelection(request as never),{code});assert.equal(f.calls.length,0);await client.dispose()
  }
})
test('a second picker is refused and failed confirmation preserves the same selection session for explicit retry', async () => {
  const f=fixture();let attempts=0
  const client=createLibraryClient({...f.config,invoke:async(command,args)=>{if(command==='library_selection_commit'&&++attempts===1)throw {code:'OUTCOME_UNKNOWN',message:'Retry same selection'};return f.config.invoke(command,args)}})
  const pending=client.library.requestSelection(input);await tick();const shown=f.picker.getSnapshot()!
  await assert.rejects(client.library.requestSelection(input),{code:'RESOURCE_BUSY'})
  await assert.rejects(shown.confirm(['one']),{code:'OUTCOME_UNKNOWN'});assert.equal(f.picker.getSnapshot(),shown)
  const grant=await shown.confirm(['one']);f.picker.complete(shown,{status:'selected',grant});await pending;assert.equal(attempts,2);await client.dispose()
})
test('disposal while cleanup is pending cannot deliver a selected result', async () => {
  const f=fixture();let release!:()=>void
  const client=createLibraryClient({...f.config,invoke:async(command,args)=>command==='library_selection_cancel'?new Promise(resolve=>{release=()=>resolve(undefined)}):f.config.invoke(command,args)})
  const pending=client.library.requestSelection(input);const denied=assert.rejects(pending,{code:'CANCELLED'});await tick()
  const shown=f.picker.getSnapshot()!;f.picker.complete(shown,{status:'selected',grant:f.grant});await tick()
  // Capture each concurrent idempotent release and let both settle after the Host closes.
  const first=release;const disposed=client.dispose();const second=release;first();second();await disposed;await denied
})
test('lost issuance replies still release the host-owned request correlation', async () => {
  const f=fixture();const client=createLibraryClient({...f.config,invoke:async(command,args)=>{f.calls.push({command,args});if(command==='library_selection_begin')throw new Error('reply lost')}})
  await assert.rejects(client.library.requestSelection(input),{code:'RESOURCE_UNAVAILABLE'})
  const issued=f.calls.find(c=>c.command==='library_selection_begin')!.args.request
  assert.equal(typeof issued.requestId,'string')
  assert.deepEqual(f.calls.find(c=>c.command==='library_selection_cancel')!.args,{request:{requestId:issued.requestId}})
  await client.dispose()
})

test('a competing Host cannot replace the open picker and a cancelled issuance cannot reopen it', async () => {
  const f=fixture(); const first=createLibraryClient(f.config)
  const pending=first.library.requestSelection(input); await tick(); const shown=f.picker.getSnapshot()!
  const second=createLibraryClient({...f.config,id:'example.peer',invoke:async(command,args)=>{
    if(command==='library_selection_begin')return {handle:'b'.repeat(64),requestId:(args.request as any).requestId,capabilityId:'example.peer',version:'1.0.0'}
  }})
  await assert.rejects(second.library.requestSelection(input),{code:'RESOURCE_BUSY'})
  assert.equal(f.picker.getSnapshot(),shown)
  f.picker.dismiss(shown); assert.deepEqual(await pending,{status:'dismissed'}); await first.dispose(); await second.dispose()
  let resolve!: (value:unknown)=>void
  const delayed=createLibraryClient({...f.config,invoke:async(command,args)=>{
    if(command==='library_selection_begin')return new Promise(done=>{resolve=()=>done({handle:'c'.repeat(64),requestId:(args.request as any).requestId,capabilityId:f.config.id,version:f.config.version})})
    return f.config.invoke(command,args)
  }})
  const late=delayed.library.requestSelection(input);const denied=assert.rejects(late,{code:'CANCELLED'});await tick()
  await delayed.dispose();resolve(undefined);await denied;assert.equal(f.picker.getSnapshot(),null)
})
