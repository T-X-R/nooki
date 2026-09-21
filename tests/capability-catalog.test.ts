import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const runtimeFile = fileURLToPath(new URL('../src/platform/capability-runtime.ts', import.meta.url))
const capabilitiesDirectory = fileURLToPath(new URL('../capabilities', import.meta.url))

/** The catalog is discovered with a relative glob, so moving the runtime file can empty it without
 *  breaking the build. Everything shipped in `capabilities/` has to stay reachable from that glob. */
test('the capability glob resolves to every bundled capability', async () => {
  const source = await readFile(runtimeFile, 'utf8')
  const pattern = /import\.meta\.glob\('([^']+)'/.exec(source)?.[1]
  assert.ok(pattern, 'capability-runtime.ts must discover capabilities with import.meta.glob')

  const root = resolve(dirname(runtimeFile), pattern.slice(0, pattern.indexOf('/*')))
  assert.equal(root, capabilitiesDirectory)

  const entries = await readdir(capabilitiesDirectory, { withFileTypes: true })
  const bundled = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  assert.ok(bundled.length > 0)
  for (const name of bundled) {
    const module = resolve(capabilitiesDirectory, name, 'index.tsx')
    assert.ok((await stat(module)).isFile(), `${name} must expose index.tsx`)
  }
})
