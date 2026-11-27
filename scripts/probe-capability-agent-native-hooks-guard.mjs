// Qualifies a disposable fixed hook refusal against a trusted, executable native control.
// Codex owns model transport; the local response fixture performs no inference.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { launchOptions } from './desktop-profile.mjs'

assert(process.argv[2] && process.argv[3] && process.platform === 'darwin', 'Usage on macOS: node scripts/probe-capability-agent-native-hooks-guard.mjs <candidate-app-server> <unmodified-control>')
const binary = await realpath(resolve(process.argv[2]))
const controlBinary = await realpath(resolve(process.argv[3]))
const preparationOutput = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./probe-capability-agent-native-hooks-policy.mjs', import.meta.url)), controlBinary, 'false'], { timeout: 60000, maxBuffer: 1024 * 1024 })
const preparation = JSON.parse(preparationOutput.stdout)
assert.equal(preparation.passed, true)
assert.equal(preparation.syntheticModelTurns, 5)
assert.deepEqual(preparation.results.filter(result => 'hookRuns' in result).map(result => result.hookRuns), [0, 0, 1, 1, 0])
const root = preparation.root, options = await launchOptions(root)
const cwd = join(root, 'input'), home = join(root, 'home/.codex')
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
const configPath = join(home, 'config.toml')
const trustedConfig = await readFile(configPath, 'utf8')
assert.equal((trustedConfig.match(/^base_url = .+$/gm) ?? []).length, 1)
assert(!/^\[features\]/m.test(trustedConfig))
const provider = trustedConfig.replace(/^base_url = .+$/m, `base_url = "http://127.0.0.1:${server.address().port}/v1"`)
const configure = enabled => writeFile(configPath, provider + `\n[features]\nhooks = ${enabled}\n`)
await configure(false)
const marker = join(root, 'hook.events')
const hookEvents = async () => (await readFile(marker, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const notifyMarker = join(root, 'notify.events'), notifyScript = join(root, 'notify.py')
await writeFile(notifyScript, `import pathlib, json, sys
request=json.loads(sys.argv[-1])
with pathlib.Path(${JSON.stringify(notifyMarker)}).open('a') as stream:
 stream.write(json.dumps({'event':request.get('type'),'session':request.get('thread-id')})+'\\n')
`)
const notifyEvents = async () => (await readFile(notifyMarker, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const configureNotify = () => writeFile(configPath, `notify = ["/usr/bin/python3", ${JSON.stringify(notifyScript)}]\n` + provider + '\n[features]\nhooks = false\n')
const initialHookEvents = await hookEvents()
assert.equal(initialHookEvents.length, 2)
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
  const clean = await start()
  await completeTurn(clean.thread.id, 'clean-disabled-positive-control')
  assert.deepEqual(await hookEvents(), initialHookEvents)
  const denials = []
  async function attempt(label, operation, turnIfAccepted = true) {
    const beforeRequests = requests.length, beforeHooks = (await hookEvents()).length, beforeNotify = (await notifyEvents()).length
    let result = null, refusal = null
    try { result = await operation() } catch (error) { refusal = error.message }
    if (result && turnIfAccepted) await completeTurn(result.thread.id, label + '-accepted-control')
    if (result && label === 'legacy-notify-with-hooks-disabled') {
      const deadline = Date.now() + 5000
      while ((await notifyEvents()).length === beforeNotify && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
      const events = (await notifyEvents()).slice(beforeNotify)
      assert.equal(events.length, 1, 'Positive notify control must execute')
      assert.equal(events[0].event, 'agent-turn-complete'); assert.equal(events[0].session, result.thread.id)
    }
    const observation = { name: label, refusal, additionalModelRequests: requests.length - beforeRequests, additionalHookRuns: (await hookEvents()).length - beforeHooks, additionalNotifyRuns: (await notifyEvents()).length - beforeNotify }
    results.push(observation); denials.push(observation)
  }
  await attempt('explicit-thread-enable', () => start(true))
  const inheritedTable = await start(undefined, true)
  await completeTurn(inheritedTable.thread.id, 'whole-table-keeps-file-disable')
  await rpc('config/read', { cwd, includeLayers: true })
  await configure(true)
  await attempt('whole-table-with-enabled-file', () => start(undefined, true))
  await attempt('retained-thread-config-refresh', () => rpc('mcpServerStatus/list', { threadId: clean.thread.id }), false)
  await attempt('new-thread-after-config-write', () => start())
  await configureNotify()
  await attempt('legacy-notify-with-hooks-disabled', () => start())
  await configure(false)
  await writeFile(configPath, (await readFile(configPath, 'utf8')) + '\n[mcp_servers.synthetic]\ncommand="/usr/bin/true"\nenabled=true\n')
  const beforeMcpRequests = requests.length
  let mcpRefusal = null
  try { await start() } catch (error) { mcpRefusal = error.message }
  results.push({ name: 'configured-mcp-guard-retained', refusal: mcpRefusal, additionalModelRequests: requests.length - beforeMcpRequests })
  assert.match(mcpRefusal ?? '', /NOOKI_PROTOTYPE_MCP_DENIED/)
  assert.equal(requests.length, beforeMcpRequests)
  await configure(false)
  const recovered = await start()
  await completeTurn(recovered.thread.id, 'disabled-recovery-positive-control')
  assert.equal(child.exitCode, null); assert.equal(child.signalCode, null)
  await new Promise(resolve => setTimeout(resolve, 5000))
  for (const denial of denials) {
    assert.match(denial.refusal ?? '', /NOOKI_PROTOTYPE_HOOKS_DENIED/, denial.name)
    assert.equal(denial.additionalModelRequests, 0, denial.name)
    assert.equal(denial.additionalHookRuns, 0, denial.name)
    assert.equal(denial.additionalNotifyRuns, 0, denial.name)
  }
  assert.deepEqual(await hookEvents(), initialHookEvents)
  assert.deepEqual(await notifyEvents(), [])
  for (const [label, setup] of [['hooks', () => configure(true)], ['legacy-notify', configureNotify]]) {
    await setup()
    let bootstrapFailure
    try { await promisify(execFile)(binary, ['--strict-config'], { ...options, cwd, timeout: 10000 }) }
    catch (error) { bootstrapFailure = error }
    const bootstrap = { name: `strict-bootstrap-${label}-refusal`, exitCode: bootstrapFailure?.code ?? null, signal: bootstrapFailure?.signal ?? null, refusal: bootstrapFailure?.stderr ?? null }
    results.push(bootstrap)
    assert.equal(bootstrap.exitCode, 1); assert.equal(bootstrap.signal, null)
    assert.match(bootstrap.refusal ?? '', /NOOKI_PROTOTYPE_HOOKS_DENIED/)
    assert.deepEqual(await hookEvents(), initialHookEvents)
    assert.deepEqual(await notifyEvents(), [])
  }
  passed = true
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
  lines.close(); rejectPending(new Error('Probe finished'))
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  const receipt = { root, binary, version, binarySha256, preparation: { binary: preparation.binary, binarySha256: preparation.binarySha256, receipt: join(root, 'hooks-probe.json'), syntheticModelTurns: preparation.syntheticModelTurns }, passed, results, requests, fixtureErrors, syntheticModelTurns, realModelCalls: 0, hooksConfinementCertified: false, productionPolicyCertified: false }
  await writeFile(join(root, 'hooks-guard-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(join(root, 'hooks-guard-stderr.log'), stderr)
  await writeFile(join(root, 'hooks-guard-notifications.json'), JSON.stringify(notifications, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
}
