import { useState, useSyncExternalStore } from 'react'
import type { CapabilityHost, CapabilityModule, CapabilityPageProps, CapabilityManifest } from './contract'
import manifestJson from './manifest.json'
import './style.css'
const manifest = manifestJson as CapabilityManifest
let lateResult = 'Not scheduled'
const input = { title: 'Public Host Board draft', description: 'Synthetic C01c2 acceptance; no agent execution.' }
const options = { idempotencyKey: 'c01c2-one' }
const failure = (e: unknown) => e && typeof e === 'object' && 'code' in e ? String(e.code) : String(e)
function Page({host}: CapabilityPageProps) {
  const [result,setResult]=useState('Ready')
  const tasks=useSyncExternalStore(host.tasks.subscribe,host.tasks.getSnapshot,host.tasks.getSnapshot)
  const submit=async(action:()=>Promise<unknown>)=>{try {setResult(JSON.stringify(await action()))}catch(e){setResult(failure(e))}}
  const late=()=>{const old:CapabilityHost=host;lateResult='Waiting 8 seconds';setResult(lateResult);setTimeout(async()=>{try{await old.board.create({title:'Must not create after leaving'},{idempotencyKey:'late-'+Date.now()});lateResult='UNEXPECTED SUCCESS'}catch(e){lateResult=failure(e)}},8000)}
  return <main className="wb-cap-page board-acceptance"><h1>Board Host Acceptance</h1><p>Public SDK only · Synthetic input</p>
    <button onClick={()=>submit(()=>host.board.create(input,options))}>Create / replay</button>
    <button onClick={()=>submit(()=>host.board.create({...input,title:'Conflicting title'},options))}>Conflict same key</button>
    <button onClick={()=>submit(()=>host.board.create({...input,...{capabilityId:'foreign'}},options))}>Forged owner</button>
    <button onClick={()=>submit(()=>host.tasks.start('createDraft',{}))}>Create from job</button>
    <button onClick={late}>Schedule stale call</button>
    <h2>Result</h2><pre>{result}</pre><h2>Late call</h2><pre>{lateResult}</pre><h2>Jobs</h2><pre>{JSON.stringify(tasks,null,2)}</pre>
  </main>
}
export default {manifest,Page,jobs:{createDraft:{run:async(_input,context)=>context.host.board.create({title:'Job-created draft'},{idempotencyKey:'c01c2-job'})}}} satisfies CapabilityModule
