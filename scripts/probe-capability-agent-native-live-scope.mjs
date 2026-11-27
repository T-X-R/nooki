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

assert(process.argv[2] && process.platform === 'darwin', 'Usage on macOS: node scripts/probe-capability-agent-native-live-scope.mjs <candidate-app-server>')
const binary = await realpath(resolve(process.argv[2]))
const root = await createProfile(), options = await launchOptions(root)
const cwd = join(root, 'input'), home = join(root, 'home/.codex'), output = join(root, 'output')
await mkdir(cwd); await mkdir(home); await mkdir(output)
const alternateCwd = join(cwd, 'alternate')
await mkdir(alternateCwd)
const version = (await promisify(execFile)(binary, ['--version'], { ...options, timeout: 10000 })).stdout.trim()
assert.equal(version, 'codex-app-server 0.170.0')
const hash = createHash('sha256')
for await (const chunk of createReadStream(binary)) hash.update(chunk)
const binarySha256 = hash.digest('hex')
const requests = [], fixtureErrors = [], notifications = [], results = [], mismatches = []
const foreignMetadata = 'NOOKI_FOREIGN_SKILL_METADATA', foreignBody = 'NOOKI_FOREIGN_SKILL_BODY'
const approvedMetadata = 'NOOKI_APPROVED_SKILL_METADATA', approvedBody = 'NOOKI_APPROVED_SKILL_BODY'
let activeFixture = null
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
    assert(activeFixture, 'Model request outside an explicit probe turn')
    const input = JSON.stringify(body.input)
    requests.push({ label: activeFixture.label, model: body.model, foreignMetadata: input.includes(foreignMetadata), foreignBody: input.includes(foreignBody), approvedMetadata: input.includes(approvedMetadata), approvedBody: input.includes(approvedBody) })
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
default_permissions = "nooki-run"
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
const foreignRoot = join(home, 'skills/synthetic-foreign'), approvedRoot = join(cwd, '.agents/skills/synthetic-approved')
const foreignPath = join(foreignRoot, 'SKILL.md'), approvedPath = join(approvedRoot, 'SKILL.md')
await mkdir(foreignRoot, { recursive: true }); await mkdir(approvedRoot, { recursive: true }); await mkdir(join(cwd, '.git'))
const foreignDocument = `---\nname: synthetic-foreign\ndescription: ${foreignMetadata}\n---\n\n${foreignBody}\n`
await writeFile(foreignPath, foreignDocument)
await writeFile(approvedPath, `---\nname: synthetic-approved\ndescription: ${approvedMetadata}\n---\n\n${approvedBody}\n`)
const profile = (name, allowHome) => `
[permissions.${name}.filesystem]
":minimal" = "read"
"/private" = "deny"
"/Users" = "deny"
"/Volumes" = "deny"
"/Applications{,/**}" = "deny"
"/Library/Preferences{,/**}" = "deny"
"/Library/Filesystems/NetFSPlugins{,/**}" = "deny"
"/opt/homebrew/lib{,/**}" = "deny"
"/usr/local/lib{,/**}" = "deny"
"/private/etc{,/**}" = "deny"
"/private/var/db{,/**}" = "deny"
${JSON.stringify(cwd)} = "read"
${JSON.stringify(output)} = "write"
${allowHome ? JSON.stringify(join(home, 'skills')) + ' = "read"' : ''}
[permissions.${name}.network]
enabled = false
`
await writeFile(join(home, 'config.toml'), provider + profile('nooki-run', false) + profile('nooki-wide', true))
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
  await rpc('initialize', { clientInfo: { name: 'nooki-native-live-scope-probe', version: '1' }, capabilities: { experimentalApi: true } })
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
  lines?.close(); rejectPending(new Error('Probe generation stopped'))
}
function assertProfile(result, permissions) {
  assert.equal(result.modelProvider, 'nooki_fixture'); assert.equal(result.model, 'mock-model')
  assert.equal(result.approvalPolicy, 'never'); assert.equal(result.activePermissionProfile.id, permissions)
  assert.deepEqual(result.sandbox, { type: 'workspaceWrite', writableRoots: [output], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true })
}
async function start(permissions) {
  const result = await rpc('thread/start', { cwd, ephemeral: false, approvalPolicy: 'never', permissions, dynamicTools: [], selectedCapabilityRoots: [], config: { 'skills.include_instructions': false } })
  assertProfile(result, permissions)
  assert(result.thread.path.startsWith(home + '/'))
  return result
}
const persistedChecks = []
async function check(thread, label, permissions, skill, expected, overrides = {}, expectedHomeRead = permissions === 'nooki-wide', expectedCwd = cwd) {
  const before = requests.length
  activeFixture = { label }
  const input = [{ type: 'text', text: `nooki-native-model-probe: ${label}`, text_elements: [] }]
  if (skill) input.push({ type: 'skill', name: skill.name, path: skill.path })
  const { turn } = await rpc('turn/start', { threadId: thread.thread.id, input, ...overrides })
  const deadline = Date.now() + 15000
  let completion
  while (Date.now() < deadline) {
    completion = notifications.find(message => message.method === 'turn/completed' && message.params.threadId === thread.thread.id && message.params.turn.id === turn.id)
    if (completion) break
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert(completion, 'Native turn completion was not received')
  assert.equal(completion.params.turn.status, 'completed', JSON.stringify(completion.params.turn.error))
  const item = notifications.find(message => message.method === 'item/completed' && message.params.threadId === thread.thread.id && message.params.turnId === turn.id && message.params.item.type === 'agentMessage')
  assert.equal(item?.params.item.text, responseText)
  assert.equal(requests.length, before + 1); assert.deepEqual(fixtureErrors, [])
  const observed = requests.at(-1)
  for (const [key, value] of Object.entries(expected)) {
    if (observed[key] !== value) mismatches.push({ label, key, expected: value, actual: observed[key] })
  }
  syntheticModelTurns += 1
  persistedChecks.push({ label, permissions, expectedHomeRead, expectedCwd, path: thread.thread.path, turnId: turn.id })
  results.push({ name: label, generation, permissions, threadId: thread.thread.id, turnId: turn.id, completed: true, expected, observed })
  activeFixture = null
}
try {
  const foreign = { name: 'synthetic-foreign', path: foreignPath }, approved = { name: 'synthetic-approved', path: approvedPath }
  const baseConfig = provider + profile('nooki-run', false) + profile('nooki-wide', true)
  await launch()
  for (const scenario of [
    { label: 'turn-narrow', method: 'turn/start', initial: 'nooki-wide', next: 'nooki-run', overrides: { permissions: 'nooki-run' }, homeRead: false },
    { label: 'settings-narrow', method: 'thread/settings/update', initial: 'nooki-wide', next: 'nooki-run', overrides: { permissions: 'nooki-run' }, homeRead: false },
    { label: 'settings-expand', method: 'thread/settings/update', initial: 'nooki-run', next: 'nooki-wide', overrides: { permissions: 'nooki-wide' }, homeRead: true },
    { label: 'turn-cwd-change', method: 'turn/start', initial: 'nooki-wide', next: 'nooki-wide', overrides: { cwd: alternateCwd }, homeRead: true, cwd: alternateCwd },
    { label: 'same-name-profile-edited', method: 'thread/settings/update', initial: 'nooki-wide', next: 'nooki-wide', overrides: { permissions: 'nooki-wide' }, homeRead: false, mutate: true },
  ]) {
    await writeFile(join(home, 'config.toml'), baseConfig)
    const thread = await start(scenario.initial)
    const retainedBody = scenario.initial === 'nooki-wide' ? { foreignBody: true } : { approvedBody: true, foreignBody: false }
    await check(thread, scenario.label + '-seed', scenario.initial, scenario.initial === 'nooki-wide' ? foreign : approved, scenario.initial === 'nooki-wide' ? { foreignBody: true } : { approvedBody: true, foreignBody: false })
    // Explicitly reselecting the unchanged scope must remain usable.
    await rpc('thread/settings/update', { threadId: thread.thread.id, permissions: scenario.initial })
    await check(thread, scenario.label + '-same-scope', scenario.initial, null, retainedBody)
    if (scenario.mutate) await writeFile(join(home, 'config.toml'), provider + profile('nooki-run', false) + profile('nooki-wide', false))
    const before = requests.length
    let refusal = null
    try {
      if (scenario.method === 'turn/start') {
        await check(thread, scenario.label + '-accepted-control', scenario.next, null, {}, scenario.overrides, scenario.homeRead, scenario.cwd ?? cwd)
      } else {
        await rpc(scenario.method, { threadId: thread.thread.id, ...scenario.overrides })
        await check(thread, scenario.label + '-accepted-control', scenario.next, null, {}, {}, scenario.homeRead, scenario.cwd ?? cwd)
      }
    } catch (error) {
      if (!error.message.includes('NOOKI_PROTOTYPE_SCOPE_IMMUTABLE')) throw error
      refusal = error.message
      assert.equal(requests.length, before, 'Refused settings must not dispatch another model request')
    }
    results.push({ name: scenario.label, method: scenario.method, refusal, additionalModelRequests: requests.length - before })
    if (!refusal) mismatches.push({ label: scenario.label, expected: 'native scope refusal before model request', actual: 'accepted' })
    // No permission override is applied here: the refused transaction must retain its old state.
    await check(thread, scenario.label + '-continue', refusal ? scenario.initial : scenario.next, null, retainedBody, {}, refusal ? scenario.initial === 'nooki-wide' : scenario.homeRead, refusal ? cwd : scenario.cwd ?? cwd)
    await writeFile(join(home, 'config.toml'), baseConfig)
  }
  await stop()
  const nativeScopes = new Map()
  for (const check of persistedChecks) {
    const records = (await readFile(check.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    const context = records.find(item => item.type === 'turn_context' && item.payload.turn_id === check.turnId)?.payload
    assert(context, `Missing native context for ${check.label}`)
    assert.equal(context.active_permission_profile.id, check.permissions)
    assert.equal(context.cwd, check.expectedCwd)
    assert.equal(context.approval_policy, 'never')
    assert.equal(context.permission_profile.network, 'restricted')
    const entries = context.permission_profile.file_system.entries
    assert(entries.some(item => item.access === 'read' && item.path.path === cwd))
    assert(entries.some(item => item.access === 'write' && item.path.path === output))
    assert.equal(entries.some(item => item.access === 'read' && item.path.path === join(home, 'skills')), check.expectedHomeRead)
    nativeScopes.set(check.label, { permissionProfile: context.permission_profile, activePermissionProfile: context.active_permission_profile, cwd: context.cwd, approvalPolicy: context.approval_policy, approvalsReviewer: context.approvals_reviewer })
    results.push({ name: check.label + '-native-permissions', turnId: check.turnId, profile: context.active_permission_profile, userSkillReadGranted: check.expectedHomeRead })
  }
  for (const attempt of results.filter(result => result.method)) {
    const original = nativeScopes.get(attempt.name + '-seed')
    assert.deepEqual(nativeScopes.get(attempt.name + '-same-scope'), original)
    if (attempt.refusal) assert.deepEqual(nativeScopes.get(attempt.name + '-continue'), original, 'A rejected transaction must preserve the complete native permission snapshot')
    else assert.notDeepEqual(nativeScopes.get(attempt.name + '-accepted-control'), original, 'The old control must actually change native scope')
  }
  assert.equal(requests.length, syntheticModelTurns)
  assert.deepEqual(mismatches, [], 'Native running-thread scope changed after admission')
  passed = true
} finally {
  await stop()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  const receipt = { root, binary, version, binarySha256, passed, mismatches, results, requests, fixtureErrors, syntheticModelTurns, realModelCalls: 0, productionPolicyCertified: false }
  await writeFile(join(root, 'live-scope-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(join(root, 'stderr.log'), stderr)
  await writeFile(join(root, 'notifications.json'), JSON.stringify(notifications, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
}
