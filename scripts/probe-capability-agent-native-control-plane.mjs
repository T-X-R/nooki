// Qualifies native control-plane refusal against a preinstalled synthetic plugin.
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

assert(process.argv[2] && process.argv[3] && process.platform === 'darwin', 'Usage on macOS: node scripts/probe-capability-agent-native-control-plane.mjs <candidate-app-server> <preparation-app-server>')
const pluginsEnabled = true
const preparationBinary = await realpath(resolve(process.argv[3]))
const binary = await realpath(resolve(process.argv[2]))
const root = await createProfile(), options = await launchOptions(root)
const cwd = join(root, 'input'), home = join(root, 'home/.codex')
await mkdir(cwd); await mkdir(home)
const version = (await promisify(execFile)(binary, ['--version'], { ...options, timeout: 10000 })).stdout.trim()
assert.equal(version, 'codex-app-server 0.170.0')
const hash = createHash('sha256')
for await (const chunk of createReadStream(binary)) hash.update(chunk)
const binarySha256 = hash.digest('hex')
const requests = [], discoveryRequests = [], fixtureErrors = [], notifications = [], results = [], mismatches = []
const preparationHash = createHash('sha256')
for await (const chunk of createReadStream(preparationBinary)) preparationHash.update(chunk)
const preparationSha256 = preparationHash.digest('hex')
assert.equal((await promisify(execFile)(preparationBinary, ['--version'], { ...options, timeout: 10000 })).stdout.trim(), version)
const responseText = 'NOOKI_SYNTHETIC_MODEL_RESPONSE'
const server = createServer(async (request, response) => {
  try {
    if (request.url !== '/v1/responses') {
      assert(!request.headers.authorization, 'Discovery must not carry credentials')
      discoveryRequests.push({ method: request.method, path: request.url })
      request.resume()
      response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}')
      return
    }
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
with pathlib.Path(${JSON.stringify(marker)}).open('a') as stream: stream.write('started\\n')
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m: continue
 if m['method']=='initialize': r={'protocolVersion':'2024-11-05','capabilities':{'tools':{},'resources':{}},'serverInfo':{'name':'canary','version':'1'}}
 elif m['method']=='resources/read': r={'contents':[{'uri':'synthetic://test','text':'synthetic resource'}]}
 elif m['method']=='resources/list': r={'resources':[]}
 elif m['method']=='resources/templates/list': r={'resourceTemplates':[]}
 else: r={'tools':[]}
 print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':r}),flush=True)
`)
const marketplace = join(root, 'marketplace'), plugin = join(marketplace, 'synthetic-plugin')
await mkdir(join(marketplace, '.git'), { recursive: true })
await mkdir(join(marketplace, '.agents/plugins'), { recursive: true })
await mkdir(join(plugin, '.codex-plugin'), { recursive: true })
const marketplacePath = join(marketplace, '.agents/plugins/marketplace.json')
await writeFile(marketplacePath, JSON.stringify({ name: 'synthetic-market', plugins: ['synthetic-plugin', 'http-plugin'].map(name => ({ name, source: { source: 'local', path: './' + name } })) }))
await writeFile(join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'synthetic-plugin', version: '1.0.0' }))
await writeFile(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { canary: { command: '/usr/bin/python3', args: [canary] } } }))
const httpPlugin = join(marketplace, 'http-plugin')
await mkdir(join(httpPlugin, '.codex-plugin'), { recursive: true })
await writeFile(join(httpPlugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'http-plugin', version: '1.0.0' }))
await writeFile(join(httpPlugin, '.mcp.json'), JSON.stringify({ mcpServers: { httpCanary: { url: `http://127.0.0.1:${server.address().port}/mcp` } } }))
const installedHttpManifest = join(home, 'plugins/cache/synthetic-market/http-plugin/1.0.0/.codex-plugin/plugin.json')
const canaryStarts = async () => (await readFile(marker, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).length
await writeFile(join(home, 'config.toml'), provider)
const pending = new Map()
let child = null, lines = null, sequence = 0, stderr = '', passed = false, syntheticModelTurns = 0
const rejectPending = error => {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
  pending.clear()
}
function launch(executable) {
  child = spawn(executable, ['--strict-config'], { ...options, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
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
    if (message.error) entry.reject(Object.assign(new Error(message.error.message), { rpcError: message.error }))
    else entry.resolve(message.result)
  })
}
async function stop() {
  if (child?.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
  lines?.close(); rejectPending(new Error('App-server stopped'))
}
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
async function initialize() {
  await rpc('initialize', { clientInfo: { name: 'nooki-native-model-probe', version: '1' }, capabilities: { experimentalApi: true } })
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
}
async function denied(method, params) {
  const before = { canary: await canaryStarts(), discovery: discoveryRequests.length, model: requests.length }
  let refusal = null, accepted = false
  try { await rpc(method, params); accepted = true } catch (error) {
    if (!error.rpcError) throw error
    refusal = error.rpcError
  }
  await new Promise(resolve => setTimeout(resolve, 250))
  const effects = { canary: await canaryStarts() - before.canary, discovery: discoveryRequests.length - before.discovery, model: requests.length - before.model }
  const expectedRefusal = refusal?.code === -32600 && refusal?.message === 'NOOKI_PROTOTYPE_CONTROL_PLANE_DENIED'
  results.push({ name: method, accepted, refusal, expectedRefusal, effects })
  if (!expectedRefusal || Object.values(effects).some(value => value !== 0)) mismatches.push(method)
}
try {
  // Native installation in the same disposable profile proves the inherited connector exists.
  launch(preparationBinary); await initialize()
  const install = await rpc('plugin/install', { marketplacePath, pluginName: 'synthetic-plugin' })
  assert.equal(install.authPolicy, 'ON_INSTALL')
  await stop()
  assert.equal(await canaryStarts(), 0); assert.equal(discoveryRequests.length, 0); assert.equal(requests.length, 0)
  const seededConfig = await readFile(join(home, 'config.toml'), 'utf8')
  assert(seededConfig.includes('[plugins."synthetic-plugin@synthetic-market"]'))
  results.push({ name: 'native-plugin-preparation', install, processStopped: true })

  launch(binary); await initialize()
  const clean = await start()
  await completeTurn(clean.thread.id, 'clean-native-turn')
  assert.equal(await canaryStarts(), 0)
  const scoped = await rpc('mcpServerStatus/list', { threadId: clean.thread.id })
  assert.deepEqual(scoped.data, [])
  assert.equal(await canaryStarts(), 0)
  results.push({ name: 'thread-scoped-inventory-positive-control', empty: true })
  await rpc('config/mcpServer/reload', null)
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(await canaryStarts(), 0); assert.equal(discoveryRequests.length, 0)
  assert.equal(requests.length, syntheticModelTurns)
  results.push({ name: 'native-mcp-reload-positive-control', noConnectorEffects: true })

  await denied('mcpServerStatus/list', {})
  await denied('mcpServer/oauth/login', { name: 'canary' })
  await denied('mcpServer/resource/read', { server: 'canary', uri: 'synthetic://test' })
  await denied('mcpServer/tool/call', { threadId: clean.thread.id, server: 'canary', tool: 'synthetic', arguments: {} })
  await denied('mcpServer/event/stream/start', { threadId: clean.thread.id, server: 'canary', subscriptionId: 'synthetic-subscription', name: 'synthetic', arguments: {} })
  await denied('mcpServer/event/stream/stop', { subscriptionId: 'synthetic-subscription' })
  await denied('plugin/read', { marketplacePath, pluginName: 'synthetic-plugin' })
  await denied('plugin/install', { marketplacePath, pluginName: 'http-plugin' })
  const configUnchanged = (await readFile(join(home, 'config.toml'), 'utf8')) === seededConfig
  const installedHttpPlugin = await readFile(installedHttpManifest, 'utf8').then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
  results.push({ name: 'installation-state', configUnchanged, installedHttpPlugin })
  if (!configUnchanged || installedHttpPlugin) mismatches.push('installation-state')

  await completeTurn(clean.thread.id, 'same-thread-after-control-plane-attempts')
  await new Promise(resolve => setTimeout(resolve, 1000))
  const finalEffects = { canary: await canaryStarts(), discovery: discoveryRequests.length, model: requests.length }
  results.push({ name: 'final-effects', ...finalEffects })
  if (finalEffects.canary || finalEffects.discovery) mismatches.push('final-effects')
  assert.equal(requests.length, syntheticModelTurns); assert.deepEqual(fixtureErrors, [])
  assert.deepEqual(mismatches, [], 'Native control-plane refusal failed')
  passed = true
} finally {
  await stop()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  const receipt = { root, binary, version, binarySha256, preparationBinary, preparationSha256, passed, mismatches, results, requests, discoveryRequests, fixtureErrors, syntheticModelTurns, realModelCalls: 0, productionPolicyCertified: false }
  await writeFile(join(root, 'control-plane-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(join(root, 'stderr.log'), stderr)
  await writeFile(join(root, 'notifications.json'), JSON.stringify(notifications, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
}
