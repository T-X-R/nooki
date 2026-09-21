import { strict as assert } from 'node:assert'
import test from 'node:test'
import { applySkillMention, attachedSkills, matchSkills, skillMention } from '../src/features/conversation/conversation-skills.ts'
import type { PoolSkill } from '../src/features/skills/skill-pool.ts'

const skill = (name: string, title = name, issue: string | null = null): PoolSkill => ({ name, title, description: `${name} does things`, fileCount: 1, updatedAt: '', issue })
const pool: PoolSkill[] = [skill('pdf-tools', 'pdf'), skill('planning-and-task-breakdown'), skill('broken', 'broken', 'No SKILL.md with frontmatter')]

test('a mention is recognised from either CLI habit, and only inside a token', () => {
  assert.deepEqual(skillMention('$pdf', 4), { start: 0, end: 4, query: 'pdf' })
  assert.deepEqual(skillMention('hello /pla', 10), { start: 6, end: 10, query: 'pla' })
  // pi spells its own command out; typing it that way still finds the skill.
  assert.equal(skillMention('/skill:pdf', 10)?.query, 'pdf')
  // A bare trigger opens the whole pool.
  assert.equal(skillMention('write $', 7)?.query, '')
  assert.equal(skillMention('costs $5 and /2 lines', 21), null)
  assert.equal(skillMention('no mention here', 15), null)
  assert.equal(skillMention('a/path/inside', 13), null)
})

test('choosing a skill replaces the mention and leaves the trigger the person typed', () => {
  assert.deepEqual(applySkillMention('$pd', skillMention('$pd', 3)!, pool[0]), { text: '$pdf-tools ', caret: 11 })
  assert.deepEqual(applySkillMention('use /pl now', skillMention('use /pl', 7)!, pool[1]), { text: 'use /planning-and-task-breakdown now', caret: 32 })
})

test('the menu offers usable pool skills, closest name first', () => {
  assert.deepEqual(matchSkills(pool, 'p').map((match) => match.name), ['pdf-tools', 'planning-and-task-breakdown'])
  assert.deepEqual(matchSkills(pool, 'plan').map((match) => match.name), ['planning-and-task-breakdown'])
  // A skill the pool cannot read is not one an agent could be asked for.
  assert.deepEqual(matchSkills(pool, '').map((match) => match.name), ['pdf-tools', 'planning-and-task-breakdown'])
})

test('a finished message names its skills in order, without repeats', () => {
  assert.deepEqual(attachedSkills('$pdf-tools and /planning-and-task-breakdown, then $pdf-tools again', pool), ['pdf-tools', 'planning-and-task-breakdown'])
  // The declared name works as well as the pool directory, and an unknown mention stays a word.
  assert.deepEqual(attachedSkills('/skill:pdf please', pool), ['pdf-tools'])
  assert.deepEqual(attachedSkills('$nothing-like-this $broken', pool), [])
  assert.deepEqual(attachedSkills('plain message', pool), [])
})
