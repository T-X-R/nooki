// Native configuration controls only: fresh synthetic homes, no credentials and no model turns.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { createProfile, launchOptions } from './desktop-profile.mjs'

const binary = process.argv[2]
if (!binary || process.platform !== 'darwin') throw new Error('Usage on macOS: node scripts/probe-capability-agent-config.mjs <absolute-codex-binary>')
const executable = await realpath(resolve(binary)), run = promisify(execFile)
const root = await createProfile(), options = await launchOptions(root)
const cwd = join(root, 'input'), home = join(root, 'home/.codex')
await mkdir(cwd, { recursive: true }); await mkdir(home, { recursive: true })
assert.equal((await run(executable, ['--version'], { ...options, timeout: 10_000 })).stdout.trim(), 'codex-cli 0.170.0')
const canary = join(root, 'mcp-canary.py')
await writeFile(canary, `import json, pathlib, sys
pathlib.Path(sys.argv[1]).write_text('SYNTHETIC MCP STARTED')
for line in sys.stdin:
    message = json.loads(line)
    if 'id' not in message: continue
    result = {'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'synthetic-canary','version':'1'}} if message['method']=='initialize' else {'tools':[]}
    print(json.dumps({'jsonrpc':'2.0','id':message['id'],'result':result}), flush=True)
`)
const config = (servers) => servers.map(name => `
[mcp_servers.${name}]
command = "/usr/bin/python3"
args = [${JSON.stringify(canary)}, ${JSON.stringify(join(root, name + '.started'))}]
enabled = true
startup_timeout_sec = 3
`).join('\n')

async function scenario(name, initial, overlay, added = [], startupArgs = [], threadOptions = {}) {
  await writeFile(join(home, 'config.toml'), config(initial))
  const child = spawn(executable, ['app-server', '--strict-config', ...startupArgs], { ...options, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  const lines = createInterface({ input: child.stdout }), pending = new Map()
  let sequence = 0, stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  lines.on('line', line => {
    const message = JSON.parse(line), request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id); clearTimeout(request.timer)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)) }, 15_000)
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
  try {
    await rpc('initialize', { clientInfo: { name: 'nooki-config-probe', version: '1' }, capabilities: { experimentalApi: true } })
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
    const inherited = await rpc('config/read', { cwd, includeLayers: true })
    for (const server of initial) assert.equal(inherited.config.mcp_servers[server].enabled, true)
    if (added.length) await writeFile(join(home, 'config.toml'), config([...initial, ...added]))
    const thread = await rpc('thread/start', { cwd, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: [], selectedCapabilityRoots: [], ...threadOptions,
      config: { features: { apps: false, plugins: false, hooks: false, mcp_lazy_stdio_startup: false }, ...overlay } })
    assert.equal(thread.approvalPolicy, 'never')
    assert.equal(thread.sandbox.type, 'readOnly')
    // Native MCP startup runs asynchronously after thread creation. Bound observation explicitly.
    const deadline = Date.now() + 5_000
    const started = new Set()
    while (Date.now() < deadline) {
      for (const server of [...initial, ...added]) {
        if (await readFile(join(root, server + '.started'), 'utf8').catch(() => '') === 'SYNTHETIC MCP STARTED') started.add(server)
      }
      if (started.size === initial.length + added.length) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(child.exitCode, null, 'A dead app-server cannot establish a negative startup control')
    assert.equal(child.signalCode, null)
    return { name, initial, added, startupArgs, threadOptions, started: [...started].sort() }
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
    lines.close(); for (const request of pending.values()) clearTimeout(request.timer)
    await writeFile(join(root, name + '.stderr'), stderr)
  }
}

const results = []
results.push(await scenario('empty-map', ['empty_map_canary'], { mcp_servers: {} }))
assert.deepEqual(results.at(-1).started, ['empty_map_canary'], 'Empty MCP map must be demonstrated against a real startup canary')
results.push(await scenario('explicit-disable', ['disabled_canary'], { mcp_servers: { disabled_canary: { enabled: false } } }))
assert.deepEqual(results.at(-1).started, [], 'Explicit server disable must prevent its synthetic process')
results.push(await scenario('changed-config', ['known_canary'], { mcp_servers: { known_canary: { enabled: false } } }, ['added_canary']))
assert.deepEqual(results.at(-1).started, ['added_canary'], 'Config reload must demonstrate the newly inherited connector')
// These are reproduced limitations, not acceptance of a production confinement policy.
results.push(await scenario('orchestrator-disable', ['native_disabled_canary'], { orchestrator: { mcp: { enabled: false } } }, ['native_added_canary']))
assert.deepEqual(results.at(-1).started, ['native_added_canary', 'native_disabled_canary'])
results.push(await scenario('bootstrap-disable', ['bootstrap_canary'], { orchestrator: { mcp: { enabled: false } } }, [], ['-c', 'orchestrator.mcp.enabled=false']))
assert.deepEqual(results.at(-1).started, ['bootstrap_canary'])
results.push(await scenario('empty-environment', ['environment_canary'], {}, [], [], { environments: [] }))
assert.deepEqual(results.at(-1).started, ['environment_canary'])
const receipt = { version: 'codex-cli 0.170.0', root, results, modelTurns: 0,
  productionPolicyCertified: false,
  conclusion: 'Empty maps retain connectors, enumerated disables miss configuration additions, and orchestrator.mcp.enabled=false does not prevent these startup processes.' }
await writeFile(join(root, 'config-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt, null, 2))
