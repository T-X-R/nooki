// Native file-auth continuity only. Every credential below is a synthetic fixture.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, lstat, mkdir, readFile, readlink, realpath, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createProfile, launchOptions } from './desktop-profile.mjs'

const binary = process.argv[2]
if (!binary || process.platform !== 'darwin') throw new Error('Usage on macOS: node scripts/probe-capability-agent-auth-link.mjs <absolute-codex-binary>')
const executable = await realpath(resolve(binary))
const root = await createProfile(), options = await launchOptions(root)
const original = join(root, 'original-codex'), isolated = join(root, 'isolated-codex')
await mkdir(original); await mkdir(isolated)
const config = 'cli_auth_credentials_store = "file"\n'
await writeFile(join(original, 'config.toml'), config)
await writeFile(join(isolated, 'config.toml'), config)
const run = (home, args, input = '') => new Promise((resolve, reject) => {
  const child = execFile(executable, args, { ...options, env: { ...options.env, CODEX_HOME: home }, timeout: 15_000 }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stdout, stderr }))
    else resolve({ stdout, stderr })
  })
  child.stdin.end(input)
})
assert.equal((await run(original, ['--version'])).stdout.trim(), 'codex-cli 0.170.0')
const first = 'sk-nooki-synthetic-first-not-a-real-key', second = 'sk-nooki-synthetic-second-not-a-real-key'
await run(original, ['login', '--with-api-key'], first)
const source = join(original, 'auth.json'), link = join(isolated, 'auth.json')
assert.equal(JSON.parse(await readFile(source, 'utf8')).OPENAI_API_KEY, first)
await symlink(source, link)
assert.match((await run(isolated, ['login', 'status'])).stderr, /API key configured/)
await run(isolated, ['login', '--with-api-key'], second)
assert.equal(await readlink(link), source, 'Native writes must retain the credential link')
assert.equal(JSON.parse(await readFile(source, 'utf8')).OPENAI_API_KEY, second, 'Native writes must update the original file')
assert.equal((await stat(source)).mode & 0o777, 0o600)
assert.equal((await stat(join(original, 'auth.json.lock'))).isFile(), true)
await assert.rejects(lstat(join(isolated, 'auth.json.lock')), { code: 'ENOENT' })
assert.match((await run(original, ['login', 'status'])).stderr, /API key configured/)
await run(isolated, ['logout'])
await assert.rejects(lstat(link), { code: 'ENOENT' })
assert.equal(JSON.parse(await readFile(source, 'utf8')).OPENAI_API_KEY, second, 'Unlinking the isolated login must retain the original credential file')
assert.match((await run(original, ['login', 'status'])).stderr, /API key configured/)

await symlink(source, link)
await chmod(source, 0o400)
await assert.rejects(run(isolated, ['login', '--with-api-key'], first), error => error.code === 1 && /read-only/.test(error.stderr))
assert.equal(await readlink(link), source)
assert.equal(JSON.parse(await readFile(source, 'utf8')).OPENAI_API_KEY, second)
assert.equal((await stat(source)).mode & 0o777, 0o400)
await chmod(source, 0o600)
await unlink(source)
await assert.rejects(run(isolated, ['login', 'status']), error => error.code === 1 && /Not logged in/.test(error.stderr))
await assert.rejects(lstat(source), { code: 'ENOENT' })

const receipt = { version: 'codex-cli 0.170.0', root, modelTurns: 0, realCredentialsUsed: false,
  passed: ['native login reads linked synthetic file', 'native login updates original file without replacing link',
    'original file remains private', 'commit lock is beside original credential file', 'isolated logout retains original credential file',
    'read-only original refuses native writes without altering the link or permissions', 'new native login status observes removal of the original credential file'],
  productionPolicyCertified: false,
  limitation: 'Synthetic file-store continuity only; no OAuth refresh, keyring, authenticated model request, managed policy or complete configuration isolation is certified.' }
await writeFile(join(root, 'auth-link-probe.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify(receipt, null, 2))
