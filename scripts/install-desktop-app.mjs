// Install the freshly bundled desktop app over the copy in /Applications.
// `ditto` alone merges into whatever is already there, so files an older version
// left behind survive the upgrade. The destination is removed first, and the
// installed bundle is ad-hoc signed because `tauri build` only signs the binary,
// which leaves the bundle itself failing `codesign --verify`.
import { execFileSync } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const source = resolve('src-tauri/target/release/bundle/macos/Nooki.app')
const destination = '/Applications/Nooki.app'

if (process.platform !== 'darwin') throw new Error('The desktop app installs into /Applications, which only exists on macOS')
const bundle = await stat(source).catch(() => null)
if (!bundle?.isDirectory()) throw new Error(`No bundle at ${source}; run npm run desktop:build first`)

const running = execFileSync('/bin/ps', ['-Ao', 'args=']).toString().split('\n').some((line) => line.startsWith(`${destination}/`))
if (running) throw new Error(`Nooki is running from ${destination}; quit it before installing`)

await rm(destination, { recursive: true, force: true })
execFileSync('/usr/bin/ditto', [source, destination], { stdio: 'inherit' })
execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', destination], { stdio: 'inherit' })
execFileSync('/usr/bin/codesign', ['--verify', destination], { stdio: 'inherit' })
console.log(`Installed ${destination}`)
