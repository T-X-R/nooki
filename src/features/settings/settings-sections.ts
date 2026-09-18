// Which Settings section belongs to which group, as data rather than as layout.
//
// Two groups carry the whole correction the Settings spec asks for: a person reading "This machine"
// cannot mistake what follows for a Nooki preference, and a person reading "Capability model access"
// cannot mistake it for what Conversations use. Keeping the rule here, away from JSX, is what lets a
// test state it.

export type SettingsGroup = 'machine' | 'nooki'

export type SettingsSectionId =
  | 'agent-tools'
  | 'skills'
  | 'mcp'
  | 'conventions'
  | 'model-access'
  | 'appearance'
  | 'language'
  | 'local-data'

export type SettingsSection = {
  id: SettingsSectionId
  group: SettingsGroup
  /** Named now so the structure is decided once; it offers no control until its asset arrives. */
  reserved?: boolean
  /** Reads or writes the machine outside Nooki, so it has nothing to show in a browser preview. */
  desktopOnly?: boolean
}

/** Declaration order is display order. */
export const settingsSections: readonly SettingsSection[] = [
  { id: 'agent-tools', group: 'machine', desktopOnly: true },
  { id: 'skills', group: 'machine', desktopOnly: true },
  { id: 'mcp', group: 'machine', desktopOnly: true, reserved: true },
  { id: 'conventions', group: 'machine', desktopOnly: true, reserved: true },
  { id: 'model-access', group: 'nooki' },
  { id: 'appearance', group: 'nooki' },
  { id: 'language', group: 'nooki' },
  { id: 'local-data', group: 'nooki' },
]

export const settingsGroups: readonly SettingsGroup[] = ['machine', 'nooki']

/**
 * A correction belongs on the control that invites the wrong conclusion, not on the group heading
 * above it. Someone choosing an agent for Capabilities is one click from assuming Conversations
 * follow; the sentence that says otherwise has to be right there.
 */
export type ScopeNote = { id: 'conversations' | 'quota'; section: SettingsSectionId }

export const scopeNotes: readonly ScopeNote[] = [
  { id: 'conversations', section: 'model-access' },
  { id: 'quota', section: 'model-access' },
]

export function sectionsInGroup(group: SettingsGroup): SettingsSection[] {
  return settingsSections.filter((section) => section.group === group)
}

export function groupOf(id: SettingsSectionId): SettingsGroup {
  const section = settingsSections.find((candidate) => candidate.id === id)
  if (!section) throw new Error(`Unknown settings section: ${id}`)
  return section.group
}

/** A browser preview shows only what it can actually tell the truth about. */
export function visibleSections(group: SettingsGroup, desktop: boolean): SettingsSection[] {
  return sectionsInGroup(group).filter((section) => desktop || !section.desktopOnly)
}

export function notesFor(id: SettingsSectionId): ScopeNote[] {
  return scopeNotes.filter((note) => note.section === id)
}
