import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CopyableCodeBlock, codeBlockText } from '../src/features/conversation/CopyableCodeBlock.ts'

test('copyable code blocks preserve nested code text and remove only the markdown fence newline', () => {
  const content = createElement('code', null, '/tmp/nooki/', createElement('span', null, 'package.json'), '\n')
  assert.equal(codeBlockText(content), '/tmp/nooki/package.json')
  assert.equal(codeBlockText(createElement('code', null, 'line one\n\n')), 'line one\n')
})

test('copyable code blocks render an accessible copy action without changing the code', () => {
  const markup = renderToStaticMarkup(createElement(
    CopyableCodeBlock,
    { zh: true },
    createElement('code', { className: 'language-json' }, '{"ready": true}\n'),
  ))

  assert.match(markup, /class="conversation-code-block"/)
  assert.match(markup, /aria-label="复制内容"/)
  assert.match(markup, /<pre><code class="language-json">\{&quot;ready&quot;: true\}\n<\/code><\/pre>/)
})
