// Syntax colouring for the skill reader. Markdown fences go through rehype-highlight, and the plain file
// viewer goes through the same lowlight registry, so a `.json` file and a ```json fence look alike.
import { createLowlight } from 'lowlight'
import type { Root } from 'hast'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/** The languages a skill actually ships: instructions, data, scripts and config. Loading only these keeps
 *  highlight.js from dragging 190 grammars into the bundle. */
export const codeLanguages = {
  bash, css, diff, dockerfile, go, ini, java, javascript, json, markdown, python, ruby, rust, sql, typescript, xml, yaml,
}

const lowlight = createLowlight(codeLanguages)

/** Files that name their language instead of carrying an extension. */
const byFilename: Record<string, string> = {
  dockerfile: 'dockerfile', makefile: 'bash', procfile: 'bash', gemfile: 'ruby', rakefile: 'ruby',
  '.gitignore': 'bash', '.env': 'ini', '.editorconfig': 'ini', '.npmrc': 'ini',
}

const byExtension: Record<string, string> = {
  mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript', jsonl: 'json', ndjson: 'json',
  ipynb: 'json', webmanifest: 'json', lock: 'yaml', cfg: 'ini', conf: 'ini', properties: 'ini', env: 'ini',
  htm: 'xml', vue: 'xml', plist: 'xml', patch: 'diff', zsh: 'bash', fish: 'bash', txt: '', log: '', csv: '',
}

/** The language for a file inside a skill, or an empty string when it should stay plain. */
export function languageForPath(path: string): string {
  const file = (path.split('/').pop() ?? '').toLowerCase()
  if (byFilename[file]) return byFilename[file]
  const extension = file.includes('.') ? (file.split('.').pop() ?? '') : file
  if (extension in byExtension) return byExtension[extension]
  return lowlight.registered(extension) ? extension : ''
}

/** A fence info string can carry more than a name: ```js title="x" still means JavaScript. */
export function fenceLanguage(className: string): string {
  const name = /language-([^\s]+)/.exec(className)?.[1]?.toLowerCase() ?? ''
  return name && lowlight.registered(name) ? name : ''
}

/** Highlighted markup for one file, and plain text whenever the language is unknown or broken. */
export function highlightCode(code: string, language: string): Root {
  if (language && lowlight.registered(language)) {
    try { return lowlight.highlight(language, code) } catch { /* fall through to plain text */ }
  }
  return { type: 'root', children: [{ type: 'text', value: code }] }
}
