import { capabilityInvocationSignature, type BrokerConfirmationProposal, type BrokerInvocationStatus, type BrokerInvocationUpdate, type CapabilityBrokerRequest, type CapabilityBrokerResponse } from '../../platform/capability-broker.ts'

const storageKey = 'personal-workbench:capability:conversation-invocations'
const maximumRecords = 500

type InvocationStorage = Pick<Storage, 'getItem' | 'setItem'>

export type CapabilityInvocationRecord = BrokerConfirmationProposal & Readonly<{
  status: BrokerInvocationStatus
  taskId?: string
  result?: unknown
  error?: string
  signature?: string
  response?: CapabilityBrokerResponse
  createdAt: string
  updatedAt: string
}>

const statuses: readonly BrokerInvocationStatus[] = ['proposed', 'awaiting_confirmation', 'running', 'completed', 'failed', 'cancelled', 'interrupted']
const errorCodes = ['COMMAND_NOT_AVAILABLE', 'INVALID_INPUT', 'INVALID_OUTPUT', 'CONFIRMATION_DENIED', 'INVOCATION_CONFLICT', 'INVOCATION_LIMIT', 'EXECUTION_FAILED', 'EXECUTION_CANCELLED', 'EXECUTION_INTERRUPTED']

function validResponse(value: unknown): value is CapabilityBrokerResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Record<string, unknown>
  if (response.ok === true) return response.action === 'invoke'
    && typeof response.invocationId === 'string'
    && typeof response.taskId === 'string'
    && response.status === 'completed'
  if (response.ok !== false || !response.error || typeof response.error !== 'object') return false
  const error = response.error as Record<string, unknown>
  return typeof error.code === 'string' && errorCodes.includes(error.code) && typeof error.message === 'string'
}

function validRecord(value: unknown): value is CapabilityInvocationRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<CapabilityInvocationRecord>
  const command = record.command as Partial<CapabilityInvocationRecord['command']> | undefined
  return typeof record.invocationId === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.updatedAt === 'string'
    && statuses.includes(record.status as BrokerInvocationStatus)
    && !!command
    && typeof command.capabilityId === 'string'
    && typeof command.capabilityName === 'string'
    && typeof command.commandId === 'string'
    && typeof command.title === 'string'
    && typeof command.description === 'string'
    && ['read', 'draft', 'write', 'external'].includes(command.effect ?? '')
    && ['never', 'when-needed', 'always'].includes(command.confirmation ?? '')
    && !!command.inputSchema
    && typeof command.inputSchema === 'object'
    && !Array.isArray(command.inputSchema)
    && (record.signature === undefined || typeof record.signature === 'string')
    && (record.response === undefined || validResponse(record.response))
    && (record.context === undefined || typeof record.context.threadId === 'string' && typeof record.context.turnId === 'string' && typeof record.context.agent === 'string')
}

function read(storage: InvocationStorage): CapabilityInvocationRecord[] {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const now = new Date().toISOString()
    return parsed.filter(validRecord)
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
    rememberResponse(request: CapabilityBrokerRequest, response: CapabilityBrokerResponse) {
      if (request.action !== 'invoke') return
      const previous = records.find((record) => record.invocationId === request.invocationId)
      if (!previous) return
      records = records.map((record) => record.invocationId === request.invocationId
        ? { ...record, signature: capabilityInvocationSignature(request), response, updatedAt: new Date().toISOString() }
        : record)
      persist()
      emit()
    },
    recoverInvocation(request: Extract<CapabilityBrokerRequest, { action: 'invoke' }>): CapabilityBrokerResponse | 'conflict' | undefined {
      const record = records.find((item) => item.invocationId === request.invocationId)
      if (!record) return undefined
      const signature = capabilityInvocationSignature(request)
      const recordedSignature = record.signature ?? capabilityInvocationSignature({
        action: 'invoke', invocationId: record.invocationId, capabilityId: record.command.capabilityId,
        commandId: record.command.commandId, input: record.input, language: record.language, context: record.context,
      })
      if (recordedSignature !== signature) return 'conflict'
      if (record.status === 'completed' && record.taskId) return record.response ?? {
        ok: true, action: 'invoke', invocationId: record.invocationId, taskId: record.taskId, status: 'completed', result: record.result,
      }
      if (record.status === 'cancelled') return record.response ?? { ok: false, error: { code: 'EXECUTION_CANCELLED', message: record.error || 'Capability command was cancelled' } }
      if (record.status === 'failed') return record.response ?? { ok: false, error: { code: 'EXECUTION_FAILED', message: record.error || 'Capability command failed' } }
      if (record.status === 'interrupted') return record.response ?? { ok: false, error: { code: 'EXECUTION_INTERRUPTED', message: record.error || 'Capability command was interrupted' } }
      return undefined
    },
  }
}

const unavailableStorage: InvocationStorage = { getItem: () => null, setItem: () => undefined }
export const capabilityInvocationStore = createCapabilityInvocationStore(typeof window === 'undefined' ? unavailableStorage : window.localStorage)
