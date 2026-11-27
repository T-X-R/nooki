// Characterizes mutable hook settings; a passing probe does not certify hook confinement.
// Codex owns model transport; the local response fixture performs no inference.
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

assert(process.argv[2] && process.platform === 'darwin', 'Usage on macOS: node scripts/probe-capability-agent-native-hooks-policy.mjs <standalone-app-server> <true|false>')
assert(['true', 'false'].includes(process.argv[3]), 'Explicit bootstrap hooks setting required')
const bootstrapHooks = process.argv[3] === 'true'
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
`
const marker = join(root, 'hook.events'), hookScript = join(root, 'hook.py')
await writeFile(hookScript, `import pathlib, json, sys
request=json.load(sys.stdin)
with pathlib.Path(${JSON.stringify(marker)}).open('a') as stream:
 stream.write(json.dumps({'event':request.get('hook_event_name'),'session':request.get('session_id')})+'\\n')
`)
await writeFile(join(home, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `/usr/bin/python3 ${hookScript}`, timeout: 5 }] }] } }))
await writeFile(join(home, 'config.toml'), provider)
const hookEvents = async () => (await readFile(marker, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const child = spawn(binary, ['--strict-config', '-c', `features.hooks=${bootstrapHooks}`], { ...options, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
const pending = new Map(), lines = createInterface({ input: child.stdout })
let sequence = 0, stderr = '', passed = false, syntheticModelTurns = 0
const rejectPending = error => {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
  pending.clear()
}
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
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 15000)
  pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
})
async function start(hooks, wholeFeatureTable = false) {
  const result = await rpc('thread/start', { cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: [], selectedCapabilityRoots: [], config: wholeFeatureTable ? { features: { apps: false, plugins: false, mcp_lazy_stdio_startup: false } } : { 'features.apps': false, 'features.plugins': false, 'features.mcp_lazy_stdio_startup': false, ...(hooks === undefined ? {} : { 'features.hooks': hooks }) } })
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
  results.push({ name: label, threadId, turnId: turn.id, completed: true, localResponseRequests: requests.length - before })
}
try {
  await rpc('initialize', { clientInfo: { name: 'nooki-native-model-probe', version: '1' }, capabilities: { experimentalApi: true } })
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
  const trustThread = await start(true)
  const listed = await rpc('hooks/list', { threadId: trustThread.thread.id })
  const hooks = listed.data.flatMap(entry => entry.hooks)
  assert.equal(hooks.length, 1, JSON.stringify(listed))
  const hook = hooks[0]
  assert.equal(hook.eventName, 'sessionStart')
  assert.equal(hook.trustStatus, 'untrusted')
  await rpc('config/batchWrite', { edits: [{ keyPath: 'hooks.state', value: { [hook.key]: { trusted_hash: hook.currentHash } }, mergeStrategy: 'upsert' }], reloadUserConfig: true })
  const trusted = await rpc('hooks/list', { threadId: trustThread.thread.id })
  assert.equal(trusted.data[0].hooks[0].trustStatus, 'trusted')
  assert.equal(trusted.data[0].hooks[0].currentHash, hook.currentHash)
  assert.equal(trusted.data[0].hooks[0].enabled, true)
  assert.deepEqual(await hookEvents(), [], 'Trust preparation must not run the hook')
  results.push({ name: 'synthetic-hook-trust', hookKey: hook.key, currentHash: hook.currentHash, before: hook.trustStatus, after: 'trusted', hookRunsBeforeTurns: 0 })
  for (const [label, enabled, expectedRuns, wholeFeatureTable] of [
    ['inherited-bootstrap-setting', undefined, bootstrapHooks ? 1 : 0],
    ['explicitly-disabled', false, 0],
    ['explicitly-enabled', true, 1],
    ['whole-feature-table-without-hooks', undefined, 1, true],
    ['disabled-after-positive-control', false, 0],
  ]) {
    const before = (await hookEvents()).length
    const thread = await start(enabled, wholeFeatureTable)
    await completeTurn(thread.thread.id, label)
    const events = await hookEvents()
    results.push({ name: label + '-hook-observation', bootstrapHooks, requestedHooks: enabled ?? null, wholeFeatureTable: wholeFeatureTable ?? false, hookRuns: events.length - before, events: events.slice(before) })
    assert.equal(events.length - before, expectedRuns, label)
    for (const event of events.slice(before)) {
      assert.equal(event.event, 'SessionStart'); assert.equal(event.session, thread.thread.id)
    }
  }
  assert.equal(child.exitCode, null); assert.equal(child.signalCode, null)
  passed = true
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
  lines.close(); rejectPending(new Error('Probe finished'))
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  const receipt = { root, binary, version, binarySha256, bootstrapHooks, passed, results, requests, fixtureErrors, syntheticModelTurns, realModelCalls: 0, hooksConfinementCertified: false, productionPolicyCertified: false }
  await writeFile(join(root, 'hooks-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(join(root, 'stderr.log'), stderr)
  await writeFile(join(root, 'notifications.json'), JSON.stringify(notifications, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
}
