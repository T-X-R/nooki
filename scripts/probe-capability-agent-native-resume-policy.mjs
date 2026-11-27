// Local response fixture only: Codex owns model transport; this server performs no inference.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { createProfile, launchOptions } from './desktop-profile.mjs'

assert(process.argv[2] && process.platform === 'darwin', 'Usage on macOS: node scripts/probe-capability-agent-native-resume-policy.mjs <standalone-app-server>')
const binary = await realpath(resolve(process.argv[2]))
const root = await createProfile(), options = await launchOptions(root)
const cwd = join(root, 'input'), home = join(root, 'home/.codex')
await mkdir(cwd); await mkdir(home)
const version = (await promisify(execFile)(binary, ['--version'], { ...options, timeout: 10000 })).stdout.trim()
assert.equal(version, 'codex-app-server 0.170.0')
const hash = createHash('sha256')
for await (const chunk of createReadStream(binary)) hash.update(chunk)
const binarySha256 = hash.digest('hex')
const requests = [], fixtureErrors = [], notifications = [], results = []
const responseText = 'NOOKI_SYNTHETIC_MODEL_RESPONSE'
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/responses')
    assert(!request.headers.authorization, 'Fixture requests must not include credentials')
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    assert.equal(body.model, 'mock-model')
    assert(JSON.stringify(body.input).includes('nooki-native-model-probe'))
    requests.push({ method: request.method, path: request.url, model: body.model, syntheticInputPresent: true })
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
const marker = join(root, 'canary.started'), canary = join(root, 'canary.py')
await writeFile(canary, `import pathlib, json, sys
with pathlib.Path(${JSON.stringify(marker)}).open('a') as stream: stream.write('started\\n')
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m: continue
 r={'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'canary','version':'1'}} if m['method']=='initialize' else {'tools':[]}
 print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':r}),flush=True)
`)
const mcp = enabled => `\n[mcp_servers.canary]\ncommand="/usr/bin/python3"\nargs=[${JSON.stringify(canary)}]\nenabled=${enabled}\nstartup_timeout_sec=3\n`
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
async function launch() {
  generation += 1
  child = spawn(binary, ['--strict-config'], { ...options, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  lines = createInterface({ input: child.stdout })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', rejectPending)
  child.on('exit', (code, signal) => rejectPending(new Error(`App-server exited: ${code}/${signal}`)))
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
  await rpc('initialize', { clientInfo: { name: 'nooki-native-resume-probe', version: '1' }, capabilities: { experimentalApi: true } })
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
  lines?.close(); rejectPending(new Error('Probe generation stopped'))
}
const canaryCount = async () => (await readFile(marker, 'utf8').catch(() => '')).split('\n').filter(Boolean).length
async function start() {
  const result = await rpc('thread/start', { cwd, ephemeral: false, approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: [], selectedCapabilityRoots: [], config: { features: { apps: false, plugins: false, hooks: false, mcp_lazy_stdio_startup: false } } })
  assert.equal(result.modelProvider, 'nooki_fixture'); assert.equal(result.model, 'mock-model')
  assert.equal(result.sandbox.type, 'readOnly'); assert.equal(result.approvalPolicy, 'never')
  return result
}
async function completeTurn(threadId, label) {
  const before = requests.length
  const { turn } = await rpc('turn/start', { threadId, input: [{ type: 'text', text: `nooki-native-model-probe: ${label}`, text_elements: [] }] })
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
try {
  await launch()
  const initial = await start()
  const threadId = initial.thread.id, rolloutPath = initial.thread.path
  assert.equal(typeof rolloutPath, 'string')
  assert(rolloutPath.startsWith(home + '/'))
  await completeTurn(threadId, 'persisted-original-turn')
  await stop()
  const saved = await readFile(rolloutPath, 'utf8')
  assert(saved.includes('persisted-original-turn')); assert(saved.includes(responseText))
  results.push({ name: 'native-rollout-persisted', threadId, rolloutPath, bytes: Buffer.byteLength(saved) })
  const denials = []
  const resume = config => rpc('thread/resume', { threadId, cwd, approvalPolicy: 'never', sandbox: 'read-only', config })
  for (const [name, config, mutate, error] of [
    ['resume-mcp-override', { mcp_servers: { canary: { command: '/usr/bin/python3', args: [canary], enabled: true, startup_timeout_sec: 3 } } }, false, 'NOOKI_PROTOTYPE_MCP_DENIED'],
    ['resume-after-file-change', {}, true, 'NOOKI_PROTOTYPE_MCP_DENIED'],
    ['resume-hooks-override', { 'features.hooks': true }, false, 'NOOKI_PROTOTYPE_HOOKS_DENIED'],
  ]) {
    await writeFile(join(home, 'config.toml'), provider)
    await launch()
    if (mutate) {
      await rpc('config/read', { cwd, includeLayers: true })
      await writeFile(join(home, 'config.toml'), provider + mcp(true))
    }
    const beforeRequests = requests.length, beforeCanaries = await canaryCount()
    let refusal = null, resumed = null
    try { resumed = await resume(config) } catch (error) { refusal = error.message }
    if (resumed) {
      assert.equal(resumed.thread.id, threadId)
      await completeTurn(threadId, name + '-accepted-control')
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
    const observation = { name, generation, refusal, expectedError: error, additionalModelRequests: requests.length - beforeRequests, additionalCanaryStarts: await canaryCount() - beforeCanaries }
    results.push(observation); denials.push(observation)
    await stop()
  }
  await writeFile(join(home, 'config.toml'), provider)
  await launch()
  const beforeRecoveryRequests = requests.length
  const recovered = await resume({})
  assert.equal(requests.length, beforeRecoveryRequests, 'Resume must not dispatch a turn itself')
  assert.equal(recovered.thread.id, threadId); assert.equal(recovered.thread.path, rolloutPath)
  assert.equal(recovered.modelProvider, 'nooki_fixture'); assert.equal(recovered.model, 'mock-model')
  assert.equal(recovered.sandbox.type, 'readOnly'); assert.equal(recovered.approvalPolicy, 'never')
  await completeTurn(threadId, 'resumed-recovery-turn')
  await stop()
  const finalSaved = await readFile(rolloutPath, 'utf8')
  assert(finalSaved.includes('persisted-original-turn')); assert(finalSaved.includes('resumed-recovery-turn'))
  results.push({ name: 'same-rollout-recovered', threadId, rolloutPath, bytes: Buffer.byteLength(finalSaved) })
  for (const denial of denials) {
    assert((denial.refusal ?? '').includes(denial.expectedError), denial.name)
    assert.equal(denial.additionalModelRequests, 0, denial.name)
    assert.equal(denial.additionalCanaryStarts, 0, denial.name)
  }
  assert.equal(requests.length, syntheticModelTurns, 'Unexpected model dispatch or replay')
  assert.equal(await canaryCount(), 0)
  passed = true
} finally {
  await stop()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  const receipt = { root, binary, version, binarySha256, passed, results, requests, fixtureErrors, syntheticModelTurns, realModelCalls: 0, productionPolicyCertified: false }
  await writeFile(join(root, 'resume-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(join(root, 'stderr.log'), stderr)
  await writeFile(join(root, 'notifications.json'), JSON.stringify(notifications, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
}
