import type { BrokerConfirmationProposal, BrokerInvocationStatus, BrokerInvocationUpdate } from '../../platform/capability-broker.ts'

const storageKey = 'personal-workbench:capability:conversation-invocations'
const maximumRecords = 500

type InvocationStorage = Pick<Storage, 'getItem' | 'setItem'>

export type CapabilityInvocationRecord = BrokerConfirmationProposal & Readonly<{
  status: BrokerInvocationStatus
  taskId?: string
  result?: unknown
  error?: string
  createdAt: string
  updatedAt: string
}>

function read(storage: InvocationStorage): CapabilityInvocationRecord[] {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const now = new Date().toISOString()
    return parsed.filter((record) => record && typeof record === 'object' && typeof record.invocationId === 'string')
      .map((record) => ['proposed', 'awaiting_confirmation', 'running'].includes(record.status)
        ? { ...record, status: 'interrupted', error: 'Invocation was interrupted when Nooki closed', updatedAt: now }
        : record)
  } catch { return [] }
}

export function createCapabilityInvocationStore(storage: InvocationStorage) {
  let records: readonly CapabilityInvocationRecord[] = read(storage)
  const listeners = new Set<() => void>()
  const decisions = new Map<string, (accepted: boolean) => void>()
  const persist = () => storage.setItem(storageKey, JSON.stringify(records.slice(-maximumRecords)))
  if (records.length) persist()
  const emit = () => listeners.forEach((listener) => listener())

  const update = (next: BrokerInvocationUpdate) => {
    const now = new Date().toISOString()
    const previous = records.find((record) => record.invocationId === next.invocationId)
    const record: CapabilityInvocationRecord = { ...previous, ...next, createdAt: previous?.createdAt ?? now, updatedAt: now }
    records = previous
      ? records.map((item) => item.invocationId === next.invocationId ? record : item)
      : [...records, record]
    if (records.length > maximumRecords) records = records.slice(-maximumRecords)
    persist()
    emit()
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => records,
    update,
    requestConfirmation(proposal: BrokerConfirmationProposal) {
      update({ ...proposal, status: 'awaiting_confirmation' })
      return new Promise<boolean>((resolve) => { decisions.set(proposal.invocationId, resolve) })
    },
    decide(invocationId: string, accepted: boolean) {
      const record = records.find((item) => item.invocationId === invocationId)
      const resolve = decisions.get(invocationId)
      if (!record || record.status !== 'awaiting_confirmation' || !resolve) throw new Error('Invocation is not awaiting confirmation')
      decisions.delete(invocationId)
      if (!accepted) update({ ...record, status: 'cancelled', error: 'Capability command was not confirmed' })
      resolve(accepted)
    },
  }
}

const unavailableStorage: InvocationStorage = { getItem: () => null, setItem: () => undefined }
export const capabilityInvocationStore = createCapabilityInvocationStore(typeof window === 'undefined' ? unavailableStorage : window.localStorage)
