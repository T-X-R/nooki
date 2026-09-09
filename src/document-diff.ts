export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string; before?: number; after?: number }

export function documentDiff(before: string, after: string): DiffLine[] {
  const left = before === '' ? [] : before.split('\n')
  const right = after === '' ? [] : after.split('\n')
  const result: DiffLine[] = []
  let i = 0; let j = 0
  const emit = (kind: DiffLine['kind']) => {
    result.push({ kind, text: kind === 'added' ? right[j] : left[i], before: kind === 'added' ? undefined : i + 1, after: kind === 'removed' ? undefined : j + 1 })
    if (kind !== 'added') i++
    if (kind !== 'removed') j++
  }
  while (i < left.length && j < right.length && left[i] === right[j]) emit('same')
  let end = 0
  while (end < Math.min(left.length - i, right.length - j) && left[left.length - end - 1] === right[right.length - end - 1]) end++
  const rows = left.length - i - end; const cols = right.length - j - end
  // Bound memory and work for very large replacements. Prefix and suffix remain context.
  if ((rows + 1) * (cols + 1) <= 4_000_000) {
    const table = new Uint32Array((rows + 1) * (cols + 1))
    const offsetLeft = i; const offsetRight = j; const width = cols + 1
    for (let r = rows - 1; r >= 0; r--) {
      for (let c = cols - 1; c >= 0; c--) {
        table[r * width + c] = left[offsetLeft + r] === right[offsetRight + c]
          ? table[(r + 1) * width + c + 1] + 1
          : Math.max(table[(r + 1) * width + c], table[r * width + c + 1])
      }
    }
    while (i < left.length - end && j < right.length - end) {
      if (left[i] === right[j]) emit('same')
      else if (table[(i - offsetLeft + 1) * width + j - offsetRight] >= table[(i - offsetLeft) * width + j - offsetRight + 1]) emit('removed')
      else emit('added')
    }
  }
  while (i < left.length - end) emit('removed')
  while (j < right.length - end) emit('added')
  while (i < left.length) emit('same')
  return result
}
