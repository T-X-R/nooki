import assert from 'node:assert/strict'
import { test } from 'node:test'
import { conversationGreetings, createGreetingRotation } from '../src/conversation-greetings.ts'
const fresh = { fresh: true, hasDocuments: false, hasText: false }

test('every opening has both languages and ordinary openings never mention documents', () => {
  assert.ok(conversationGreetings.length >= 12)
  assert.ok(conversationGreetings.every((g) => g.zh && g.en))
  const rotation = createGreetingRotation(() => 0.9)
  for (let i = 0; i < 30; i++) assert.ok(!rotation.get('new', fresh).documentsOnly)
})
test('new openings exclude the five most recently shown', () => {
  const rotation = createGreetingRotation(() => 0)
  const seen = []
  for (let i = 0; i < 30; i++) {
    const greeting = rotation.get('new', fresh)
    assert.ok(!seen.slice(-5).includes(greeting))
    seen.push(greeting)
  }
})
test('navigation, typing and language selection preserve the same opening', () => {
  const rotation = createGreetingRotation(() => 0)
  const greeting = rotation.get('new', fresh)
  assert.equal(rotation.get('new', { ...fresh, fresh: false }), greeting)
  assert.equal(rotation.get('new', { ...fresh, hasText: true }), greeting)
  assert.ok(greeting.zh && greeting.en)
  rotation.clearDraft()
  assert.notEqual(rotation.get('new', { ...fresh, fresh: false }), greeting)
})
test('document-specific opening requires attachments and falls back when removed', () => {
  const rotation = createGreetingRotation(() => 10 / 12)
  assert.ok(rotation.get('new', { ...fresh, hasDocuments: true }).documentsOnly)
  assert.ok(!rotation.get('new', { ...fresh, fresh: false }).documentsOnly)
})
