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

assert(process.argv[2] && process.argv[3] && process.platform === 'darwin', 'Usage on macOS: node scripts/probe-capability-agent-native-dynamic-policy.mjs <candidate-app-server> <preparation-app-server> [readonly|scoped]')
const profileMode = process.argv[4] ?? 'readonly'
assert(['readonly', 'scoped'].includes(profileMode), 'Unknown permission profile mode')
const scopeParameters = profileMode === 'scoped' ? { permissions: 'nooki-run' } : { sandbox: 'read-only' }
const preparationBinary = await realpath(resolve(process.argv[3]))
const binary = await realpath(resolve(process.argv[2]))
const root = await createProfile(), options = await launchOptions(root)
const cwd = join(root, 'input'), home = join(root, 'home/.codex'), output = join(root, 'output')
await mkdir(cwd); await mkdir(home); await mkdir(output)
const version = (await promisify(execFile)(binary, ['--version'], { ...options, timeout: 10000 })).stdout.trim()
assert.equal(version, 'codex-app-server 0.170.0')
const hash = createHash('sha256')
for await (const chunk of createReadStream(binary)) hash.update(chunk)
const binarySha256 = hash.digest('hex')
const preparationHash = createHash('sha256')
for await (const chunk of createReadStream(preparationBinary)) preparationHash.update(chunk)
const preparationSha256 = preparationHash.digest('hex')
assert.equal((await promisify(execFile)(preparationBinary, ['--version'], { ...options, timeout: 10000 })).stdout.trim(), version)
const requests = [], fixtureErrors = [], notifications = [], results = [], callbacks = []
const toolName = 'nooki_synthetic_dynamic'
const skillMetadata = 'NOOKI_UNRELATED_SKILL_METADATA', skillBody = 'NOOKI_UNRELATED_SKILL_BODY'
const toolResult = 'NOOKI_SYNTHETIC_DYNAMIC_RESULT'
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
    const input = JSON.stringify(body.input), advertised = JSON.stringify(body.tools ?? []).includes(toolName)
    requests.push({ label: activeFixture.label, model: body.model, dynamicToolAdvertised: advertised, skillMetadataPresent: input.includes(skillMetadata), skillBodyPresent: input.includes(skillBody) })
    const issueCall = activeFixture.callTool && !activeFixture.issued
    if (issueCall) {
      assert(advertised, 'Positive dynamic control must advertise the actual tool')
      activeFixture.issued = true
      activeFixture.callId = `synthetic-call-${requests.length}`
    } else if (activeFixture.callTool) {
      assert(input.includes(toolResult), 'Native continuation must retain the synthetic tool output')
      assert(input.includes(activeFixture.callId))
    }
    const id = `synthetic-${requests.length}`
    const events = [
      { type: 'response.created', response: { id } },
      { type: 'response.output_item.done', item: issueCall ? { type: 'function_call', name: toolName, call_id: activeFixture.callId, arguments: '{}' } : { id: `message-${requests.length}`, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: responseText }] } },
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
${profileMode === 'scoped' ? 'default_permissions = "nooki-run"' : 'sandbox_mode = "read-only"'}
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
// Same explicit read boundaries as C06a; the synthetic home Skill is outside input/output.
const scopedProfile = `
[permissions.nooki-run.filesystem]
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
[permissions.nooki-run.network]
enabled = false
`
const skillPath = join(home, 'skills/synthetic-unrelated/SKILL.md')
await mkdir(join(home, 'skills/synthetic-unrelated'), { recursive: true })
await writeFile(skillPath, `---\nname: synthetic-unrelated\ndescription: ${skillMetadata}\n---\n\n${skillBody}\n`)
await writeFile(join(home, 'config.toml'), provider + (profileMode === 'scoped' ? scopedProfile : ''))
const dynamicTools = [{ name: toolName, description: 'Synthetic callback only; no external action', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }]
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
async function launch(executable = binary) {
  generation += 1
  child = spawn(executable, ['--strict-config'], { ...options, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  lines = createInterface({ input: child.stdout })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', rejectPending)
  child.on('exit', (code, signal) => rejectPending(new Error(`App-server exited: ${code}/${signal}`)))
  lines.on('line', line => {
    let message
    try { message = JSON.parse(line) } catch (error) { rejectPending(error); return }
    if (message.method && Object.hasOwn(message, 'id')) {
      try {
        assert.equal(message.method, 'item/tool/call')
        assert.equal(message.params.tool, toolName)
        assert.deepEqual(message.params.arguments, {})
        assert.equal(message.params.callId, activeFixture?.callId)
        callbacks.push({ generation, threadId: message.params.threadId, turnId: message.params.turnId, callId: message.params.callId, tool: message.params.tool })
        child.stdin.write(JSON.stringify({ id: message.id, result: { contentItems: [{ type: 'inputText', text: toolResult }], success: true } }) + '\n')
      } catch (error) { fixtureErrors.push(error.message); rejectPending(error) }
      return
    }
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
function assertProfile(result) {
  assert.equal(result.modelProvider, 'nooki_fixture'); assert.equal(result.model, 'mock-model')
  assert.equal(result.approvalPolicy, 'never')
  if (profileMode === 'scoped') {
    assert.equal(result.activePermissionProfile.id, 'nooki-run')
    assert.deepEqual(result.sandbox, { type: 'workspaceWrite', writableRoots: [output], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true })
  } else assert.equal(result.sandbox.type, 'readOnly')
}
async function start(tools = [], includeSkills = true) {
  const result = await rpc('thread/start', { cwd, ephemeral: false, approvalPolicy: 'never', ...scopeParameters, dynamicTools: tools, selectedCapabilityRoots: [], config: { 'skills.include_instructions': includeSkills } })
  assertProfile(result)
  return result
}
async function completeTurn(threadId, label, callTool = false, explicitSkill = false) {
  const before = requests.length, beforeCallbacks = callbacks.length
  activeFixture = { label, callTool, issued: false }
  const input = [{ type: 'text', text: `nooki-native-model-probe: ${label}`, text_elements: [] }]
  if (explicitSkill) input.push({ type: 'skill', name: 'synthetic-unrelated', path: skillPath })
  const { turn } = await rpc('turn/start', { threadId, input })
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
  assert.equal(requests.length, before + (callTool ? 2 : 1))
  assert.equal(callbacks.length, beforeCallbacks + (callTool ? 1 : 0))
  for (const callback of callbacks.slice(beforeCallbacks)) {
    assert.equal(callback.threadId, threadId); assert.equal(callback.turnId, turn.id)
  }
  assert.deepEqual(fixtureErrors, [])
  syntheticModelTurns += 1
  results.push({ name: label, generation, threadId, turnId: turn.id, completed: true, requests: requests.slice(before), callbacks: callbacks.length - beforeCallbacks })
  activeFixture = null
}
const denials = []
async function attempt(name, operation) {
  const beforeRequests = requests.length, beforeCallbacks = callbacks.length
  let refusal = null, accepted = null
  try { accepted = await operation() } catch (error) { refusal = error.message }
  if (accepted) await completeTurn(accepted.thread.id, name + '-accepted-control', true)
  const observation = { name, refusal, expectedError: 'NOOKI_PROTOTYPE_DYNAMIC_TOOLS_DENIED', additionalModelRequests: requests.length - beforeRequests, additionalCallbacks: callbacks.length - beforeCallbacks }
  results.push(observation); denials.push(observation)
}
try {
  await launch(preparationBinary)
  const seeded = await start(dynamicTools)
  const rolloutPath = seeded.thread.path
  assert.equal(typeof rolloutPath, 'string'); assert(rolloutPath.startsWith(home + '/'))
  await completeTurn(seeded.thread.id, 'native-persisted-dynamic-preparation', true)
  await stop()
  const saved = await readFile(rolloutPath, 'utf8')
  assert(saved.includes(toolName)); assert(saved.includes(toolResult))
  results.push({ name: 'dynamic-rollout-persisted', threadId: seeded.thread.id, rolloutPath, bytes: Buffer.byteLength(saved) })

  await launch()
  await attempt('new-thread-dynamic-tools', () => start(dynamicTools))
  await stop(); await launch()
  await attempt('resume-persisted-dynamic-tools', async () => {
    const result = await rpc('thread/resume', { threadId: seeded.thread.id, cwd, approvalPolicy: 'never', ...scopeParameters })
    assertProfile(result)
    assert.equal(result.thread.id, seeded.thread.id); assert.equal(result.thread.path, rolloutPath)
    return result
  })
  await stop(); await launch()
  await attempt('fork-persisted-dynamic-tools', async () => {
    const result = await rpc('thread/fork', { threadId: seeded.thread.id, cwd, approvalPolicy: 'never', ...scopeParameters })
    assertProfile(result)
    assert.notEqual(result.thread.id, seeded.thread.id)
    return result
  })

  // These are context observations, not Skills confinement assertions.
  for (const [label, includeSkills, explicitSkill] of [
    ['skill-catalog-enabled', true, false],
    ['skill-catalog-hidden', false, false],
    ['explicit-skill-with-hidden-catalog', false, true],
  ]) {
    const thread = await start([], includeSkills)
    await completeTurn(thread.thread.id, label, false, explicitSkill)
  }
  const recovery = await start([], false)
  await completeTurn(recovery.thread.id, 'clean-thread-after-refusals')
  for (const denial of denials) {
    assert((denial.refusal ?? '').includes(denial.expectedError), denial.name)
    assert.equal(denial.additionalModelRequests, 0, denial.name)
    assert.equal(denial.additionalCallbacks, 0, denial.name)
  }
  assert.equal(requests.length, syntheticModelTurns + callbacks.length)
  passed = true
} finally {
  await stop()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  const receipt = { root, binary, version, binarySha256, preparationBinary, preparationSha256, profileMode, passed, results, requests, callbacks, fixtureErrors, syntheticModelTurns, realModelCalls: 0, skillsConfinementCertified: false, productionPolicyCertified: false }
  await writeFile(join(root, 'dynamic-policy-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(join(root, 'stderr.log'), stderr)
  await writeFile(join(root, 'notifications.json'), JSON.stringify(notifications, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
}
