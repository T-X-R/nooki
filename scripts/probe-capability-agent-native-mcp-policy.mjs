// Configured-MCP startup policy regression only. No credentials or model calls.
// An unmodified native baseline is expected to fail the refusal assertions.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { createProfile, launchOptions } from './desktop-profile.mjs'

const [providedBinary, mode] = process.argv.slice(2)
// "prototype" selects standalone app-server invocation, including the unmodified control.
assert(providedBinary && process.platform === 'darwin' && ['official', 'prototype'].includes(mode),
  'Usage on macOS: node scripts/probe-capability-agent-native-mcp-policy.mjs <binary> <official|prototype>')
const binary = await realpath(resolve(providedBinary))
const root = await createProfile(), options = await launchOptions(root)
const cwd = join(root, 'input'), home = join(root, 'home/.codex')
await mkdir(cwd); await mkdir(home)
const version = (await promisify(execFile)(binary, ['--version'], { ...options, timeout: 10000 })).stdout.trim()
assert.equal(version, mode === 'official' ? 'codex-cli 0.170.0' : 'codex-app-server 0.170.0')
const hash = createHash('sha256')
for await (const chunk of createReadStream(binary)) hash.update(chunk)
const launcherSha256 = hash.digest('hex')
const marker = join(root, 'canary.started'), canary = join(root, 'canary.py')
await writeFile(canary, `import pathlib, json, sys
pathlib.Path(${JSON.stringify(marker)}).write_text('started')
for line in sys.stdin:
 m=json.loads(line)
 if 'id' not in m: continue
 r={'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'canary','version':'1'}} if m['method']=='initialize' else {'tools':[]}
 print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':r}),flush=True)
`)
const config = enabled => `[mcp_servers.canary]\ncommand="/usr/bin/python3"\nargs=[${JSON.stringify(canary)}]\nenabled=${enabled}\nstartup_timeout_sec=3\n`
await writeFile(join(home, 'config.toml'), '')
const args = [...(mode === 'official' ? ['app-server'] : []), '--strict-config']
const child = spawn(binary, args, { ...options, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
const lines = createInterface({ input: child.stdout }), pending = new Map()
let sequence = 0, stderr = '', results = [], passed = false
child.stderr.on('data', data => { stderr += data })
child.on('exit', (code, signal) => {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`Exited ${code}/${signal}`)) }
  pending.clear()
})
lines.on('line', line => {
  const message = JSON.parse(line), request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id); clearTimeout(request.timer)
  if (message.error) request.reject(new Error(JSON.stringify(message.error)))
  else request.resolve(message.result)
})
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 15000)
  pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
})
const start = () => rpc('thread/start', { cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: [], selectedCapabilityRoots: [], config: { features: { apps: false, plugins: false, hooks: false, mcp_lazy_stdio_startup: false } } })
try {
  await rpc('initialize', { clientInfo: { name: 'nooki-native-prototype', version: '1' }, capabilities: { experimentalApi: true } })
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
  const clean = await start()
  assert.equal(clean.sandbox.type, 'readOnly'); assert.equal(clean.approvalPolicy, 'never')
  results.push({ name: 'clean-config-positive-control', passed: true })
  await rpc('config/read', { cwd, includeLayers: true })
  await writeFile(join(home, 'config.toml'), config(true))
  let refusal = null
  try { await start() } catch (error) { refusal = error.message }
  let refreshRefusal = null
  try { await rpc('mcpServerStatus/list', { threadId: clean.thread.id }) } catch (error) { refreshRefusal = error.message }
  await new Promise(resolve => setTimeout(resolve, 5000))
  const started = await readFile(marker, 'utf8').catch(() => '') === 'started'
  results.push({ name: 'added-mcp-before-start', refusal, canaryStarted: started })
  results.push({ name: 'direct-session-config-rebuild', refusal: refreshRefusal })
  assert.match(refusal ?? '', /NOOKI_PROTOTYPE_MCP_DENIED/)
  assert.match(refreshRefusal ?? '', /NOOKI_PROTOTYPE_MCP_DENIED/)
  assert.equal(started, false)
  assert.equal(child.exitCode, null); assert.equal(child.signalCode, null)
  await writeFile(join(home, 'config.toml'), config(false))
  const recovered = await start()
  assert.equal(recovered.sandbox.type, 'readOnly')
  results.push({ name: 'disabled-config-positive-control', passed: true })
  await writeFile(join(home, 'config.toml'), config(true))
  let startupFailure = null
  try { await promisify(execFile)(binary, args, { ...options, cwd, timeout: 10000 }) }
  catch (error) { startupFailure = { code: error.code, signal: error.signal, stderr: error.stderr } }
  results.push({ name: 'bootstrap-config-denial', failure: startupFailure })
  assert.equal(typeof startupFailure?.code, 'number')
  assert.equal(startupFailure.signal, null)
  assert.match(startupFailure.stderr, /NOOKI_PROTOTYPE_MCP_DENIED/)
  assert.equal(await readFile(marker, 'utf8').catch(() => ''), '')
  passed = true
} finally {
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
  lines.close()
  for (const request of pending.values()) clearTimeout(request.timer)
  const receipt = { root, binary, version, launcherSha256, mode, passed, results, modelTurns: 0, productionPolicyCertified: false }
  await writeFile(join(root, 'prototype-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(join(root, 'stderr.log'), stderr)
  console.log(JSON.stringify(receipt, null, 2))
}
