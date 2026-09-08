import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [destination, id] = process.argv.slice(2)
if (!destination || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(id ?? '')) {
  throw new Error('Usage: node create-capability.mjs <new-directory> <reverse.domain.id>')
}
const target = resolve(destination)
// mkdir is intentionally exclusive: never merge a starter into existing work.
await mkdir(target)
await cp(join(skill, 'assets/starter'), target, { recursive: true })
try { await access(join(target, 'contract/index.ts')) }
catch {
  // The repository source skill uses the same canonical resources as release builds.
  const { kitFiles } = await import('../../../scripts/build-capability-kit.mjs')
  for (const [name, content] of Object.entries(await kitFiles())) {
    if (!name.startsWith('assets/starter/')) continue
    const file = join(target, name.slice('assets/starter/'.length))
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, content)
  }
}
const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'))
manifest.id = id
await writeFile(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Created ${target}\nNext: npm install, npm run dev, npm run check, npm run pack`)
