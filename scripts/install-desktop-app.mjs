// Install the freshly bundled desktop app over the copy in /Applications.
// `ditto` alone merges into whatever is already there, so files an older version
// left behind survive the upgrade. The destination is removed first, and the
// installed bundle is ad-hoc signed because `tauri build` only signs the binary,
// which leaves the bundle itself failing `codesign --verify`.
import { execFileSync, spawn } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'

import { createConnection } from 'node:net'

const source = resolve('src-tauri/target/release/bundle/macos/Nooki.app')
const destination = '/Applications/Nooki.app'

if (process.platform !== 'darwin') throw new Error('The desktop app installs into /Applications, which only exists on macOS')
const bundle = await stat(source).catch(() => null)
if (!bundle?.isDirectory()) throw new Error(`No bundle at ${source}; run npm run desktop:build first`)

const processes = execFileSync('/bin/ps', ['-Ao', 'pid=,args=']).toString().split('\n')
  .map(line => line.trim().match(/^(\d+)\s+(.+)$/)).filter(Boolean)
  .filter(([, , command]) => command.startsWith(`${destination}/`))
const workers = processes.filter(([, , command]) => command.includes(' --task-worker '))
if (processes.some(([, , command]) => !command.includes(' --task-worker '))) throw new Error(`Nooki is running from ${destination}; quit it before installing`)

// Hand off only Nooki's queue owner. Codex retains running turns and Goals during installation.
const roots = workers.map(([, , command]) => command.split(' --task-worker ')[1])
for (const root of roots) {
  await new Promise((resolve, reject) => {
    const socket = createConnection(join(root, 'task-worker.sock'))
    socket.setTimeout(120_000, () => socket.destroy(new Error('Task worker handoff timed out')))
    socket.once('connect', () => socket.write('{"op":"handoff"}\n'))
    socket.once('data', data => { socket.end(); try { if (JSON.parse(data.toString()).result !== true) throw new Error('Task worker refused handoff'); resolve() } catch (error) { reject(error) } })
    socket.once('error', reject)
  })
}
for (const [pid] of workers) {
  for (let attempt = 0; ; attempt++) {
    try { process.kill(Number(pid), 0) } catch { break }
    if (attempt === 100) throw new Error('Task worker did not release ownership')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

await rm(destination, { recursive: true, force: true })
execFileSync('/usr/bin/ditto', [source, destination], { stdio: 'inherit' })
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', destination], { stdio: 'inherit' })
execFileSync('/usr/bin/codesign', ['--verify', destination], { stdio: 'inherit' })
console.log(`Installed ${destination}`)

for (const root of roots) {
  const worker = spawn(join(destination, 'Contents/MacOS/app'), ['--task-worker', root], { detached: true, stdio: 'ignore' })
  worker.unref()
}
