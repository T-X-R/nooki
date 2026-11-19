import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

// This launcher changes only the child's environment, never the caller's shell or agent settings.
export async function createProfile(parent = '/tmp') {
  const root = await realpath(await mkdtemp(join(parent, 'nooki-profile-')))
  await Promise.all(['home', 'tmp'].map((name) => mkdir(join(root, name), { mode: 0o700 })))
  await writeFile(join(root, 'profile.json'), JSON.stringify({ format: 'nooki-test-profile', version: 1, storeId: [...randomBytes(16)] }), { mode: 0o600 })
  return root
}

export async function launchOptions(directory) {
  const root = await realpath(directory)
  const marker = JSON.parse(await readFile(join(root, 'profile.json'), 'utf8'))
  if (marker.format !== 'nooki-test-profile' || marker.version !== 1 || marker.storeId?.length !== 16 || !marker.storeId.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
    throw new Error('Invalid test profile')
  }
  return {
    cwd: root,
    env: {
      NOOKI_TEST_PROFILE: root,
      HOME: join(root, 'home'),
      CODEX_HOME: join(root, 'home/.codex'),
      CLAUDE_CONFIG_DIR: join(root, 'home/.claude'),
      TMPDIR: join(root, 'tmp'),
      PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
      LANG: 'en_US.UTF-8',
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, directory, executable] = process.argv.slice(2)
  if (action === 'create' && !directory) {
    console.log(await createProfile())
  } else if (action === 'launch' && directory) {
    if (process.platform !== 'darwin' || Number(execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).split('.')[0]) < 14) {
      throw new Error('Desktop test profiles currently require macOS 14 or newer')
    }
    const binary = resolve(executable ?? fileURLToPath(new URL('../src-tauri/target/release/bundle/macos/Nooki.app/Contents/MacOS/app', import.meta.url)))
    const child = spawn(binary, [], { ...await launchOptions(directory), stdio: 'inherit' })
    child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
    child.on('exit', (code) => { process.exitCode = code ?? 1 })
  } else {
    throw new Error('Usage: node scripts/desktop-profile.mjs create | launch <profile-directory> [app-executable]')
  }
}
