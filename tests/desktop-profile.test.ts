import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createProfile, launchOptions } from '../scripts/desktop-profile.mjs'

test('a profile is empty, durable and launches without inherited credentials or ordinary agent homes', async () => {
  const parent = await mkdtemp('/tmp/nooki-profile-test-')
  try {
    const first = await createProfile(parent)
    const second = await createProfile(parent)
    const options = await launchOptions(first)
    assert.equal(options.cwd, first)
    assert.equal(options.env.HOME, join(first, 'home'))
    assert.equal(options.env.CODEX_HOME, join(first, 'home/.codex'))
    assert.equal(options.env.CLAUDE_CONFIG_DIR, join(first, 'home/.claude'))
    assert.equal(options.env.NOOKI_TEST_PROFILE, first)
    assert.deepEqual(Object.keys(options.env).sort(), ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'HOME', 'LANG', 'NOOKI_TEST_PROFILE', 'PATH', 'TMPDIR'].sort())
    const marker = JSON.parse(await readFile(join(first, 'profile.json'), 'utf8'))
    assert.equal(marker.format, 'nooki-test-profile')
    assert.equal(marker.storeId.length, 16)
    assert.notDeepEqual(marker.storeId, JSON.parse(await readFile(join(second, 'profile.json'), 'utf8')).storeId)
    await writeFile(join(first, 'home/sentinel'), 'keep across launch')
    assert.deepEqual(await launchOptions(first), options)
    assert.equal(await readFile(join(first, 'home/sentinel'), 'utf8'), 'keep across launch')
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('launch refuses an ordinary directory and a corrupted profile marker', async () => {
  const parent = await mkdtemp('/tmp/nooki-profile-test-')
  try {
    await assert.rejects(launchOptions(parent))
    const profile = await createProfile(parent)
    await writeFile(join(profile, 'profile.json'), '{"format":"nooki-test-profile","storeId":[]}')
    await assert.rejects(launchOptions(profile), /Invalid test profile/)
  } finally { await rm(parent, { recursive: true, force: true }) }
})
