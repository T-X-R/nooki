import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let server: ViteDevServer
let components: any
before(async () => {
  server = await createServer({ configFile:false,plugins:[react()],server:{middlewareMode:true},appType:'custom',logLevel:'silent' })
  components = await server.ssrLoadModule('/src/features/task-board/TaskDeliveries.tsx')
})
after(async () => { await server?.close() })

test('retained Markdown renders text without live resources, links, HTML or task controls', () => {
  const content = '# Original notes\n\n[Source](https://example.invalid/current)\n\n![diagram](https://example.invalid/live.png)\n\n<script>alert(1)</script>\n\n<iframe src="https://example.invalid/frame"></iframe>\n\n- [x] Reviewed\n'
  const html = renderToStaticMarkup(createElement(components.RetainedText, {content,zh:false}))
  assert.match(html, /Original notes/);assert.match(html, /Source/);assert.match(html,/https:\/\/example.invalid\/current/)
  assert.match(html,/Image not included in retained text/);assert.match(html,/☑/)
  assert.doesNotMatch(html, /<(?:a|img|script|iframe|input|button)\b/)
})
test('delivery summaries use retained provenance and defer rendering unopened bodies', () => {
  const deliveries=[{id:'delivery',title:'Saved notes',createdAt:'2026-11-26T00:00:00Z',provenance:{type:'capability',capabilityId:'example.removed',capabilityVersion:'1.0.0'},documents:[{reference:{kind:'library-document',documentId:'deleted-original',title:'Original document'},documentDate:'2026-11-26',content:'Retained original body'}]}]
  const before=structuredClone(deliveries)
  const html=renderToStaticMarkup(createElement(components.TaskDeliveries,{deliveries,zh:false}))
  assert.match(html, /Attached deliveries/);assert.match(html,/example.removed/);assert.match(html,/<details/);assert.match(html,/<summary>Original document/)
  assert.doesNotMatch(html,/Retained original body/);assert.deepEqual(deliveries,before)
  assert.equal(renderToStaticMarkup(createElement(components.TaskDeliveries,{deliveries:[],zh:true})), '')
})
test('empty retained text has a localized state', () => {
  assert.match(renderToStaticMarkup(createElement(components.RetainedText,{content:'',zh:true})),/此文档没有正文/)
  assert.match(renderToStaticMarkup(createElement(components.RetainedText,{content:'',zh:false})),/This document has no text/)
  assert.match(renderToStaticMarkup(createElement(components.RetainedText,{content:' \n ',zh:false})),/This document has no text/)
})
