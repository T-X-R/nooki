// No model turn, credentials or personal input. Exercise the installed Codex sandbox itself.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createProfile, launchOptions } from './desktop-profile.mjs'

const run = promisify(execFile)
const binary = process.argv[2]
if (!binary || process.platform !== 'darwin') throw new Error('Usage on macOS: node scripts/probe-capability-agent-policy.mjs <absolute-codex-binary>')
const executable = await realpath(resolve(binary))
const root = await createProfile()
const input = join(root, 'inputs'), output = join(root, 'outputs'), foreign = join(root, 'unapproved')
for (const path of [input, output, foreign, join(root, 'home/.codex')]) await mkdir(path, { recursive: true })
await writeFile(join(input, 'approved.txt'), 'APPROVED SYNTHETIC INPUT\n')
await writeFile(join(foreign, 'private.txt'), 'UNAPPROVED SYNTHETIC INPUT\n')
await symlink(join(foreign, 'private.txt'), join(input, 'escaped.txt'))
await symlink(foreign, join(output, 'escaped-directory'))
await writeFile(join(root, 'home/.codex/config.toml'), `
approval_policy = "never"
default_permissions = "nooki-run"
[permissions.nooki-run.filesystem]
":minimal" = "read"
"/private" = "deny"
"/Users" = "deny"
"/Volumes" = "deny"
${JSON.stringify(input)} = "read"
${JSON.stringify(output)} = "write"
[permissions.nooki-run.network]
enabled = false
`)
const options = { ...await launchOptions(root), timeout: 20_000, maxBuffer: 1_000_000 }
const version = (await run(executable, ['--version'], options)).stdout.trim()
let requests = 0
const server = createServer((_request, response) => { requests++; response.end('synthetic network control') })
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const url = `http://127.0.0.1:${server.address().port}/`

async function probeThread() {
  const child = spawn(executable, ['app-server'], { ...options, stdio: ['pipe', 'pipe', 'ignore'] })
  const lines = createInterface({ input: child.stdout }), pending = new Map()
  let sequence = 0
  lines.on('line', line => {
    const message = JSON.parse(line), request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer); pending.delete(message.id)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)) }, 15_000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
  try {
    await rpc('initialize', { clientInfo: { name: 'nooki-policy-probe', version: '0.1' }, capabilities: { experimentalApi: true } })
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
    const result = await rpc('thread/start', { cwd: input, ephemeral: true, permissions: 'nooki-run', approvalPolicy: 'never', experimentalRawEvents: false,
      dynamicTools: [], selectedCapabilityRoots: [], config: { web_search: 'disabled', features: { apps: false, plugins: false, multi_agent: false, multi_agent_v2: false } } })
    assert.equal(result.activePermissionProfile.id, 'nooki-run')
    assert.equal(result.approvalPolicy, 'never')
    assert.equal(result.cwd, input)
    assert.deepEqual(result.sandbox, { type: 'workspaceWrite', writableRoots: [output], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true })
    return { activePermissionProfile: result.activePermissionProfile, sandbox: result.sandbox, approvalPolicy: result.approvalPolicy }
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
    lines.close(); for (const request of pending.values()) clearTimeout(request.timer)
  }
}

try {
  // Positive controls: the synthetic file and endpoint really exist outside the tested sandbox.
  assert.equal(await readFile(join(foreign, 'private.txt'), 'utf8'), 'UNAPPROVED SYNTHETIC INPUT\n')
  assert.equal((await run('/usr/bin/curl', ['--silent', '--fail', '--max-time', '3', url], options)).stdout, 'synthetic network control')
  assert.equal(requests, 1); requests = 0
  const script = `
set -eu
test "$(/bin/cat "$1/approved.txt")" = 'APPROVED SYNTHETIC INPUT'
printf 'SCOPED OUTPUT\n' > "$2/result.txt"
if /bin/cat "$3/private.txt"; then exit 21; fi
if /bin/cat "$1/escaped.txt"; then exit 22; fi
if (printf 'forbidden\n' > "$1/blocked.txt"); then exit 23; fi
if (printf 'forbidden\n' > "$3/blocked.txt"); then exit 24; fi
if (printf 'forbidden\n' > "$2/escaped-directory/blocked.txt"); then exit 25; fi
if /usr/bin/curl --silent --show-error --fail --max-time 3 "$4"; then exit 26; fi
printf 'NATIVE POLICY CONTROLS PASSED\n'
`
  const result = await run(executable, ['sandbox', '-C', input, '-P', 'nooki-run', '--', '/bin/sh', '-c', script, 'probe', input, output, foreign, url], options)
  assert.match(result.stdout, /NATIVE POLICY CONTROLS PASSED/)
  assert.match(result.stderr, /Operation not permitted|Permission denied/)
  assert.equal(requests, 0, 'The sandbox must not contact the reachable synthetic endpoint')
  assert.equal(await readFile(join(output, 'result.txt'), 'utf8'), 'SCOPED OUTPUT\n')
  for (const path of [join(input, 'blocked.txt'), join(foreign, 'blocked.txt')]) await assert.rejects(readFile(path), { code: 'ENOENT' })
  const threadPolicy = await probeThread()
  const receipt = { version, root, passed: ['approved input read', 'scoped output write', 'foreign read denial', 'symlink read denial', 'input write denial', 'foreign/symlink write denial', 'network denial with reachable positive control'], modelTurns: 0,
    threadPolicy, limitation: 'Checks these synthetic paths and app-server policy acknowledgement only; not a complete production policy audit or proof of connector/tool restrictions, approval ownership or durable run reconciliation.' }
  await writeFile(join(root, 'policy-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(join(root, 'sandbox-stderr.txt'), result.stderr)
  console.log(JSON.stringify(receipt, null, 2))
} finally { await new Promise(resolve => server.close(resolve)) }
