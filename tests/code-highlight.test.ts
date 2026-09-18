import assert from 'node:assert/strict'
import test from 'node:test'
import { toText } from 'hast-util-to-text'
import { fenceLanguage, highlightCode, languageForPath } from '../src/shared/code-highlight.ts'

const classes = (tree: ReturnType<typeof highlightCode>): string[] => {
  const found: string[] = []
  const walk = (nodes: unknown[]) => {
    for (const node of nodes as { type: string; properties?: { className?: string[] }; children?: unknown[] }[]) {
      if (node.type === 'element') found.push(...(node.properties?.className ?? []))
      if (node.children) walk(node.children)
    }
  }
  walk(tree.children)
  return found
}

test('a file names its language by extension, by filename, or not at all', () => {
  assert.equal(languageForPath('rules/药品规则.json'), 'json')
  assert.equal(languageForPath('scripts/build.py'), 'py', 'an alias highlight.js knows is good enough')
  assert.equal(languageForPath('src/app.tsx'), 'tsx')
  assert.equal(languageForPath('Dockerfile'), 'dockerfile')
  assert.equal(languageForPath('config/settings.toml'), 'toml')
  assert.equal(languageForPath('notes.txt'), '')
  assert.equal(languageForPath('LICENSE'), '')
})

test('a fence info string is trusted only when it names a language we loaded', () => {
  assert.equal(fenceLanguage('language-json'), 'json')
  assert.equal(fenceLanguage('language-TS'), 'ts')
  assert.equal(fenceLanguage('language-brainfuck'), '')
  assert.equal(fenceLanguage('hljs'), '')
})

test('json keys and strings come back as separate tokens', () => {
  const tree = highlightCode('{"filename": "药品规则.xlsx", "rows": 12}', 'json')
  assert.equal(toText(tree), '{"filename": "药品规则.xlsx", "rows": 12}')
  assert.ok(classes(tree).includes('hljs-attr'), 'a key is an attribute')
  assert.ok(classes(tree).includes('hljs-number'), 'a number is a number')
})

test('an unknown language keeps the file readable as plain text', () => {
  const tree = highlightCode('anything at all', 'brainfuck')
  assert.deepEqual(tree.children, [{ type: 'text', value: 'anything at all' }])
})
