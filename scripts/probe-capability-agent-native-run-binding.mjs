// Local response fixture only: Codex owns model transport; this server performs no inference.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { createProfile, launchOptions } from './desktop-profile.mjs'

assert(process.argv[2] && process.platform === 'darwin', 'Usage on macOS: node scripts/probe-capability-agent-native-run-binding.mjs <standalone-app-server>')
const binary = await realpath(resolve(process.argv[2]))
const root = await createProfile(), options = await launchOptions(root)
const cwd = join(root, 'input'), home = join(root, 'home/.codex')
await mkdir(cwd); await mkdir(home)
const version = (await promisify(execFile)(binary, ['--version'], { ...options, timeout: 10000 })).stdout.trim()
assert.equal(version, 'codex-app-server 0.170.0')
const hash = createHash('sha256')
for await (const chunk of createReadStream(binary)) hash.update(chunk)
const binarySha256 = hash.digest('hex')
const legacyLaunch=process.argv.includes('--legacy-launch')
const inputCase=process.argv.find(arg=>arg.startsWith('--input-case='))?.split('=')[1]
const hostFixture=process.env.NOOKI_NATIVE_INPUT_FIXTURE ? JSON.parse(await readFile(process.env.NOOKI_NATIVE_INPUT_FIXTURE,'utf8')) : null
const inputJson=hostFixture?.inputJson ?? JSON.stringify(['nooki-agent-input-v1','nooki-native-model-probe: approved-native-turn',[],null,'codex'])
const approvedMaterial=JSON.parse(inputJson), outputSchema=approvedMaterial[3]
const approvedInput=[{type:'text',text:inputJson,text_elements:[]}]
const requests = [], fixtureErrors = [], notifications = [], results = [], mismatches = []
const responseText = outputSchema ? JSON.stringify({summary:'NOOKI_SYNTHETIC_MODEL_RESPONSE'}) : 'NOOKI_SYNTHETIC_MODEL_RESPONSE'
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/responses')
    assert(!request.headers.authorization, 'Fixture requests must not include credentials')
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    assert.equal(body.model, 'mock-model')
    const syntheticInputPresent=JSON.stringify(body.input).includes('nooki-native-model-probe')
    assert(syntheticInputPresent || inputCase==='omitted','Unexpected fixture input')
    requests.push({ method: request.method, path: request.url, model: body.model, syntheticInputPresent, approvedInputPresent: JSON.stringify(body.input).includes(JSON.stringify(inputJson)), outputSchema:body.text?.format?.schema??null })
    const id = `synthetic-${requests.length}`
    const events = [
      { type: 'response.created', response: { id } },
      { type: 'response.output_item.done', item: { id: `message-${requests.length}`, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: responseText }] } },
      { type: 'response.completed', response: { id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ]
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
  } catch (error) {
    fixtureErrors.push(error.message)
    response.writeHead(500); response.end('Synthetic fixture rejected request')
  }
})
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const provider = `model = "mock-model"
model_provider = "nooki_fixture"
approval_policy = "never"
sandbox_mode = "read-only"
[model_providers.nooki_fixture]
name = "Nooki synthetic local fixture"
base_url = "http://127.0.0.1:${server.address().port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
[features]
hooks = false
apps = false
plugins = false
mcp_lazy_stdio_startup = false
`
await writeFile(join(home, 'config.toml'), provider)
let child, lines, sequence = 0, stderr = '', passed = false, syntheticModelTurns = 0, generation = 0
const pending = new Map()
const rejectPending = error => {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
  pending.clear()
}
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 15000)
  pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
})
const binding = hostFixture?.binding ?? {
  runId: '1'.repeat(64), approvalId: '2'.repeat(64), clientMessageId: '3'.repeat(64),
  inputDigest: createHash('sha256').update(inputJson).digest('hex'), policyDigest: '5'.repeat(64),
  component: {protocolRevision: 1, sha256: binarySha256},
  scope: {installation: {capability_id: 'example.binding', capability_version: '1.0.0', generation: '6'.repeat(64)}, restoreId: null},
}
assert.equal(binding.component.sha256,binarySha256,'Host fixture must approve this exact component')
// Previous prototype used camelCase installation keys; adapt only its historical launch shape.
const wireBinding=value=>!legacyLaunch||!value?value:{...value,scope:{...value.scope,installation:{
  capabilityId:value.scope.installation.capability_id,capabilityVersion:value.scope.installation.capability_version,
  generation:value.scope.installation.generation}}}
