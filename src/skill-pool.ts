// Shapes and pure reasoning for the Skill Pool. Filesystem work stays in the desktop host.
export type PoolSkill = {
  name: string
  title: string
  description: string
  fileCount: number
  updatedAt: string
  issue: string | null
}

export type EntryState = 'mirror' | 'modified' | 'linked' | 'foreign' | 'unreadable'

export type ToolEntry = { name: string; state: EntryState; description: string }

export type ToolView = {
  id: string
  name: string
  directory: string
  detected: boolean
  readsPool: boolean
  custom: boolean
  selected: string[]
  entries: ToolEntry[]
  error: string | null
}

export type DuplicateKind = 'adopt' | 'name' | 'modified' | 'linked' | 'content'

export type Duplicate = {
  kind: DuplicateKind
  name: string
  toolId: string
  toolName: string
  directory: string
  description: string
  poolName: string
  differingFiles: string[]
}

export type Overview = {
  poolDirectory: string
  poolExists: boolean
  skills: PoolSkill[]
  tools: ToolView[]
  duplicates: Duplicate[]
  notices: string[]
}

export type Removal = { toolId: string; toolName: string; state: string }

export type DeleteReport = { name: string; trash: string; removed: Removal[]; kept: Removal[] }

export const emptyOverview: Overview = { poolDirectory: '', poolExists: false, skills: [], tools: [], duplicates: [], notices: [] }

/** Tools that receive copies. A tool reading the pool directly already sees every skill. */
export function distributableTools(overview: Overview): ToolView[] {
  return overview.tools.filter((tool) => tool.detected && !tool.readsPool)
}

export function detectedTools(overview: Overview): ToolView[] {
  return overview.tools.filter((tool) => tool.detected)
}

export function isSelected(tool: ToolView, skill: string): boolean {
  return tool.readsPool || tool.selected.includes(skill)
}

/** The selection a tool should end up with after one checkbox changes. */
export function nextSelection(tool: ToolView, skill: string, wanted: boolean): string[] {
  const selected = tool.selected.filter((name) => name !== skill)
  return wanted ? [...selected, skill].sort() : selected
}

export function toolSummary(tool: ToolView): Record<EntryState, number> {
  const summary: Record<EntryState, number> = { mirror: 0, modified: 0, linked: 0, foreign: 0, unreadable: 0 }
  for (const entry of tool.entries) summary[entry.state] += 1
  return summary
}

/** Decisions waiting on the person, most disruptive first. */
export function pendingDecisions(overview: Overview): Duplicate[] {
  const order: Record<DuplicateKind, number> = { name: 0, modified: 1, linked: 2, adopt: 3, content: 4 }
  return [...overview.duplicates].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name) || a.toolId.localeCompare(b.toolId))
}

export type DecisionGroup = { key: string; kind: DuplicateKind; toolId: string; toolName: string; items: Duplicate[] }

/** One card per kind and tool, so 48 hand-made links do not become 48 separate decisions. */
export function groupDecisions(overview: Overview): DecisionGroup[] {
  const groups: DecisionGroup[] = []
  for (const duplicate of pendingDecisions(overview)) {
    const key = `${duplicate.kind}:${duplicate.toolId}`
    const group = groups.find((candidate) => candidate.key === key)
    if (group) group.items.push(duplicate)
    else groups.push({ key, kind: duplicate.kind, toolId: duplicate.toolId, toolName: duplicate.toolName, items: [duplicate] })
  }
  return groups
}

/** Which tools would lose a skill if it were deleted now. */
export function holders(overview: Overview, skill: string): ToolView[] {
  return detectedTools(overview).filter((tool) => (tool.readsPool ? overview.skills.some((pooled) => pooled.name === skill) : tool.entries.some((entry) => entry.name === skill && entry.state !== 'foreign')))
}

export function searchSkills(skills: PoolSkill[], query: string): PoolSkill[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return skills
  return skills.filter((skill) => `${skill.name} ${skill.title} ${skill.description}`.toLowerCase().includes(needle))
}
