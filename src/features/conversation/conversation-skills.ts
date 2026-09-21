// Picking a skill in the composer, the way the CLI underneath would have been asked for one.
//
// Nooki neither reads nor rewrites a skill here. It recognises the mention the person typed, offers
// the pool to choose from, and hands the chosen names to the host, which says them in the agent's
// own words. Whatever the person typed stays in the message exactly as typed.
import type { PoolSkill } from '../skills/skill-pool.ts'

/** Both triggers are offered because a person arrives with one CLI's habit: `$` from Codex, `/` from Claude Code and pi. */
export const SKILL_TRIGGERS = ['$', '/'] as const

export type SkillMention = { start: number; end: number; query: string }

const NAME = /^[A-Za-z0-9._-]*$/

/** The mention being typed at the caret, or null when the caret is not inside one. */
export function skillMention(text: string, caret: number): SkillMention | null {
  let start = caret
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1
  const token = text.slice(start, caret)
  if (!token || !SKILL_TRIGGERS.includes(token[0] as (typeof SKILL_TRIGGERS)[number])) return null
  // pi spells its own command `/skill:name`; typing it that way should still find the skill.
  const query = token.slice(1).replace(/^skill:/, '')
  if (!NAME.test(query)) return null
  return { start, end: caret, query }
}

/** Replace the mention being typed with the pool skill the person chose. */
export function applySkillMention(text: string, mention: SkillMention, skill: PoolSkill): { text: string; caret: number } {
  const token = `${text[mention.start]}${skill.name}`
  const spaced = text.slice(mention.end).startsWith(' ') ? '' : ' '
  return { text: `${text.slice(0, mention.start)}${token}${spaced}${text.slice(mention.end)}`, caret: mention.start + token.length + spaced.length }
}

export function matchSkills(skills: PoolSkill[], query: string): PoolSkill[] {
  const needle = query.trim().toLowerCase()
  const usable = skills.filter((skill) => !skill.issue)
  if (!needle) return usable
  return usable
    .filter((skill) => `${skill.name} ${skill.title} ${skill.description}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)))
}

/** The pool skills a finished message names, in the order they appear and without repeats. */
export function attachedSkills(text: string, skills: PoolSkill[]): string[] {
  const attached: string[] = []
  for (const token of text.split(/\s+/)) {
    if (!token || !SKILL_TRIGGERS.includes(token[0] as (typeof SKILL_TRIGGERS)[number])) continue
    const wanted = token.slice(1).replace(/^skill:/, '').replace(/[.,;:!?)\]]+$/, '')
    if (!wanted) continue
    const found = skills.find((skill) => skill.name === wanted) ?? skills.find((skill) => skill.title === wanted)
    if (found && !found.issue && !attached.includes(found.name)) attached.push(found.name)
  }
  return attached
}
