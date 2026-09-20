// What Settings shows, in order, as data rather than as layout.
//
// Settings answers one question: what does Nooki itself use. It is not a console for the machine.
// Skills have their own page, and the agents keep their own configuration in their own tools.
//
// An earlier version carried a list of scope notes here, so that a test could assert the correction
// about Conversations sat on the right control. The correction now lives in that section's intro
// line, which is where a person reads it anyway, and a rule that exists in one sentence does not
// need a registry to hold it.

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

/** A browser preview shows only what it can actually tell the truth about. */
export function visibleSections(desktop: boolean): SettingsSection[] {
  return settingsSections.filter((section) => desktop || !section.desktopOnly)
}
