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
await writeFile(join(output, 'policy-denied-existing'), 'DENIED GLOB CONTROL\n')
await mkdir(join(output, 'sealed'))
await writeFile(join(output, 'sealed', 'control.txt'), 'SEALED SUBTREE CONTROL\n')
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
"/Applications{,/**}" = "deny"
"/Library/Preferences{,/**}" = "deny"
"/Library/Filesystems/NetFSPlugins{,/**}" = "deny"
"/opt/homebrew/lib{,/**}" = "deny"
"/usr/local/lib{,/**}" = "deny"
"/private/etc{,/**}" = "deny"
"/private/var/db{,/**}" = "deny"
${JSON.stringify(input)} = "read"
${JSON.stringify(output)} = "write"
${JSON.stringify(join(output, 'policy-denied-*'))} = "deny"
${JSON.stringify(join(output, 'sealed') + '{,/**}')} = "deny"
[permissions.nooki-run.network]
enabled = false
`)
const options = { ...await launchOptions(root), timeout: 20_000, maxBuffer: 1_000_000 }
const version = (await run(executable, ['--version'], options)).stdout.trim()
assert.equal(version, 'codex-cli 0.170.0', 'Re-audit native defaults before certifying another CLI version')
let requests = 0
const server = createServer((_request, response) => { requests++; response.end('synthetic network control') })
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const port = String(server.address().port)
const networkCommand = 'printf "GET / HTTP/1.0\\r\\n\\r\\n" > "/dev/tcp/127.0.0.1/$1"'

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
  assert.equal(await readFile(join(output, 'policy-denied-existing'), 'utf8'), 'DENIED GLOB CONTROL\n')
  await assert.rejects(run(executable, ['sandbox', '-P', 'missing-nooki-profile', '--', '/bin/echo', 'UNEXPECTED DISPATCH'], options), error =>
    error.code === 1 && !error.stdout && /undefined profile/.test(error.stderr))
  await run('/bin/bash', ['-c', networkCommand, 'probe', port], options)
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
if /bin/bash -c "$5" probe "$4" > "$2/network.out" 2> "$2/network.err"; then exit 26; else printf '%s' "$?" > "$2/network.status"; fi
if /bin/cat "$2/policy-denied-existing"; then exit 27; fi
if (printf 'forbidden\n' > "$2/policy-denied-new"); then exit 28; fi
if /bin/ls "$2/sealed"; then exit 29; fi
if /bin/cat "$2/sealed/control.txt"; then exit 30; fi
printf 'NATIVE POLICY CONTROLS PASSED\n'
`
  const result = await run(executable, ['sandbox', '-C', input, '-P', 'nooki-run', '--', '/bin/sh', '-c', script, 'probe', input, output, foreign, port, networkCommand], options)
  assert.match(result.stdout, /NATIVE POLICY CONTROLS PASSED/)
  assert.match(result.stderr, /Operation not permitted|Permission denied/)
  assert.equal(requests, 0, 'The sandbox must not contact the reachable synthetic endpoint')
  assert.equal(await readFile(join(output, 'network.status'), 'utf8'), '1')
  assert.match(await readFile(join(output, 'network.err'), 'utf8'), /probe: (socket|connect): Operation not permitted/, 'The failure must come from opening the socket')
  assert.equal(await readFile(join(output, 'result.txt'), 'utf8'), 'SCOPED OUTPUT\n')
  for (const path of [join(input, 'blocked.txt'), join(foreign, 'blocked.txt'), join(output, 'policy-denied-new')]) await assert.rejects(readFile(path), { code: 'ENOENT' })
  const threadPolicy = await probeThread()
  const receipt = { version, root, passed: ['approved input read', 'scoped output write', 'foreign read denial', 'symlink read denial', 'input write denial', 'foreign/symlink write denial', 'network socket denied with matching positive control', 'deny globs override a writable root for existing and new files', 'denied directory contents and descendant reads', 'missing profile blocks dispatch'], modelTurns: 0,
    threadPolicy, limitation: 'Version-pinned filesystem/network feasibility only; OS runtime resources and file metadata remain visible. Production connector/tool policy, approval ownership and durable run reconciliation require separate verification.' }
  await writeFile(join(root, 'policy-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  await writeFile(join(root, 'sandbox-stderr.txt'), result.stderr)
  console.log(JSON.stringify(receipt, null, 2))
} finally { await new Promise(resolve => server.close(resolve)) }
