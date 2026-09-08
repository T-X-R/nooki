import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { kitFiles } from '../scripts/build-capability-kit.mjs'
import { validateManifest, validateStyle } from '../skills/workbench-capability-dev/assets/starter/scripts/check.mjs'

test('released kit scaffolds an independent project with canonical Host types and scoped UI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-kit-test-'))
  try {
    const skill = join(root, 'skill')
    const files = await kitFiles()
    for (const [name, content] of Object.entries(files)) {
      const file = join(skill, name); await mkdir(dirname(file), { recursive: true }); await writeFile(file, content)
    }
    const target = join(root, 'my-capability')
    execFileSync(process.execPath, [join(skill, 'scripts/create-capability.mjs'), target, 'org.example.notes'])
    const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'))
    assert.equal(manifest.id, 'org.example.notes'); validateManifest(manifest)
    assert.equal(await readFile(join(target, 'contract/index.ts'), 'utf8'), await readFile(new URL('../packages/capability-contract/src/index.ts', import.meta.url), 'utf8'))
    assert.match(await readFile(join(target, 'ui/index.tsx'), 'utf8'), /from '..\/contract'/)
    // Reuse test dependencies only; project source and contract stay outside the repo.
    const dependencies = fileURLToPath(new URL('../node_modules', import.meta.url))
    await symlink(dependencies, join(target, 'node_modules'), 'dir')
    execFileSync(process.execPath, [join(dependencies, 'typescript/bin/tsc'), '--noEmit'], { cwd: target, stdio: 'pipe' })
    execFileSync(process.execPath, [join(target, 'scripts/check.mjs')], { cwd: target, stdio: 'pipe' })
    assert.throws(() => execFileSync(process.execPath, [join(skill, 'scripts/create-capability.mjs'), target, 'org.example.other'], { stdio: 'pipe' }))
    assert.equal(JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')).id, 'org.example.notes')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('kit check rejects unsupported entrypoints, permissions and global CSS', async () => {
  const manifest = JSON.parse(await readFile(new URL('../skills/workbench-capability-dev/assets/starter/manifest.json', import.meta.url), 'utf8'))
  assert.throws(() => validateManifest({ ...manifest, entrypoints: ['widget'] }))
  assert.throws(() => validateManifest({ ...manifest, permissions: ['filesystem.all'] }))
  assert.throws(() => validateStyle('body { color: red }', 'style.css'))
  assert.throws(() => validateStyle('.notes, :root { color: red }', 'style.css'))
  validateStyle('.wb-cap-page.notes textarea { color: var(--ink) }', 'style.css')
})
