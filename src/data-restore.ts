type LocalData = Record<string, string>
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
export const restoreJournalKey = 'workbench-data-restore-pending'
export function createDataRestore(storage: Store, owned: (key: string) => boolean, native?: { commit(transaction: string): Promise<void>; committedId(): Promise<string | null> }) {
  const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i)!).filter(owned)
  const capture = (): LocalData => Object.fromEntries(keys().map((key) => [key, storage.getItem(key)!]))
  const replace = (data: LocalData) => {
    keys().forEach((key) => storage.removeItem(key))
    for (const [key, value] of Object.entries(data)) {
      if (!owned(key)) throw new Error('Invalid recovery data')
      storage.setItem(key, value)
    }
  }
  return {
    async recover() {
      const pending = storage.getItem(restoreJournalKey)
      if (!pending) return
      const record = JSON.parse(pending) as { transaction: string; previous: LocalData; next: LocalData }
      const committed = native ? await native.committedId() : null
      replace(committed === record.transaction ? record.next : record.previous)
      storage.removeItem(restoreJournalKey)
    },
    async restore(next: LocalData) {
      const previous = capture()
      const transaction = crypto.randomUUID()
      storage.setItem(restoreJournalKey, JSON.stringify({ transaction, previous, next }))
      try {
        replace(next)
        if (native) await native.commit(transaction)
      } catch (error) {
        // An IPC error may arrive after the native transaction committed.
        // If status cannot be read, retain the journal for startup reconciliation.
        const committed = native ? await native.committedId() : null
        if (committed !== transaction) { replace(previous); storage.removeItem(restoreJournalKey); throw error }
      }
      storage.removeItem(restoreJournalKey)
    },
  }
}
