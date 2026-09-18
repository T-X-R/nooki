// What Settings shows, in order, as data rather than as layout.
//
// Settings answers one question: what does Nooki itself use. It is not a console for the machine.
// Skills have their own page, and the agents have their own configuration, in their own tools.
//
// The part worth keeping out of JSX is where a correction lands. A person choosing an agent is one
// click from assuming Conversations follow it; the sentence saying otherwise has to sit on that
// control, not in a heading above it or a document nobody opens.

export type SettingsSectionId = 'agent-access' | 'appearance' | 'language' | 'local-data'

export type SettingsSection = {
  id: SettingsSectionId
  /** Reads the machine outside Nooki, so it has nothing honest to show in a browser preview. */
  desktopOnly?: boolean
}

/** Declaration order is display order. */
export const settingsSections: readonly SettingsSection[] = [
  { id: 'agent-access', desktopOnly: true },
  { id: 'appearance' },
  { id: 'language' },
  { id: 'local-data' },
]

export type ScopeNote = { id: 'conversations' | 'quota'; section: SettingsSectionId }

export const scopeNotes: readonly ScopeNote[] = [
  { id: 'conversations', section: 'agent-access' },
  { id: 'quota', section: 'agent-access' },
]

/** A browser preview shows only what it can actually tell the truth about. */
export function visibleSections(desktop: boolean): SettingsSection[] {
  return settingsSections.filter((section) => desktop || !section.desktopOnly)
}

export function notesFor(id: SettingsSectionId): ScopeNote[] {
  return scopeNotes.filter((note) => note.section === id)
}
