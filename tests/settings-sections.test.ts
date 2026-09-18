import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupOf,
  notesFor,
  scopeNotes,
  settingsGroups,
  settingsSections,
  sectionsInGroup,
  visibleSections,
  type SettingsSectionId,
} from '../src/features/settings/settings-sections.ts'

test('every section belongs to exactly one group', () => {
  for (const section of settingsSections) {
    const containing = settingsGroups.filter((group) => sectionsInGroup(group).includes(section))
    assert.deepEqual(containing, [section.group])
  }
})

test('no section is declared twice', () => {
  const ids = settingsSections.map((section) => section.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('the machine group holds what is shared with other agents', () => {
  assert.deepEqual(
    sectionsInGroup('machine').map((section) => section.id),
    ['agent-tools', 'skills', 'mcp', 'conventions'],
  )
})

test('nothing in the Nooki group reaches outside Nooki', () => {
  assert.equal(sectionsInGroup('nooki').some((section) => section.desktopOnly), false)
})

test('a browser preview hides the sections it cannot tell the truth about', () => {
  assert.deepEqual(visibleSections('machine', false), [])
  assert.equal(visibleSections('machine', true).length, sectionsInGroup('machine').length)
  assert.deepEqual(visibleSections('nooki', false), sectionsInGroup('nooki'))
})

test('a reserved section is only ever in the machine group', () => {
  for (const section of settingsSections.filter((candidate) => candidate.reserved)) {
    assert.equal(section.group, 'machine')
  }
})

test('scope notes sit on the control that invites the wrong conclusion', () => {
  assert.deepEqual(notesFor('model-access').map((note) => note.id), ['conversations', 'quota'])
  for (const note of scopeNotes) {
    assert.equal(groupOf(note.section), 'nooki')
  }
})

test('every scope note names a section that exists', () => {
  const ids = new Set<string>(settingsSections.map((section) => section.id))
  for (const note of scopeNotes) assert.equal(ids.has(note.section), true)
})

test('an unknown section has no group rather than a default one', () => {
  assert.throws(() => groupOf('nowhere' as SettingsSectionId), /Unknown settings section/)
})
