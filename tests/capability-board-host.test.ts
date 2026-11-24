import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createBoardClient, invalidateBoardClients } from '../src/platform/capability-board-host.ts'

function fixture() {
  const calls: { command: string; args: unknown }[] = []
  let issued = 0
  const invoke = async (command: string, args: unknown): Promise<unknown> => {
    calls.push({ command, args })
    if (command === 'capability_board_begin') { issued++; return 'a'.repeat(64) }
    if (command === 'capability_board_create') return { id: 'b'.repeat(64), revision: 1 }
  }
  const config = { id: 'example.notes', version: '1.0.0', permission: true, desktop: true, assertActive() {}, invoke }
  return { calls, config, issued: () => issued }
}

test('board Host scopes identity to its controller and shares one invocation until disposal', async () => {
  const f = fixture(); const client = createBoardClient(f.config)
  const input = { title: 'Minutes' }; const options = { idempotencyKey: 'one' }
  const [a,b] = await Promise.all([client.board.create(input,options),client.board.create(input,options)])
  assert.deepEqual(a,b); assert.equal(f.issued(),1)
  assert.deepEqual(f.calls[0], { command: 'capability_board_begin', args: { request: { capabilityId: 'example.notes', version: '1.0.0' } } })
  assert.deepEqual(f.calls[1], { command: 'capability_board_create', args: { request: { handle: 'a'.repeat(64), key: 'one', input } } })
  await client.dispose(); await client.dispose()
  assert.equal(f.calls.filter(c => c.command === 'capability_board_release').length,1)
  await assert.rejects(client.board.create(input,options), { code: 'CANCELLED' })
})

test('preview, missing permission, invalid input and forged scope never obtain authority', async () => {
  for (const [override,code] of [[{ desktop:false },'UNSUPPORTED_SERVICE'],[{ permission:false },'PERMISSION_DENIED']] as const) {
    const f=fixture(); const client=createBoardClient({...f.config,...override})
    await assert.rejects(client.board.create({title:'X'},{idempotencyKey:'one'}), {code});assert.equal(f.calls.length,0)
  }
  const f=fixture();const client=createBoardClient(f.config)
  for (const input of [{title:''},{title:'X',capabilityId:'foreign'},{title:'X',description:'🎵'.repeat(20_000)}]) {
    await assert.rejects(client.board.create(input,{idempotencyKey:'one'}),{code:'INVALID_INPUT'})
  }
  await assert.rejects(client.board.create({title:'X'}, {idempotencyKey:'one',owner:'foreign'} as never),{code:'INVALID_INPUT'})
  assert.equal(f.calls.length,0)
})

test('disposal while issuance is pending releases the late handle without creating', async () => {
  const f=fixture();let finish!:(handle:string)=>void
  const invoke=async(command:string,args:unknown)=>command==='capability_board_begin'?new Promise<string>(r=>{finish=r}):f.config.invoke(command,args)
  const client=createBoardClient({...f.config,invoke})
  const request=client.board.create({title:'X'},{idempotencyKey:'one'})
  const denied=assert.rejects(request,{code:'CANCELLED'})
  const disposed=client.dispose(); finish('a'.repeat(64));await disposed;await denied
  assert.deepEqual(f.calls.map(c=>c.command),['capability_board_release'])
})

test('mutation errors preserve codes and unknown outcomes do not trigger hidden retries', async () => {
  for (const failure of [{code:'CONFLICT',message:'Key reused'},new Error('transport lost')]) {
    const f=fixture();const client=createBoardClient({...f.config,invoke:async(command,args)=>{
      if(command==='capability_board_create')throw failure
      return f.config.invoke(command,args)
    }})
    await assert.rejects(client.board.create({title:'X'},{idempotencyKey:'one'}),{code:'code' in failure?failure.code:'OUTCOME_UNKNOWN'})
    assert.equal(f.issued(),1);await client.dispose()
  }
})

