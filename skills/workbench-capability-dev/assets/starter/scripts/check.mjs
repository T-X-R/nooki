import { readFile, readdir } from 'node:fs/promises'
import { resolve, join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import ts from 'typescript'
import postcss from 'postcss'

export function validateManifest(manifest) {
  const fail = (condition, message) => { if (!condition) throw new Error(message) }
  fail(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(manifest.id), 'Use a reverse-domain capability ID')
  fail(!manifest.id.startsWith('workbench.'), 'The workbench namespace is reserved')
  fail(/^\d+\.\d+\.\d+$/.test(manifest.version), 'Use a numeric major.minor.patch version')
  fail(/^\d+\.\d+\.\d+$/.test(manifest.minPlatformVersion), 'Set minPlatformVersion')
  fail(typeof manifest.name === 'string' && manifest.name.trim(), 'Set a capability name')
  fail(Array.isArray(manifest.entrypoints) && manifest.entrypoints.includes('page') && manifest.entrypoints.every((entry) => ['page', 'job'].includes(entry)), 'Package v1 supports page and optional job')
  const permissions = ['storage', 'activity.read', 'activity.write', 'ai.invoke', 'codex.sessions.read', 'documents.publish', 'documents.read-selected']
  fail(Array.isArray(manifest.permissions) && manifest.permissions.every((p) => permissions.includes(p)), 'Unknown capability permission')
  for (const language of ['zh', 'en']) fail(manifest.locales?.[language]?.name?.trim(), `Set locales.${language}.name`)
}

export function validateStyle(source, name) {
  postcss.parse(source, { from: name }).walkRules((rule) => {
    if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return
    if (rule.selectors.some((selector) => !/^\.wb-cap-page(?=[\s.#:[>+~]|$)/.test(selector.trim()) || /(^|[\s,>+~])(body|html|:root)(?=[\s.#:[>+~]|$)/.test(selector))) {
      throw new Error(`${name}: scope CSS selectors under your capability root class`)
    }
  })
}

export async function check(directory = process.cwd()) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  validateManifest(manifest)
  const kit = JSON.parse(await readFile(join(directory, 'workbench.json'), 'utf8'))
  const version = (value) => value.split('.').map(Number)
  const minimum = version(manifest.minPlatformVersion), supported = version(kit.platformVersion)
  for (let index = 0; index < 3; index++) {
    if (minimum[index] > supported[index]) throw new Error(`Kit targets Workbench ${kit.platformVersion}; requested minimum is newer`)
    if (minimum[index] < supported[index]) break
  }
  const visit = async (path) => {
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'preview', 'scripts', '.git'].includes(item.name)) continue
      const file = join(path, item.name)
      if (item.isDirectory()) { await visit(file); continue }
      if (file.endsWith('.css')) validateStyle(await readFile(file, 'utf8'), file)
      if (!/\.[cm]?[jt]sx?$/.test(file)) continue
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true)
      const scan = (node) => {
        let specifier
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier = node.moduleSpecifier
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require')) specifier = node.arguments[0]
        if (specifier && ts.isStringLiteral(specifier)) {
          const value = specifier.text
          if (value.startsWith('@tauri-apps/') || value.startsWith('node:') || builtinModules.includes(value) || /^(https?:|\/)/.test(value) || value.includes('capability-host')) throw new Error(`${file}: use CapabilityHost instead of ${value}`)
          if (value.startsWith('.') && !resolve(dirname(file), value).startsWith(resolve(directory) + sep)) throw new Error(`${file}: imports must remain inside the capability project`)
        }
        ts.forEachChild(node, scan)
      }
      scan(source)
    }
  }
  await visit(resolve(directory))
  console.log(`Checked ${manifest.id} ${manifest.version}. Desktop verification is still required.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await check()
