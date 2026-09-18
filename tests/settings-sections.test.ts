import assert from 'node:assert/strict'
import test from 'node:test'
import {
  notesFor,
  scopeNotes,
  settingsSections,
  visibleSections,
} from '../src/features/settings/settings-sections.ts'

test('no section is declared twice', () => {
  const ids = settingsSections.map((section) => section.id)
  assert.deepEqual([...new Set(ids)], ids)
})

test('settings covers only what Nooki itself uses', () => {
  assert.deepEqual(settingsSections.map((section) => section.id), ['agent-access', 'appearance', 'language', 'local-data'])
})

test('a browser preview hides what it cannot look at', () => {
  assert.deepEqual(visibleSections(false).map((section) => section.id), ['appearance', 'language', 'local-data'])
  assert.deepEqual(visibleSections(true).map((section) => section.id), settingsSections.map((section) => section.id))
})

test('every scope note names a section that exists', () => {
  for (const note of scopeNotes) {
    assert.ok(settingsSections.some((section) => section.id === note.section), note.id)
  }
})

test('both corrections sit on the agent choice, where the wrong conclusion is drawn', () => {
  assert.deepEqual(notesFor('agent-access').map((note) => note.id), ['conversations', 'quota'])
  assert.deepEqual(notesFor('appearance'), [])
})
