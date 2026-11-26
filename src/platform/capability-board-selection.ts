import type { CapabilityHost, BoardGrant, HostErrorCode, HostServiceError, BoardSelectionRequest, BoardSelectionResult } from '../../packages/capability-contract/src/index.ts'
import type { BoardPickerRequest } from './board-picker.ts'

const error = (code: HostErrorCode, message: string): HostServiceError => Object.assign(new Error(message), { code })
const codes: HostErrorCode[] = ['INVALID_INPUT','PERMISSION_DENIED','UNSUPPORTED_SERVICE','CONFLICT','RESOURCE_LIMIT','RESOURCE_BUSY','RESOURCE_UNAVAILABLE','OUTCOME_UNKNOWN','CANCELLED']
function normalize(cause: unknown, fallback: HostErrorCode): HostServiceError {
  if (cause && typeof cause === 'object' && 'code' in cause && codes.includes(cause.code as HostErrorCode)) {
    return error(cause.code as HostErrorCode, 'message' in cause && typeof cause.message === 'string' ? cause.message : 'Task selection failed')
  }
  return error(fallback, fallback === 'OUTCOME_UNKNOWN' ? 'Selection outcome unknown; retry the same selection' : 'Task selection unavailable')
}
function snapshot(value: BoardSelectionRequest) {
  const invalid = () => error('INVALID_INPUT','Invalid task selection purpose, operations or limit')
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['purpose','operations','limit'].includes(key))) throw invalid()
  if (typeof value.purpose !== 'string' || !value.purpose.trim() || [...value.purpose].length > 1000
    || !Array.isArray(value.operations) || value.operations.length !== 1
    || (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 50))) throw invalid()
  if (value.operations[0] !== 'attachDelivery') throw error('UNSUPPORTED_SERVICE','Only attachment selection is supported')
  return { purpose: value.purpose, operations: ['attachDelivery'] as ['attachDelivery'], limit: value.limit ?? 1 }
}
type Lifetime = { id: string; closed: boolean; dispose(): Promise<void> }
const clients = new Set<Lifetime>()
export async function invalidateBoardSelections(id: string) {
  await Promise.all([...clients].filter(client => client.id === id).map(client => client.dispose()))
}

// Only this host controller sees the pending native handle; packages receive the selection method.
export function createBoardSelectionClient(config: {
  id: string; version: string; name: string; permission: boolean; desktop: boolean
  assertActive(): void; onDispose(): void
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>
  open(request: BoardPickerRequest): Promise<BoardSelectionResult>
  captureFocus?(): () => void
}) {
  let closed = false, running = false
  let controller: AbortController | undefined
  const requests = new Set<string>()
  const active = () => {
    if (closed) throw error('CANCELLED','This Host invocation has ended')
    try { config.assertActive() } catch { throw error('PERMISSION_DENIED','Capability is no longer active at this version') }
  }
  const release = async(requestId: string) => {
    try { await config.invoke('board_selection_cancel',{request:{requestId}}); requests.delete(requestId) }
    catch { console.warn('Task selection cleanup pending; will retry before the next selection') }
  }
  const client = {
    id: config.id,
    get closed() { return closed },
    board: Object.freeze({
      async requestSelection(input: BoardSelectionRequest): Promise<BoardSelectionResult> {
        active()
        if (!config.desktop) throw error('UNSUPPORTED_SERVICE','Task selection requires desktop Nooki')
        if (!config.permission) throw error('PERMISSION_DENIED','Capability requires board.attach-delivery')
        const request = snapshot(input)
        if (running) throw error('RESOURCE_BUSY','This Host already has an open picker')
        const restoreFocus = config.captureFocus?.()
        running = true; controller = new AbortController()
        let requestId: string | undefined
        let selected: BoardSelectionResult
        try {
          await Promise.all([...requests].map(release))
          await Promise.all([...clients].filter(other => other.id === config.id && other.closed).map(other => other.dispose()))
          active()
          requestId = crypto.randomUUID(); requests.add(requestId)
          const result = await config.invoke('board_selection_begin',{request:{requestId,capabilityId:config.id,version:config.version,...request}}) as {handle:string;requestId:string;capabilityId:string;version:string}
          if (!result || !/^[a-f0-9]{64}$/.test(result.handle) || result.requestId !== requestId || result.capabilityId !== config.id || result.version !== config.version) throw error('RESOURCE_UNAVAILABLE','Invalid native selection context')
          const handle = result.handle; active()
          let approved: string | undefined
          selected = await config.open({ selectionId:requestId, capabilityId:config.id,version:config.version,name:config.name,...request,signal:controller.signal,
            confirm: async(items) => {
              active()
              if (!Array.isArray(items) || !items.length || items.length > request.limit
                || items.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['id','revision'].includes(key))
                  || typeof item.id !== 'string' || !item.id || new TextEncoder().encode(item.id).length > 256 || !Number.isSafeInteger(item.revision) || item.revision < 1)
                || new Set(items.map(item => item.id)).size !== items.length) throw error('INVALID_INPUT','Invalid selected task revisions')
              const frozen = JSON.stringify(items.map(item => ({id:item.id,revision:item.revision})).sort((a,b) => a.id.localeCompare(b.id)))
              if (approved !== undefined && approved !== frozen) throw error('CONFLICT','Approved task selection changed; cancel and select again')
              approved = frozen
              try {
                const grant = await config.invoke('board_selection_commit',{request:{handle,items:JSON.parse(approved)}}) as BoardGrant
                active(); return grant
              } catch(cause) { throw normalize(cause,'OUTCOME_UNKNOWN') }
            },
          })
        } catch(cause) { throw normalize(cause,'RESOURCE_UNAVAILABLE') }
        finally {
          if (requestId) await release(requestId)
          running = false; controller = undefined
          if (closed && !requests.size) clients.delete(client)
          restoreFocus?.()
        }
        active(); return selected
      },
    }) satisfies Pick<CapabilityHost['board'], 'requestSelection'>,
    async dispose() {
      closed = true; config.onDispose(); controller?.abort()
      await Promise.all([...requests].map(release))
      if (!running && !requests.size) clients.delete(client)
    },
  }
  clients.add(client)
  return client
}
