import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

// A script-element harness exercises the actual loader, including WebKit's
// non-configurable global var export. No DOM implementation or model is needed.
const realm = vm.createContext({})
const sources = new Map<string, Blob>()
const listeners = new Set<(event: { filename: string; message: string }) => void>()
Object.assign(realm, {
  addEventListener: (_: string, listener: (event: { filename: string; message: string }) => void) => listeners.add(listener),
  removeEventListener: (_: string, listener: (event: { filename: string; message: string }) => void) => listeners.delete(listener),
})
Object.defineProperty(realm, 'WorkbenchCapability', { value: undefined, writable: true, configurable: false })
Object.assign(globalThis, {
  window: realm,
  document: {
    createElement: () => ({ remove() {} }),
    head: { append(script: { src: string; onload(): void }) {
      void sources.get(script.src)!.text().then((source) => {
        try { vm.runInContext(source, realm) }
        catch (error) { listeners.forEach((listener) => listener({ filename: script.src, message: String(error) })) }
        script.onload()
      })
    } },
  },
})
URL.createObjectURL = (blob: Blob) => { const id = `blob:${crypto.randomUUID()}`; sources.set(id, blob); return id }
URL.revokeObjectURL = (url: string) => { sources.delete(url) }
const { loadPackageModule } = await import('../src/package-loader.ts')

function payload(version = '1.0.0') {
  const manifest = { id: 'test.external', name: 'External', version, entrypoints: ['page'] as ['page'], permissions: [] as [], minPlatformVersion: '0.2.0' }
  return { manifest, entry: `var WorkbenchCapability = { manifest: ${JSON.stringify(manifest)}, Page: function Page() {} };`, styles: '' }
}

test('loads successive versions with a non-configurable global export and releases resources', async () => {
  const first = await loadPackageModule(payload())
  const second = await loadPackageModule(payload('1.1.0'))
  assert.equal(first.manifest.version, '1.0.0')
  assert.equal(second.manifest.version, '1.1.0')
  assert.equal(realm.WorkbenchCapability, undefined)
  assert.equal(sources.size, 0)
  assert.equal(listeners.size, 0)
})

test('rejects executable errors and manifest mismatches without preventing subsequent loads', async () => {
  await assert.rejects(loadPackageModule({ ...payload(), entry: "throw new Error('broken bundle')" }), /broken bundle/)
  await assert.rejects(loadPackageModule({ ...payload('2.0.0'), entry: payload().entry }), /does not match/)
  const valid = await loadPackageModule(payload())
  assert.equal(valid.manifest.id, 'test.external')
  assert.equal(sources.size, 0)
  assert.equal(listeners.size, 0)
})