let recovery=false
async function launch(launchBinding = binding, launchHome = home, launchInputJson = inputJson) {
  const launchedAt = Date.now()
  generation += 1
  const bindingPath = join(root, 'launch-binding.json')
  let file
  if (launchBinding) { await writeFile(bindingPath, JSON.stringify({binding:wireBinding(launchBinding),recovery,...(legacyLaunch?{}:{inputJson:launchInputJson})}), {mode:0o600}); file=await open(bindingPath,'r') }
  stderr = ''
  child = spawn(binary, ['--strict-config'], { ...options, cwd,
    env:{...options.env, CODEX_HOME:launchHome, ...(file ? {NOOKI_RUN_BINDING_FD:'3'} : {})},
    stdio: ['pipe', 'pipe', 'pipe', ...(file ? [file.fd] : [])] })
  await file?.close()
  lines = createInterface({ input: child.stdout })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', rejectPending)
  child.on('exit', (code, signal) => rejectPending(new Error(`App-server exited: ${code}/${signal}: ${stderr.slice(-1500)}`)))
  lines.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch (error) { rejectPending(error); return }
    if (message.method && !Object.hasOwn(message, 'id')) notifications.push(message)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id); clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  await rpc('initialize', { clientInfo: { name: 'nooki-native-binding-probe', version: '1' }, capabilities: { experimentalApi: true } })
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
  const helperDirectories=await readdir(join(launchHome,'tmp/arg0-macos')).catch(()=>[])
  results.push({name:'native-initialized',generation,elapsedMs:Date.now()-launchedAt,recovery,helperDirectories})
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
  lines?.close(); rejectPending(new Error('Probe generation stopped'))
}
async function start() {
  const result = await rpc('thread/start', { cwd, ephemeral: false, approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: [], selectedCapabilityRoots: [], config: { features: { apps: false, plugins: false, hooks: false, mcp_lazy_stdio_startup: false } } })
  assert.equal(result.modelProvider, 'nooki_fixture'); assert.equal(result.model, 'mock-model')
  assert.equal(result.sandbox.type, 'readOnly'); assert.equal(result.approvalPolicy, 'never')
  return result
}
async function completeTurn(threadId, label) {
  const before = requests.length
  const { turn } = await rpc('turn/start', { threadId, clientUserMessageId: binding.clientMessageId, input: approvedInput, outputSchema })
  const deadline = Date.now() + 15000
  let completion
  while (Date.now() < deadline) {
    completion = notifications.find(message => message.method === 'turn/completed' && message.params.threadId === threadId && message.params.turn.id === turn.id)
    if (completion) break
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert(completion, 'Native turn completion was not received')
  assert.equal(completion.params.turn.status, 'completed', JSON.stringify(completion.params.turn.error))
  const item = notifications.find(message => message.method === 'item/completed' && message.params.threadId === threadId && message.params.turnId === turn.id && message.params.item.type === 'agentMessage')
  assert.equal(item?.params.item.text, responseText)
  assert.equal(requests.length, before + 1)
  assert.deepEqual(fixtureErrors, [])
  syntheticModelTurns += 1
  results.push({ name: label, generation, threadId, turnId: turn.id, completed: true, localResponseRequests: requests.length - before })
}
async function deniedLaunch(name, value) {
  let refusal=null
  try {await launch(value)} catch(error){refusal=error.message}
  await stop()
  const ok=!!refusal?.includes('NOOKI_NATIVE_BINDING')
  results.push({name,refusal,passed:ok})
  if(!ok)mismatches.push({name,expected:'native binding startup refusal',actual:refusal??'initialized'})
}
async function competingOwner() {
  const path=join(root,'competing-launch.json')
  await writeFile(path,JSON.stringify({binding:wireBinding(binding),recovery:true,...(legacyLaunch?{}:{inputJson})}),{mode:0o600})
  const file=await open(path,'r')
  const peer=spawn(binary,['--strict-config'],{...options,cwd,
    env:{...options.env,NOOKI_RUN_BINDING_FD:'3'},stdio:['pipe','pipe','pipe',file.fd]})
  await file.close()
  let errorText='',initialized=false
  peer.stderr.on('data',chunk=>{errorText+=chunk})
  peer.stdout.on('data',chunk=>{if(String(chunk).includes('"result"'))initialized=true})
  peer.stdin.on('error',()=>{})
  peer.stdin.end(JSON.stringify({id:1,method:'initialize',params:{clientInfo:{name:'competing-owner',version:'1'}}})+'\n')
  const timer=setTimeout(()=>peer.kill('SIGTERM'),15000)
  try {await once(peer,'exit')} finally {clearTimeout(timer)}
  const ok=errorText.includes('NOOKI_NATIVE_BINDING_OWNER_BUSY')&&!initialized
  results.push({name:'competing-native-owner',passed:ok,initialized,refusal:errorText.slice(-1200)})
  if(!ok)mismatches.push({name:'competing-native-owner',expected:'exclusive native owner refusal',actual:initialized?'initialized':errorText})
}
async function deniedRequest(name, method, params, accepted) {
  let refusal=null, value=null
  const before=requests.length
  try {value=await rpc(method,params)} catch(error){refusal=error.message}
  const ok=!!refusal?.includes('NOOKI_NATIVE_BINDING')
  if(value&&accepted)await accepted(value)
  results.push({name,refusal,passed:ok,modelRequests:requests.length-before,acceptedSandbox:value?.sandbox})
  if(!ok)mismatches.push({name,expected:'native binding refusal',actual:refusal??'accepted'})
  if(ok)assert.equal(requests.length,before)
}
async function bindingScenario() {
  await deniedLaunch('missing-launch-binding', null)
  await deniedLaunch('wrong-component', {...binding,component:{...binding.component,sha256:'0'.repeat(64)}})
  await launch()
  const originalHelpers=results.at(-1).helperDirectories
  const original=await start(), threadId=original.thread.id
  results.push({name:'original-thread-created',threadId,rolloutPath:original.thread.path})
  recovery=true
  await competingOwner()
  await deniedRequest('second-thread', 'thread/start', {cwd,ephemeral:false,approvalPolicy:'never',sandbox:'read-only'})
  await deniedRequest('foreign-thread-read', 'thread/read', {threadId:'00000000-0000-0000-0000-000000000001',includeTurns:true})
  await deniedRequest('missing-client-message', 'turn/start', {threadId,input:[{type:'text',text:'nooki-native-model-probe: unbound',text_elements:[]}]}, async value=>{
    const deadline=Date.now()+15000
    while(!notifications.some(m=>m.method==='turn/completed'&&m.params.turn.id===value.turn.id)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25))
    assert(notifications.some(m=>m.method==='turn/completed'&&m.params.turn.id===value.turn.id&&m.params.turn.status==='completed'));syntheticModelTurns+=1
  })
  await completeTurn(threadId,'approved-native-turn')
  await deniedRequest('fork', 'thread/fork', {threadId,cwd,ephemeral:false,approvalPolicy:'never',sandbox:'read-only'})
  await deniedRequest('explicit-rollout-import', 'thread/resume', {threadId,path:original.thread.path,cwd,approvalPolicy:'never',sandbox:'read-only'})
  await deniedRequest('duplicate-submission', 'turn/start', {threadId,clientUserMessageId:binding.clientMessageId,input:approvedInput,outputSchema}, async value=>{
    const deadline=Date.now()+15000
    while(!notifications.some(m=>m.method==='turn/completed'&&m.params.turn.id===value.turn.id)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25))
    assert(notifications.some(m=>m.method==='turn/completed'&&m.params.turn.id===value.turn.id&&m.params.turn.status==='completed'));syntheticModelTurns+=1
  })
  await stop()
  recovery=false
  await deniedLaunch('fresh-launch-existing-provenance',binding)
  recovery=true
  const provenancePath=join(home,'.nooki-run-provenance.json')
  const savedProvenance=await readFile(provenancePath).catch(error=>{if(error.code==='ENOENT')return null;throw error})
  if(savedProvenance){
    await rename(provenancePath,provenancePath+'.saved')
    try {
      await deniedLaunch('recovery-missing-provenance',binding)
      await writeFile(provenancePath,'{corrupt')
      await deniedLaunch('recovery-corrupt-provenance',binding)
    } finally {await rename(provenancePath+'.saved',provenancePath)}
  } else {
    mismatches.push({name:'native-provenance-persisted',expected:'native receipt',actual:'missing'})
  }
  for(const [name, change] of [
    ['foreign-run',{runId:'a'.repeat(64)}],['changed-approval',{approvalId:'a'.repeat(64)}],
    ['changed-input',{inputDigest:'a'.repeat(64)}],['changed-policy',{policyDigest:'a'.repeat(64)}],
    ['changed-client-message',{clientMessageId:'a'.repeat(64)}],
    ['restored-scope',{scope:{...binding.scope,restoreId:'synthetic-restore'}}],
    ['changed-installation',{scope:{...binding.scope,installation:{...binding.scope.installation,generation:'f'.repeat(64)}}}],
  ]){
    assert.notDeepEqual({...binding,...change},binding,'Binding mutation fixture must actually differ: '+name)
    await deniedLaunch(name,{...binding,...change})
  }
  await launch()
  const resumedHelpers=results.at(-1).helperDirectories
  assert(originalHelpers.length>0 && resumedHelpers.length>0)
  assert(resumedHelpers.every(path=>!originalHelpers.includes(path)),'Native helper directory did not change across process restart')
  results.push({name:'native-helper-directory-changed',passed:true,originalHelpers,resumedHelpers})
  const resumeParams={threadId,cwd,approvalPolicy:'never',sandbox:'read-only'}
  await deniedRequest('cold-history-import','thread/resume',{...resumeParams,history:[{type:'message',role:'user',content:[{type:'input_text',text:'nooki-native-model-probe: imported history'}]}]})
  await deniedRequest('changed-cold-scope','thread/resume',{...resumeParams,sandbox:'workspace-write'})
  const resumed=await rpc('thread/resume',resumeParams)
  assert.equal(resumed.thread.id,threadId)
  assert.equal(resumed.thread.path,original.thread.path)
  const history=await rpc('thread/read',{threadId,includeTurns:true})
  assert(JSON.stringify(history).includes(JSON.stringify(inputJson).slice(1,-1)))
  results.push({name:'same-run-cold-resume',threadId,passed:true,retainedInput:true})
  await deniedRequest('cold-duplicate-submission','turn/start',{threadId,clientUserMessageId:binding.clientMessageId,input:approvedInput,outputSchema}, async value=>{
    const deadline=Date.now()+15000
    while(!notifications.some(m=>m.method==='turn/completed'&&m.params.turn.id===value.turn.id)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25))
    assert(notifications.some(m=>m.method==='turn/completed'&&m.params.turn.id===value.turn.id&&m.params.turn.status==='completed'));syntheticModelTurns+=1
  })
  await stop()
  const birthHome=join(root,'birth-home')
  await mkdir(birthHome);await writeFile(join(birthHome,'config.toml'),provider)
  recovery=false
  await launch(binding,birthHome)
  const newborn=await start()
  await stop();recovery=true
  await launch(binding,birthHome)
  let recoveredBirth
  try {recoveredBirth=await rpc('thread/resume',{...resumeParams,threadId:newborn.thread.id})}
  catch(error){
    mismatches.push({name:'created-thread-cold-resume-before-first-turn',expected:'same native thread',actual:error.message})
    results.push({name:'created-thread-cold-resume-before-first-turn',passed:false,refusal:error.message})
  }
  if(recoveredBirth){
    assert.equal(recoveredBirth.thread.id,newborn.thread.id)
    assert.equal(recoveredBirth.thread.path,newborn.thread.path)
    results.push({name:'created-thread-cold-resume-before-first-turn',threadId:newborn.thread.id,passed:true})
    await completeTurn(newborn.thread.id,'recovered-first-turn')
  }
  await stop()
  assert.deepEqual(fixtureErrors,[])
  passed=mismatches.length===0
}
async function inputScenario() {
  if(inputCase==='launch-bytes'){
    let refusal=null
    try {await launch(binding,home,inputJson+' ')} catch(error){refusal=error.message}
    passed=!!refusal?.includes('NOOKI_NATIVE_BINDING_INPUT_MISMATCH')
    results.push({name:'input-launch-bytes',passed,refusal})
    if(!passed)mismatches.push({name:'input-launch-bytes',expected:'exact approved byte hash refusal',actual:refusal??'initialized'})
    return
  }
  await launch()
  const {thread}=await start()
  const base={threadId:thread.id,clientUserMessageId:binding.clientMessageId,input:approvedInput,outputSchema}
  const cases={
    text:{...base,input:[{type:'text',text:inputJson+' changed',text_elements:[]}]},
    source:{...base,input:[{type:'text',text:inputJson.replace('Retained body','Changed body'),text_elements:[]}]},
    omitted:{...base,input:[]},
    extra:{...base,input:[...approvedInput,{type:'text',text:'nooki-native-model-probe: extra instructions',text_elements:[]}]},
    schema:{...base,outputSchema:{type:'object',properties:{different:{type:'string'}}}},
    model:{...base,model:'mock-model'},
    context:{...base,additionalContext:{synthetic:{value:'nooki-native-model-probe: unapproved context',kind:'untrusted'}}},
  }
  if(inputCase==='oversize') {
    assert(inputJson.length>1_048_576,'Oversize case requires an actual large Host fixture')
    let refusal=null
    try {await rpc('turn/start',base)} catch(error){refusal=error.message}
    passed=!!refusal?.includes('NOOKI_NATIVE_BINDING_INPUT_TOO_LARGE')
    const provenance=JSON.parse(await readFile(join(home,'.nooki-run-provenance.json'),'utf8'))
    assert.equal(provenance.turnClaimed,false,'Unsupported input must not consume a submission')
    assert.equal(requests.length,0)
    results.push({name:'input-oversize',passed,refusal,submissionUnclaimed:true})
    if(!passed)mismatches.push({name:'input-oversize',expected:'bounded preclaim refusal',actual:refusal??'accepted'})
    return
  }
  if(inputCase==='valid') {
    await completeTurn(thread.id,'host-approved-input')
    assert.equal(requests.at(-1).approvedInputPresent,true)
    assert.deepEqual(requests.at(-1).outputSchema,outputSchema)
  } else {
    assert(cases[inputCase],'Unknown input case')
    assert.notDeepEqual(cases[inputCase],base,'Mutation fixture must actually differ')
    const before=requests.length
    let refusal=null,accepted=null
    try {accepted=await rpc('turn/start',cases[inputCase])} catch(error){refusal=error.message}
    const expected=['model','context'].includes(inputCase)?'TURN_OVERRIDE_DENIED':'INPUT_MISMATCH'
    const ok=!!refusal?.includes('NOOKI_NATIVE_BINDING_'+expected)
    if(accepted){
      const deadline=Date.now()+15000
      while(!notifications.some(m=>m.method==='turn/completed'&&m.params.turn.id===accepted.turn.id)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25))
      assert(notifications.some(m=>m.method==='turn/completed'&&m.params.turn.id===accepted.turn.id&&m.params.turn.status==='completed'))
      syntheticModelTurns+=1
    }
    results.push({name:'input-'+inputCase,passed:ok,refusal,modelRequests:requests.length-before})
    if(!ok)mismatches.push({name:'input-'+inputCase,expected,actual:refusal??'accepted'})
    if(ok){
      assert.equal(requests.length,before)
      await completeTurn(thread.id,'approved-input-after-refusal')
      assert.equal(requests.at(-1).approvedInputPresent,true)
      assert.deepEqual(requests.at(-1).outputSchema,outputSchema)
    }
  }
  passed=mismatches.length===0
}
try {
  if(inputCase)await inputScenario();else await bindingScenario()
} catch(error) {
  fixtureErrors.push(error.stack??String(error))
} finally {
  await stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
  const receipt={inputCase:inputCase??null,legacyLaunch,hostFixture:!!hostFixture,passed:passed&&fixtureErrors.length===0,root,binary,version,binarySha256,results,mismatches,requests,fixtureErrors,syntheticModelTurns,realModelCalls:0}
  const path=join(root,'native-binding-probe.json');await writeFile(path,JSON.stringify(receipt,null,2)+'\n')
  console.log(JSON.stringify(receipt,null,2));console.log('Receipt: '+path)
  if(!receipt.passed)process.exitCode=1
}
