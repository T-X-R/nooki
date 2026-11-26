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
    const contractGuide = await readFile(join(skill, 'references/contract.md'), 'utf8')
    const example = contractGuide.match(/```ts\n(import assert from 'node:assert\/strict'[\s\S]*?)```/)![1]
    await writeFile(join(target, 'preview/storage.test.mjs'), example + `\n test('preview refuses native selection', async () => {\n const { host } = createPreviewHost({ id: 'org.example.notes', name: 'Notes', version: '1.0.0', minPlatformVersion: '0.5.0', entrypoints: ['page'], permissions: ['documents.read-selected'] })\n await assert.rejects(host.library.requestSelection({ purpose: 'Read', kinds: ['document'] }), { code: 'UNSUPPORTED_SERVICE' })\n await assert.rejects(host.board.requestSelection({ purpose: 'Attach', operations: ['attachDelivery'] }), { code: 'UNSUPPORTED_SERVICE' })\n await assert.rejects(host.board.attachDelivery({}, { idempotencyKey: 'attach' }), { code: 'UNSUPPORTED_SERVICE' })\n })\n`)
    execFileSync(process.execPath, ['--test', 'preview/storage.test.mjs'], { cwd: target, stdio: 'pipe' })
    await writeFile(join(target, 'supported-contract.ts'), `import type { CapabilityEntrypoint, CapabilityHost } from './contract'
// @ts-expect-error Widgets have no implemented loader.
const widget: CapabilityEntrypoint = 'widget'
declare const host: CapabilityHost
host.library.requestSelection({ purpose: 'Draft actions', kinds: ['document'], limit: 1 })
// @ts-expect-error Recipient identity belongs to the Host.
host.library.requestSelection({ purpose: 'Read', kinds: ['document'], capabilityId: 'foreign' })
host.board.create({ title: 'Test' }, { idempotencyKey: 'one' })
host.board.requestSelection({ purpose: 'Attach notes', operations: ['attachDelivery'], limit: 1 })
host.board.attachDelivery({ grantId: 'grant', item: { id: 'task', revision: 1 }, title: 'Notes', documents: [{ kind: 'library-document', documentId: 'doc', title: 'Notes' }] }, { idempotencyKey: 'attach' })
// @ts-expect-error Attachment is not an acceptance operation.
host.board.attachDelivery({ grantId: 'grant', item: { id: 'task', revision: 1 }, title: 'Notes', documents: [], accepted: true }, { idempotencyKey: 'attach' })
// @ts-expect-error Delegation is not a task-selection operation.
host.board.requestSelection({ purpose: 'Execute', operations: ['delegate'] })
// @ts-expect-error Selection cannot choose another package identity.
host.board.requestSelection({ purpose: 'Attach', operations: ['attachDelivery'], capabilityId: 'foreign' })
host.library.requestSelection({ purpose: 'Review notes', kinds: ['document'] }).then(selection => {
  if (selection.status === 'selected') return host.board.create({ title: 'Selected task', sources: selection.grant.documents.map(doc => doc.reference) }, { idempotencyKey: 'selected-intent' })
})
// @ts-expect-error Mutations require a stable idempotency key.
host.board.create({ title: 'Test' })
// @ts-expect-error Packages cannot select the owner of the mutation.
host.board.create({ title: 'Test', capabilityId: 'foreign' }, { idempotencyKey: 'one' })
host.conversations.handoff({ title: 'Review', text: 'Please review', sources: [] }, { idempotencyKey: 'handoff' })
// @ts-expect-error Only the Host user can choose a target.
host.conversations.handoff({ title: 'Review', text: 'Text', target: { kind: 'new' } }, { idempotencyKey: 'handoff' })
// @ts-expect-error Handoff requires a stable key.
host.conversations.handoff({ title: 'Review', text: 'Text' })
// @ts-expect-error Agent runs are not the legacy AI invocation API.
host.agents.start({})
`)
    execFileSync(process.execPath, [join(dependencies, 'typescript/bin/tsc'), '--noEmit'], { cwd: target, stdio: 'inherit' })
    execFileSync(process.execPath, [join(target, 'scripts/check.mjs')], { cwd: target, stdio: 'pipe' })
    execFileSync(process.execPath, [join(target, 'scripts/package-capability.mjs'), '.', 'dist'], { cwd: target, stdio: 'pipe' })
    const archive = join(target, 'dist/org.example.notes-1.0.0.capability.zip')
    const archived = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1]) as z: print(json.dumps({"files": sorted(z.namelist()), "manifest": json.loads(z.read("manifest.json"))}))', archive], { encoding: 'utf8' }))
    assert.deepEqual(archived.files, ['entry.js', 'manifest.json', 'style.css'])
    assert.equal(archived.manifest.id, 'org.example.notes')
    assert.throws(() => execFileSync(process.execPath, [join(skill, 'scripts/create-capability.mjs'), target, 'org.example.other'], { stdio: 'pipe' }))
    assert.equal(JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')).id, 'org.example.notes')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('kit check rejects unsupported entrypoints, permissions and global CSS', async () => {
  const manifest = JSON.parse(await readFile(new URL('../skills/workbench-capability-dev/assets/starter/manifest.json', import.meta.url), 'utf8'))
  assert.throws(() => validateManifest({ ...manifest, entrypoints: ['widget'] }))
  validateManifest({ ...manifest, entrypoints: ['page', 'job', 'command'] })
  assert.throws(() => validateManifest({ ...manifest, permissions: ['filesystem.all'] }))
  assert.throws(() => validateManifest({ ...manifest, minPlatformVersion: '0.3.2', permissions: ['board.create'] }))
  validateManifest({ ...manifest, minPlatformVersion: '0.4.0', permissions: ['board.create'] })
  assert.throws(() => validateManifest({ ...manifest, minPlatformVersion: '0.7.0', permissions: ['board.attach-delivery'] }))
  validateManifest({ ...manifest, minPlatformVersion: '0.8.0', permissions: ['board.attach-delivery'] })
  assert.throws(() => validateManifest({ ...manifest, minPlatformVersion: '0.10.0', permissions: ['conversations.handoff'] }))
  validateManifest({ ...manifest, minPlatformVersion: '0.11.0', permissions: ['conversations.handoff'] })
  assert.throws(() => validateManifest({ ...manifest, minPlatformVersion: '0.11.0', permissions: ['agents.run'] }))
  validateManifest({ ...manifest, minPlatformVersion: '0.12.0', permissions: ['agents.run'] })
  assert.throws(() => validateStyle('body { color: red }', 'style.css'))
  assert.throws(() => validateStyle('.notes, :root { color: red }', 'style.css'))
  validateStyle('.wb-cap-page.notes textarea { color: var(--ink) }', 'style.css')
})
