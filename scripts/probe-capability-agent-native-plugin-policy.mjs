// Characterizes plugin MCP startup, or asserts scoped thread MCP exclusion.
// Codex owns model transport; the local fixture performs no inference.
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

assert(process.argv[2] && process.platform === 'darwin', 'Usage on macOS: node scripts/probe-capability-agent-native-plugin-policy.mjs <standalone-app-server> <true|false> <loaded|fresh> [observe|exclude]')
assert(['true', 'false'].includes(process.argv[3]) && ['loaded', 'fresh'].includes(process.argv[4]), 'Explicit plugin feature and existing-thread mode required')
const mode = process.argv[5] ?? 'observe'
assert(['observe', 'exclude'].includes(mode), 'Unknown expectation mode')
const pluginsEnabled = process.argv[3] === 'true', withLoadedThread = process.argv[4] === 'loaded'
const binary = await realpath(resolve(process.argv[2]))
const root = await createProfile(), options = await launchOptions(root)
const cwd = join(root, 'input'), home = join(root, 'home/.codex')
await mkdir(cwd); await mkdir(home)
const version = (await promisify(execFile)(binary, ['--version'], { ...options, timeout: 10000 })).stdout.trim()
assert.equal(version, 'codex-app-server 0.170.0')
const hash = createHash('sha256')
for await (const chunk of createReadStream(binary)) hash.update(chunk)
const binarySha256 = hash.digest('hex')
const requests = [], fixtureErrors = [], notifications = [], results = [], mismatches = []
const checkCanary = (name, actual, expected) => {
  if (actual !== expected) mismatches.push({ name, actual, expected })
}
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
plugins = ${pluginsEnabled}
mcp_lazy_stdio_startup = false
`
const marker = join(root, 'canary.started'), canary = join(root, 'canary.py')
await writeFile(canary, `import pathlib, json, sys
pathlib.Path(${JSON.stringify(marker)}).write_text('started')
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m: continue
 r={'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'canary','version':'1'}} if m['method']=='initialize' else {'tools':[]}
 print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':r}),flush=True)
`)
const marketplace = join(root, 'marketplace'), plugin = join(marketplace, 'synthetic-plugin')
await mkdir(join(marketplace, '.git'), { recursive: true })
await mkdir(join(marketplace, '.agents/plugins'), { recursive: true })
await mkdir(join(plugin, '.codex-plugin'), { recursive: true })
const marketplacePath = join(marketplace, '.agents/plugins/marketplace.json')
await writeFile(marketplacePath, JSON.stringify({ name: 'synthetic-market', plugins: [{ name: 'synthetic-plugin', source: { source: 'local', path: './synthetic-plugin' } }] }))
await writeFile(join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'synthetic-plugin', version: '1.0.0' }))
await writeFile(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { canary: { command: '/usr/bin/python3', args: [canary] } } }))
await writeFile(join(home, 'config.toml'), provider)
const child = spawn(binary, ['--strict-config'], { ...options, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
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
async function start() {
  const result = await rpc('thread/start', { cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: [], selectedCapabilityRoots: [], config: { features: { apps: false, plugins: pluginsEnabled, hooks: false, mcp_lazy_stdio_startup: false } } })
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
  let loadedThreadId = null
  if (withLoadedThread) {
    loadedThreadId = (await start()).thread.id
    await completeTurn(loadedThreadId, 'clean-plugin-positive-control')
  }
  assert.equal(await readFile(marker, 'utf8').catch(() => ''), '')
  const install = await rpc('plugin/install', { marketplacePath, pluginName: 'synthetic-plugin' })
  await new Promise(resolve => setTimeout(resolve, 1000))
  const canaryStartedAfterInstall = await readFile(marker, 'utf8').catch(() => '') === 'started'
  results.push({ name: 'synthetic-local-plugin-install', result: install, canaryStartedAfterInstall, modelRequestsAfterInstall: requests.length })
  checkCanary('idle-thread-install-refresh', canaryStartedAfterInstall, mode === 'observe' && pluginsEnabled && withLoadedThread)
  if (mode === 'exclude' && loadedThreadId) {
    await completeTurn(loadedThreadId, 'same-thread-after-plugin-refresh')
    checkCanary('loaded-thread-remains-usable', await readFile(marker, 'utf8').catch(() => '') === 'started', false)
  }
  const before = requests.length
  let refusal = null, accepted = null
  try { accepted = await start() } catch (error) { refusal = error.message }
  if (accepted) await completeTurn(accepted.thread.id, 'installed-plugin-accepted-control')
  await new Promise(resolve => setTimeout(resolve, 5000))
  const canaryStarted = await readFile(marker, 'utf8').catch(() => '') === 'started'
  results.push({ name: 'installed-plugin-mcp', refusal, canaryStarted, additionalModelRequests: requests.length - before })
  assert.equal(refusal, null)
  checkCanary('new-thread-with-installed-plugin', canaryStarted, mode === 'observe' && pluginsEnabled)
  assert.equal(requests.length, before + 1)
  assert.equal(requests.length, syntheticModelTurns)
  if (mode === 'exclude' && accepted) {
    const scopedStatus = await rpc('mcpServerStatus/list', { threadId: accepted.thread.id })
    results.push({ name: 'thread-scoped-inventory', serverNames: scopedStatus.data.map(server => server.name) })
    if (scopedStatus.data.length !== 0) mismatches.push({ name: 'thread-scoped-inventory', actual: scopedStatus.data.length, expected: 0 })
    checkCanary('thread-scoped-inventory-startup', await readFile(marker, 'utf8').catch(() => '') === 'started', false)
  }
  assert.deepEqual(mismatches, [], 'Plugin MCP startup did not meet the selected expectation')
  if (mode === 'exclude') {
    // Characterize the distinct global path only after scoped exclusion is verified.
    // A global canary launch is recorded as a gap, never a confinement success.
    const globalStatus = await rpc('mcpServerStatus/list', {})
    await new Promise(resolve => setTimeout(resolve, 1000))
    results.push({ name: 'threadless-inventory-characterization', serverNames: globalStatus.data.map(server => server.name), canaryStarted: await readFile(marker, 'utf8').catch(() => '') === 'started' })
    assert.equal(requests.length, syntheticModelTurns, 'Inventory must not dispatch a model turn')
  }
  passed = true
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
  lines.close(); rejectPending(new Error('Probe finished'))
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  const receipt = { root, binary, version, binarySha256, pluginsEnabled, withLoadedThread, mode, passed, mismatches, results, requests, fixtureErrors, syntheticModelTurns, realModelCalls: 0, scopedThreadMcpExclusionVerified: mode === 'exclude' && passed, pluginConfinementCertified: false, productionPolicyCertified: false }
  await writeFile(join(root, 'plugin-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(join(root, 'stderr.log'), stderr)
  await writeFile(join(root, 'notifications.json'), JSON.stringify(notifications, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
}
