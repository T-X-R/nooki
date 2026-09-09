import assert from 'node:assert/strict'
import { test } from 'node:test'
import { documentDiff } from '../src/document-diff.ts'

test('separate edits preserve unchanged lines and line numbers', () => {
  const diff = documentDiff('title\nold\ncontext\nremoved\nend', 'title\nnew\ncontext\nadded\nend')
  assert.deepEqual(diff.map((line) => line.kind), ['same', 'removed', 'added', 'same', 'removed', 'added', 'same'])
  assert.deepEqual(diff[3], { kind: 'same', text: 'context', before: 3, after: 3 })
})
test('diff reconstructs both inputs including empty and repeated lines', () => {
  for (const [before, after] of [['', 'new'], ['old', ''], ['', ''], ['a\na\n\nb', 'a\n\nb\n'], ['same', 'same']]) {
    const diff = documentDiff(before, after)
    assert.equal(diff.filter((line) => line.kind !== 'added').map((line) => line.text).join('\n'), before)
    assert.equal(diff.filter((line) => line.kind !== 'removed').map((line) => line.text).join('\n'), after)
  }
})
test('large replacements are bounded and retain surrounding context', () => {
  const before = 'start\n' + 'old\n'.repeat(3000) + 'end'
  const after = 'start\n' + 'new\n'.repeat(3000) + 'end'
  const diff = documentDiff(before, after)
  assert.equal(diff.filter((line) => line.kind === 'same').length, 2)
  assert.equal(diff.filter((line) => line.kind !== 'added').map((line) => line.text).join('\n'), before)
  assert.equal(diff.filter((line) => line.kind !== 'removed').map((line) => line.text).join('\n'), after)
})
