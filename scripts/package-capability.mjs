import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdtemp, readFile, writeFile, mkdir, copyFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const directory = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Usage: npm run capability:pack -- <capability-directory> [output-directory]')
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(manifest.id) || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid package identity or version')
const output = resolve(process.argv[3] ?? 'dist/capabilities')
const temporary = await mkdtemp(join(tmpdir(), 'workbench-package-'))
try {
  const entry = join(temporary, 'index.ts')
  await writeFile(entry, `export { default } from ${JSON.stringify(join(directory, 'index.tsx'))}\n`)
  await build({
    configFile: false,
    plugins: [react(), {
      name: 'capability-contract-only',
      resolveId(source) {
        if (source.startsWith('@tauri-apps/') || source.startsWith('node:')) throw new Error(`Capabilities must use CapabilityHost instead of ${source}`)
      },
    }],
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      outDir: join(temporary, 'package'), emptyOutDir: true,
      lib: { entry, name: 'WorkbenchCapability', formats: ['iife'], fileName: () => 'entry.js', cssFileName: 'style' },
      rollupOptions: {
        external: ['react', 'react/jsx-runtime'],
        output: { exports: 'default', globals: { react: 'WorkbenchReact', 'react/jsx-runtime': 'WorkbenchJSXRuntime' } },
      },
    },
  })
  await copyFile(join(directory, 'manifest.json'), join(temporary, 'package', 'manifest.json'))
  const files = await readdir(join(temporary, 'package'))
  if (files.some((file) => !['entry.js', 'style.css', 'manifest.json'].includes(file))) throw new Error('Package must be self-contained: inline assets and dependencies')
  await mkdir(output, { recursive: true })
  const archive = join(output, `${manifest.id}-${manifest.version}.capability.zip`)
  // Python's standard library is used only by this developer packaging command.
  execFileSync('python3', ['-c', 'import sys,zipfile,pathlib\nwith zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED) as z:\n for p in sorted(pathlib.Path(sys.argv[2]).iterdir()): z.write(p,p.name)', archive, join(temporary, 'package')])
  console.log(`Package: ${archive}`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
