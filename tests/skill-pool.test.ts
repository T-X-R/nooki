import assert from 'node:assert/strict'
import test from 'node:test'
import {
  distributableTools, fileLabel, groupDecisions, holders, orderSkillFiles, isSelected, nextSelection, pendingDecisions, searchSkills, skillBody, skillFrontmatter, skillInstructions, toolSummary,
  type Duplicate, type Overview, type PoolSkill, type ToolEntry, type ToolView,
} from '../src/features/skills/skill-pool.ts'

function skill(name: string, description = ''): PoolSkill {
  return { name, title: name, description, fileCount: 1, updatedAt: '2026-09-17T10:00:00+08:00', issue: null }
}

function tool(id: string, selected: string[], entries: ToolEntry[] = [], overrides: Partial<ToolView> = {}): ToolView {
  return { id, name: id, directory: `/home/${id}/skills`, detected: true, readsPool: false, custom: false, selected, entries, error: null, ...overrides }
}

function overview(skills: PoolSkill[], tools: ToolView[], duplicates: Duplicate[] = []): Overview {
  return { poolDirectory: '/home/.agents/skills', poolExists: true, skills, tools, duplicates, notices: [] }
}

test('only detected tools that need copies appear in the distribution matrix', () => {
  const state = overview([skill('pdf')], [
    tool('codex', ['pdf']),
    tool('claude', [], [], { detected: false }),
    tool('pi', ['pdf'], [], { readsPool: true }),
  ])
  assert.deepEqual(distributableTools(state).map((entry) => entry.id), ['codex'])
})

test('a tool reading the pool always counts as selected', () => {
  const pi = tool('pi', [], [], { readsPool: true })
  assert.equal(isSelected(pi, 'pdf'), true)
  assert.equal(isSelected(tool('codex', ['diary']), 'pdf'), false)
})

test('toggling a skill keeps the rest of a tool selection intact', () => {
  const codex = tool('codex', ['diary', 'pdf'])
  assert.deepEqual(nextSelection(codex, 'pdf', false), ['diary'])
  assert.deepEqual(nextSelection(tool('codex', ['diary']), 'pdf', true), ['diary', 'pdf'])
  assert.deepEqual(nextSelection(codex, 'pdf', true), ['diary', 'pdf'], 'selecting twice does not duplicate')
})

test('a tool reports what it holds', () => {
  const codex = tool('codex', ['pdf'], [
    { name: 'pdf', state: 'mirror', description: '' },
    { name: 'diary', state: 'modified', description: '' },
    { name: 'handmade', state: 'foreign', description: 'Written by hand' },
  ])
  assert.deepEqual(toolSummary(codex), { mirror: 1, modified: 1, linked: 0, foreign: 1, unreadable: 0 })
})

test('decisions are ordered by how much they can cost', () => {
  const duplicate = (kind: Duplicate['kind'], name: string): Duplicate => ({ kind, name, toolId: 'codex', toolName: 'Codex', directory: `/home/codex/skills/${name}`, description: '', poolName: name, differingFiles: [] })
  const state = overview([], [], [duplicate('content', 'pdf-copy'), duplicate('adopt', 'handmade'), duplicate('linked', 'notes'), duplicate('name', 'pdf'), duplicate('modified', 'diary')])
  assert.deepEqual(pendingDecisions(state).map((entry) => entry.kind), ['name', 'modified', 'linked', 'adopt', 'content'])
})

test('deletion names every tool that would lose the skill', () => {
  const state = overview([skill('pdf')], [
    tool('codex', ['pdf'], [{ name: 'pdf', state: 'mirror', description: '' }]),
    tool('claude', ['pdf'], [{ name: 'pdf', state: 'modified', description: '' }]),
    tool('xxa', [], [{ name: 'pdf', state: 'foreign', description: '' }]),
    tool('pi', ['pdf'], [], { readsPool: true }),
    tool('absent', ['pdf'], [{ name: 'pdf', state: 'mirror', description: '' }], { detected: false }),
  ])
  assert.deepEqual(holders(state, 'pdf').map((entry) => entry.id), ['codex', 'claude', 'pi'])
})

