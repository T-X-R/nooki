import { readdir, readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function kitFiles() {
  const files = {}
  const collect = async (directory, prefix = '') => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.DS_Store'].includes(item.name)) continue
      const name = prefix + item.name
      if (item.isDirectory()) await collect(join(directory, item.name), `${name}/`)
      else if (item.isFile()) files[name] = await readFile(join(directory, item.name), 'utf8')
      else throw new Error(`Kit resources must be regular files: ${name}`)
    }
  }
  await collect(join(root, 'skills/workbench-capability-dev'))
  const kit = JSON.parse(files['kit.json'])
  files['assets/starter/workbench.json'] = files['kit.json']
  const platform = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (kit.platformVersion !== platform.version) throw new Error('Update kit compatibility for this Nooki version')
  const starter = JSON.parse(files['assets/starter/package.json'])
  for (const group of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(starter[group])) {
      if (platform[group]?.[name]) starter[group][name] = platform[group][name]
    }
  }
  files['assets/starter/package.json'] = `${JSON.stringify(starter, null, 2)}\n`
  for (const [source, target] of [
    ['packages/capability-contract/src/index.ts', 'assets/starter/contract/index.ts'],
    ['packages/capability-contract/src/references.ts', 'assets/starter/contract/references.ts'],
    ['packages/capability-ui/src/index.tsx', 'assets/starter/ui/index.tsx'],
    ['packages/capability-ui/src/style.css', 'assets/starter/ui/style.css'],
    ['scripts/package-capability.mjs', 'assets/starter/scripts/package-capability.mjs'],
    ['packages/capability-contract/README.md', 'references/contract.md'],
    ['INFRASTRUCTURE.md', 'references/infrastructure.md'],
  ]) files[target] = await readFile(join(root, source), 'utf8')
  files['assets/starter/ui/index.tsx'] = files['assets/starter/ui/index.tsx'].replace('../../capability-contract/src', '../contract')
  files['references/contract.md'] = files['references/contract.md'].replaceAll('../../INFRASTRUCTURE.md', 'infrastructure.md').replaceAll('../../packages/capability-contract/src', '../assets/starter/contract')
  const css = await readFile(join(root, 'src/styles.css'), 'utf8')
  files['assets/starter/preview/theme.css'] = css.slice(css.indexOf(':root {'), css.indexOf('* { box-sizing'))
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] ?? 'dist/workbench-capability-dev.zip')
  const files = await kitFiles()
  await mkdir(dirname(output), { recursive: true })
  if (output.endsWith('.json')) await writeFile(output, JSON.stringify(files))
  else {
    const temporary = await mkdtemp(join(tmpdir(), 'workbench-kit-'))
    try {
      const manifest = join(temporary, 'files.json')
      await writeFile(manifest, JSON.stringify(files))
      execFileSync('python3', ['-c', 'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for p,c in json.load(open(sys.argv[1])).items(): z.writestr("workbench-capability-dev/"+p,c)', manifest, output])
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }
  console.log(`Developer kit: ${output}`)
}
