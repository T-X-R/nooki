// Zero-turn startup qualification; managed fixtures use the official debug-only loader override.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { createProfile, launchOptions } from './desktop-profile.mjs'

assert(process.argv[2] && process.platform === 'darwin', 'Usage on macOS: node scripts/probe-capability-agent-native-startup-policy.mjs <standalone-app-server>')
const binary = await realpath(resolve(process.argv[2]))
const root = await createProfile(), options = await launchOptions(root)
const version = (await promisify(execFile)(binary, ['--version'], { ...options, timeout: 10000 })).stdout.trim()
assert.equal(version, 'codex-app-server 0.170.0')
const hash = createHash('sha256')
for await (const chunk of createReadStream(binary)) hash.update(chunk)
const binarySha256 = hash.digest('hex'), results = []
const cases = [
  { name: 'clean-nonstrict', config: '', strict: false, ready: true },
  { name: 'clean-strict', config: '', strict: true, ready: true },
  { name: 'malformed-repair-nonstrict', config: 'invalid = [', strict: false, ready: true },
  { name: 'malformed-strict', config: 'invalid = [', strict: true, ready: false },
  { name: 'mcp-nonstrict', config: '[mcp_servers.synthetic]\ncommand="/usr/bin/true"\nenabled=true\n', strict: false, ready: false, error: 'NOOKI_PROTOTYPE_MCP_DENIED' },
  { name: 'mcp-strict', config: '[mcp_servers.synthetic]\ncommand="/usr/bin/true"\nenabled=true\n', strict: true, ready: false, error: 'NOOKI_PROTOTYPE_MCP_DENIED' },
  { name: 'notify-nonstrict', config: 'notify=["/usr/bin/true"]\n', strict: false, ready: false, error: 'NOOKI_PROTOTYPE_HOOKS_DENIED' },
  { name: 'notify-strict', config: 'notify=["/usr/bin/true"]\n', strict: true, ready: false, error: 'NOOKI_PROTOTYPE_HOOKS_DENIED' },
  { name: 'hooks-nonstrict', config: '', hooks: true, strict: false, ready: false, error: 'NOOKI_PROTOTYPE_HOOKS_DENIED' },
  { name: 'managed-disable', config: '', requirements: '[features]\ncodex_hooks=false\n', hooks: true, strict: false, ready: true, requiredHooks: false },
  { name: 'managed-disable-user-repair', config: 'invalid = [', requirements: '[features]\ncodex_hooks=false\n', hooks: true, strict: false, ready: true },
  { name: 'managed-enable', config: '', requirements: '[features]\ncodex_hooks=true\n', strict: false, ready: false, error: 'NOOKI_PROTOTYPE_HOOKS_DENIED' },
  { name: 'managed-malformed-nonstrict', config: '', requirements: 'invalid = [', strict: false, ready: false, error: 'failed to parse requirements layer' },
  { name: 'managed-malformed-strict', config: '', requirements: 'invalid = [', strict: true, ready: false, error: 'failed to parse requirements layer' },
  { name: 'hooks-strict', config: '', hooks: true, strict: true, ready: false, error: 'NOOKI_PROTOTYPE_HOOKS_DENIED' },
]
let passed = false
try {
  for (const test of cases) {
    const profile = await createProfile(), launch = await launchOptions(profile)
    const home = join(profile, 'home/.codex'), cwd = join(profile, 'input')
    await mkdir(home); await mkdir(cwd)
    await writeFile(join(home, 'config.toml'), test.config)
    if (test.requirements !== undefined) {
      const managed = join(profile, 'managed')
      await mkdir(managed)
      await writeFile(join(managed, 'managed_config.toml'), '')
      await writeFile(join(managed, 'requirements.toml'), test.requirements)
      launch.env.CODEX_APP_SERVER_MANAGED_CONFIG_PATH = join(managed, 'managed_config.toml')
    }
    const args = ['-c', `features.hooks=${test.hooks ?? false}`, '-c', 'features.apps=false', '-c', 'features.plugins=false', ...(test.strict ? ['--strict-config'] : [])]
    const child = spawn(binary, args, { ...launch, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = '', response = null, naturalExit = null, timedOut = false
    const messages = [], lines = createInterface({ input: child.stdout })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.stdin.on('error', () => {})
    child.on('error', error => { stderr += error.message })
    const exited = once(child, 'exit')
    const observation = new Promise(resolve => {
      const timer = setTimeout(() => { timedOut = true; resolve() }, 10000)
      child.once('exit', (code, signal) => { naturalExit = { code, signal }; clearTimeout(timer); resolve() })
      lines.on('line', line => {
        const message = JSON.parse(line); messages.push(message)
        if (message.id === 1) { response = message; clearTimeout(timer); resolve() }
      })
    })
    child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'nooki-startup-probe', version: '1' }, capabilities: { experimentalApi: true } } }) + '\n')
    await observation
    const ready = !!response?.result
    let requirementsRead = null
    if (ready && test.requirements !== undefined) {
      child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
      child.stdin.write(JSON.stringify({ id: 2, method: 'configRequirements/read', params: {} }) + '\n')
      const deadline = Date.now() + 5000
      while (!messages.some(message => message.id === 2) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
      requirementsRead = messages.find(message => message.id === 2) ?? null
    }
    const observedExit = naturalExit
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await exited; lines.close()
    const result = { name: test.name, profile, strict: test.strict, ready, expectedReady: test.ready, exit: observedExit, timedOut, stderr, response, requirementsRead }
    results.push(result)
    await writeFile(join(profile, 'startup-messages.json'), JSON.stringify(messages, null, 2) + '\n')
  }
  for (let i = 0; i < cases.length; i++) {
    const expected = cases[i], actual = results[i]
    assert.equal(actual.timedOut, false, expected.name)
    assert.equal(actual.ready, expected.ready, expected.name)
    if (expected.requiredHooks !== undefined) assert.equal(actual.requirementsRead?.result?.requirements?.featureRequirements?.codex_hooks, expected.requiredHooks, expected.name)
    if (!expected.ready) {
      assert.deepEqual(actual.exit, { code: 1, signal: null }, expected.name)
      if (expected.error) assert(actual.stderr.includes(expected.error), expected.name)
    }
  }
  passed = true
} finally {
  const receipt = { root, binary, version, binarySha256, passed, results, modelTurns: 0, productionPolicyCertified: false }
  await writeFile(join(root, 'startup-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify(receipt, null, 2))
}