test('decisions of the same kind for the same tool are one group', () => {
  const duplicate = (kind: Duplicate['kind'], name: string, toolId: string): Duplicate => ({ kind, name, toolId, toolName: toolId, directory: `/home/${toolId}/skills/${name}`, description: '', poolName: name, differingFiles: [] })
  const state = overview([], [], [
    duplicate('linked', 'pdf', 'claude'), duplicate('linked', 'diary', 'claude'), duplicate('linked', 'notes', 'codex'), duplicate('adopt', 'handmade', 'claude'),
  ])
  const groups = groupDecisions(state)
  assert.deepEqual(groups.map((group) => [group.key, group.items.length]), [['linked:claude', 2], ['linked:codex', 1], ['adopt:claude', 1]])
  assert.deepEqual(groups[0].items.map((item) => item.name), ['diary', 'pdf'])
})

test('search covers the name, title, and description', () => {
  const skills = [skill('pdf', 'Reads PDF files'), skill('diary', 'Writes a diary')]
  assert.deepEqual(searchSkills(skills, 'diary').map((entry) => entry.name), ['diary'])
  assert.deepEqual(searchSkills(skills, 'reads').map((entry) => entry.name), ['pdf'])
  assert.deepEqual(searchSkills(skills, '  ').map((entry) => entry.name), ['pdf', 'diary'])
})

test('a skill with many files still reads in an order', () => {
  const files = ['scripts/build.py', 'references/contract.md', 'SKILL.md', 'LICENSE.txt', 'assets/pet.png']
  assert.deepEqual(orderSkillFiles(files), ['SKILL.md', 'LICENSE.txt', 'assets/pet.png', 'references/contract.md', 'scripts/build.py'])
  assert.deepEqual(fileLabel('references/doc/read.md'), { folder: 'references/doc', name: 'read.md' })
  assert.deepEqual(fileLabel('SKILL.md'), { folder: '', name: 'SKILL.md' })
})

test('a skill declares itself in frontmatter, so the body starts after it', () => {
  const skillMd = '---\nname: pdf\ndescription: Reads PDF files\n---\n\n# Working with PDFs\n\nStart here.\n'
  assert.equal(skillBody(skillMd), '# Working with PDFs\n\nStart here.\n')
  assert.equal(skillBody('# No frontmatter\n\nBody.'), '# No frontmatter\n\nBody.')
  assert.equal(skillBody('---\nname: broken\n\n# Never closed'), '---\nname: broken\n\n# Never closed')
  assert.equal(skillBody('---\r\nname: pdf\r\n---\r\n\r\n# Windows\r\n'), '# Windows\r\n')
  assert.equal(skillBody('---\nname: pdf\n---\n\ntext with --- inside\n'), 'text with --- inside\n')
})

test('the dialog names the skill, so the body does not repeat that name', () => {
  const repeated = '---\nname: sandbox-handwritten\n---\n\n# Sandbox Handwritten\n\nA sandbox skill.\n'
  assert.equal(skillInstructions(repeated, 'sandbox-handwritten', 'sandbox-handwritten'), 'A sandbox skill.\n')
  const titled = '---\nname: pdf\n---\n\n# Working with PDFs\n\nStart here.\n'
  assert.equal(skillInstructions(titled, 'pdf', 'pdf'), '# Working with PDFs\n\nStart here.\n')
  assert.equal(skillInstructions('## Overview\n\nBody.', 'overview'), '## Overview\n\nBody.')
  assert.equal(skillInstructions('# 技能池\n\n正文\n', '技能池'), '正文\n')
})

test('frontmatter reads as the fields a skill declares about itself', () => {
  const fields = skillFrontmatter([
    '---',
    'name: doctor-prescription-logic',
    'description: 根据患者开药请求提取药品名称，在 `skills/` 文件夹中检索。',
    'allowed-tools:',
    '  - read',
    '  - bash',
    'license: "MIT"',
    '---',
    '',
    '# 医保开药规则解读',
  ].join('\n'))
  assert.deepEqual(fields, [
    { key: 'name', value: 'doctor-prescription-logic' },
    { key: 'description', value: '根据患者开药请求提取药品名称，在 `skills/` 文件夹中检索。' },
    { key: 'allowed-tools', value: 'read, bash' },
    { key: 'license', value: 'MIT' },
  ])
})

test('a wrapped description stays one field', () => {
  const fields = skillFrontmatter('---\ndescription: >\n  Use when a user asks\n  for a prescription rule.\nname: rules\n---\nbody\n')
  assert.deepEqual(fields, [{ key: 'description', value: 'Use when a user asks for a prescription rule.' }, { key: 'name', value: 'rules' }])
})

test('a file without frontmatter declares nothing', () => {
  assert.deepEqual(skillFrontmatter('# Title\n\nname: not frontmatter\n'), [])
  assert.deepEqual(skillFrontmatter('---\nname: unterminated\n'), [])
})
