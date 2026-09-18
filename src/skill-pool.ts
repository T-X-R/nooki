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

export type SkillDetail = {
  name: string
  title: string
  description: string
  directory: string
  files: string[]
  content: string
  truncated: boolean
}

export type SkillFile = {
  path: string
  kind: 'markdown' | 'text' | 'image' | 'binary'
  content: string
  truncated: boolean
  sizeBytes: number
}

export type SkillField = { key: string; value: string }

/** The frontmatter a skill declares about itself, read as a card above its instructions rather than as YAML.
 *  Only the shapes skills actually use are understood: plain values, quoted values, block scalars and lists. */
export function skillFrontmatter(content: string): SkillField[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!/^---\n/.test(normalized)) return []
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) return []
  const lines = normalized.slice(4, end).split('\n')
  const fields: SkillField[] = []
  const unquote = (value: string) => /^(['"])([\s\S]*)\1$/.exec(value.trim())?.[2] ?? value.trim()
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^([A-Za-z_][\w .-]*):[ \t]*(.*)$/.exec(lines[index])
    if (!opening) continue
    const key = opening[1].trim()
    const folded = /^[|>][-+]?$/.test(opening[2].trim())
    let value = folded ? '' : unquote(opening[2])
    const parts: string[] = []
    while (index + 1 < lines.length && (/^[ \t]+\S/.test(lines[index + 1]) || (folded && !lines[index + 1].trim()))) {
      index += 1
      const line = lines[index].trim()
      parts.push(line.startsWith('- ') ? line.slice(2).trim() : line)
    }
    if (parts.length) {
      const listed = parts.every((part) => part.length) && lines.slice(index - parts.length + 1, index + 1).every((line) => line.trim().startsWith('- '))
      const joined = listed ? parts.map(unquote).join(', ') : parts.join(folded && opening[2].trim().startsWith('>') ? ' ' : '\n').trim()
      value = value ? `${value} ${joined}` : joined
    }
    if (key && value) fields.push({ key, value: unquote(value) })
  }
  return fields
}

/** A skill declares itself in frontmatter; the reader shows that as a heading, not as body text. */
export function skillBody(content: string): string {
  const normalized = content.replace(/^\uFEFF/, '')
  if (!/^---\r?\n/.test(normalized)) return content
  const end = normalized.search(/\r?\n---[ \t]*(\r?\n|$)/)
  if (end === -1) return content
  return normalized.slice(end).replace(/^\r?\n---[ \t]*/, '').replace(/^(\r?\n)+/, '')
}

/** The dialog is already named after the skill, so a body that opens by repeating that name loses the repetition. */
export function skillInstructions(content: string, ...names: string[]): string {
  const body = skillBody(content)
  const opening = /^[ \t]*#[ \t]+(.+?)[ \t]*(\r?\n|$)/.exec(body)
  if (!opening) return body
  const simplify = (value: string) => value.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '')
  const heading = simplify(opening[1])
  if (!heading || !names.some((name) => simplify(name) === heading)) return body
  return body.slice(opening[0].length).replace(/^(\r?\n)+/, '')
}

/** SKILL.md first, then folder by folder, so a 255-file skill still reads in an order. */
export function orderSkillFiles(files: string[]): string[] {
  const weight = (path: string) => (path === 'SKILL.md' ? 0 : path.includes('/') ? 2 : 1)
  return [...files].sort((a, b) => weight(a) - weight(b) || a.localeCompare(b))
}

export function fileLabel(path: string): { folder: string; name: string } {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? { folder: '', name: path } : { folder: path.slice(0, cut), name: path.slice(cut + 1) }
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
