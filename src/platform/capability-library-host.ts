import type { CapabilityHost, DocumentGrant, HostErrorCode, HostServiceError, LibrarySelectionRequest, LibrarySelectionResult } from '../../packages/capability-contract/src/index.ts'
import type { LibraryPickerRequest } from './library-picker.ts'

const error = (code: HostErrorCode, message: string): HostServiceError => Object.assign(new Error(message), { code })
const codes: HostErrorCode[] = ['INVALID_INPUT','PERMISSION_DENIED','UNSUPPORTED_SERVICE','CONFLICT','RESOURCE_LIMIT','RESOURCE_BUSY','RESOURCE_UNAVAILABLE','OUTCOME_UNKNOWN','CANCELLED']
function normalize(cause: unknown, fallback: HostErrorCode): HostServiceError {
  if (cause && typeof cause === 'object' && 'code' in cause && codes.includes(cause.code as HostErrorCode)) {
    return error(cause.code as HostErrorCode, 'message' in cause && typeof cause.message === 'string' ? cause.message : 'Document selection failed')
  }
  return error(fallback, fallback === 'OUTCOME_UNKNOWN' ? 'Selection outcome unknown; retry the same selection' : 'Document selection unavailable')
}
function snapshot(value: LibrarySelectionRequest) {
  const invalid = () => error('INVALID_INPUT','Invalid selection purpose, kinds or limit')
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['purpose','kinds','mediaTypes','limit'].includes(key))) throw invalid()
  if (typeof value.purpose !== 'string' || !value.purpose.trim() || [...value.purpose].length > 1000
    || !Array.isArray(value.kinds) || !value.kinds.length || value.kinds.length > 2 || value.kinds.some(kind => !['document','artifact'].includes(kind))
    || (value.mediaTypes !== undefined && (!Array.isArray(value.mediaTypes) || !value.mediaTypes.length || value.mediaTypes.length > 16 || value.mediaTypes.some(type => typeof type !== 'string')))
    || (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 50))) throw invalid()
  if (value.kinds.some(kind => kind !== 'document') || value.mediaTypes?.some(type => type !== 'text/markdown')) throw error('UNSUPPORTED_SERVICE','Only text/markdown document snapshots are supported')
  return { purpose: value.purpose, limit: value.limit ?? 1 }
}
type Lifetime = { id: string; closed: boolean; dispose(): Promise<void> }
const clients = new Set<Lifetime>()
export async function invalidateLibraryClients(id: string) {
  await Promise.all([...clients].filter(client => client.id === id).map(client => client.dispose()))
}

// Only this host controller sees the temporary native handle; packages receive library only.
export function createLibraryClient(config: {
  id: string; version: string; name: string; permission: boolean; desktop: boolean
  assertActive(): void; onDispose(): void
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>
  open(request: LibraryPickerRequest): Promise<LibrarySelectionResult>
}) {
  let closed = false, running = false
  let controller: AbortController | undefined
  const requests = new Set<string>()
  const active = () => {
    if (closed) throw error('CANCELLED','This Host invocation has ended')
    try { config.assertActive() } catch { throw error('PERMISSION_DENIED','Capability is no longer active at this version') }
  }
  const release = async(requestId: string) => {
    try { await config.invoke('library_selection_cancel',{request:{requestId}}); requests.delete(requestId) }
    catch { console.warn('Document selection cleanup pending; will retry before the next selection') }
  }
  const client = {
    id: config.id,
    get closed() { return closed },
    library: Object.freeze({
      async requestSelection(input: LibrarySelectionRequest): Promise<LibrarySelectionResult> {
        active()
        if (!config.desktop) throw error('UNSUPPORTED_SERVICE','Library selection requires desktop Nooki')
        if (!config.permission) throw error('PERMISSION_DENIED','Capability requires documents.read-selected')
        const request = snapshot(input)
        if (running) throw error('RESOURCE_BUSY','This Host already has an open picker')
        running = true; controller = new AbortController()
        let requestId: string | undefined
        let selected: LibrarySelectionResult
        try {
          await Promise.all([...requests].map(release))
          await Promise.all([...clients].filter(other => other.id === config.id && other.closed).map(other => other.dispose()))
          active()
          requestId = crypto.randomUUID(); requests.add(requestId)
          const result = await config.invoke('library_selection_begin',{request:{requestId,capabilityId:config.id,version:config.version,...request}}) as {handle:string;requestId:string;capabilityId:string;version:string}
          if (!result || !/^[a-f0-9]{64}$/.test(result.handle) || result.requestId !== requestId || result.capabilityId !== config.id || result.version !== config.version) throw error('RESOURCE_UNAVAILABLE','Invalid native selection context')
          const handle = result.handle; active()
          selected = await config.open({ selectionId:requestId, capabilityId:config.id,version:config.version,name:config.name,...request,signal:controller.signal,
            confirm: async(ids: string[]) => {
              active()
              try {
                const grant = await config.invoke('library_selection_commit',{request:{handle,ids:[...ids]}}) as DocumentGrant
                active(); return grant
              } catch(cause) { throw normalize(cause,'OUTCOME_UNKNOWN') }
            },
          })
        } catch(cause) { throw normalize(cause,'RESOURCE_UNAVAILABLE') }
        finally {
          if (requestId) await release(requestId)
          running = false; controller = undefined
          if (closed && !requests.size) clients.delete(client)
        }
        active(); return selected
      },
    }) satisfies CapabilityHost['library'],
    async dispose() {
      closed = true; config.onDispose(); controller?.abort()
      await Promise.all([...requests].map(release))
      if (!running && !requests.size) clients.delete(client)
    },
  }
  clients.add(client)
  return client
}