test('a failed grant can be retried and pending input is captured before issuance', async () => {
  const f=fixture();let attempts=0;let finish!:(handle:string)=>void
  const client=createBoardClient({...f.config,invoke:async(command,args)=>{
    if(command==='capability_board_begin') {
      if(++attempts===1)throw {code:'RESOURCE_BUSY',message:'Try again'}
      return new Promise<string>(resolve=>{finish=resolve})
    }
    return f.config.invoke(command,args)
  }})
  const input={title:'Original'};const options={idempotencyKey:'original-key'}
  await assert.rejects(client.board.create(input,options),{code:'RESOURCE_BUSY'})
  const request=client.board.create(input,options)
  input.title='Changed';options.idempotencyKey='changed-key'
  assert.equal(attempts,2);finish('a'.repeat(64));await request
  assert.deepEqual(f.calls[0].args,{request:{handle:'a'.repeat(64),key:'original-key',input:{title:'Original'}}})
  await client.dispose()
})

test('failed release stays retryable without reopening the Host', async () => {
  const f=fixture();let releases=0
  const client=createBoardClient({...f.config,invoke:async(command,args)=>{
    if(command==='capability_board_release' && ++releases===1)throw {code:'RESOURCE_BUSY',message:'Busy'}
    return f.config.invoke(command,args)
  }})
  await client.board.create({title:'X'},{idempotencyKey:'one'})
  await assert.rejects(client.dispose(),{code:'RESOURCE_BUSY'})
  await assert.rejects(client.board.create({title:'X'},{idempotencyKey:'one'}),{code:'CANCELLED'})
  await client.dispose();assert.equal(releases,2)
})

test('lifecycle invalidation closes even a Host that has not requested authority yet', async () => {
  const f=fixture();const client=createBoardClient({...f.config,id:'example.lifecycle'})
  await invalidateBoardClients('example.lifecycle')
  await assert.rejects(client.board.create({title:'X'},{idempotencyKey:'one'}),{code:'CANCELLED'})
  assert.equal(f.calls.length,0)
})

test('selected sources are copied before issuance and forwarded intact without extra document reads', async () => {
  const f=fixture();let finish!:(handle:string)=>void
  const client=createBoardClient({...f.config,invoke:async(command,args)=>{
    if(command==='capability_board_begin')return new Promise<string>(resolve=>{finish=resolve})
    return f.config.invoke(command,args)
  }})
  const reference={kind:'library-document' as const,documentId:'example.notes/notes/2026/11/minutes',title:'Selected notes',grantId:'selected',revision:'original'}
  const input={title:'Review notes',sources:[reference]}
  const expected=structuredClone(input)
  const request=client.board.create(input,{idempotencyKey:'selected-intent'})
  void request.catch(()=>{}) // Keep the red reproduction observed if issuance never starts.
  reference.grantId='changed';input.sources.push({...reference,documentId:'another'})
  assert.equal(typeof finish,'function')
  finish('a'.repeat(64));await request
  assert.deepEqual(f.calls,[{command:'capability_board_create',args:{request:{handle:'a'.repeat(64),key:'selected-intent',input:expected}}}])
  await client.dispose()
})

test('native source refusal and exact replay keep the same input and stable Host error codes', async () => {
  const f=fixture();let denied=true
  const client=createBoardClient({...f.config,invoke:async(command,args)=>{
    const result=await f.config.invoke(command,args)
    if(command==='capability_board_create' && denied)throw {code:'PERMISSION_DENIED',message:'Selected source revoked'}
    return result
  }})
  const input={title:'Review',sources:[{kind:'library-document' as const,documentId:'example.notes/notes/2026/11/minutes',title:'Original',grantId:'selected',revision:'original'}]}
  const options={idempotencyKey:'intent'}
  await assert.rejects(client.board.create(input,options),{code:'PERMISSION_DENIED'})
  denied=false
  await client.board.create(input,options)
  const creates=f.calls.filter(call=>call.command==='capability_board_create')
  assert.equal(creates.length,2);assert.deepEqual(creates[0],creates[1])
  await client.dispose()
})
