import assert from 'node:assert/strict'
import test from 'node:test'
import { settingsSections, visibleSections } from '../src/features/settings/settings-sections.ts'

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
