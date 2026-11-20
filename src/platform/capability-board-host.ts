import type { BoardCreateInput, BoardItemReference, CapabilityHost, HostErrorCode, HostServiceError, IdempotencyOptions } from '../../packages/capability-contract/src/index.ts'

const codes: readonly HostErrorCode[] = ['INVALID_INPUT', 'PERMISSION_DENIED', 'UNSUPPORTED_SERVICE', 'CONFLICT', 'RESOURCE_LIMIT', 'RESOURCE_BUSY', 'RESOURCE_UNAVAILABLE', 'OUTCOME_UNKNOWN', 'CANCELLED']
const error = (code: HostErrorCode, message: string): HostServiceError => Object.assign(new Error(message), { code })
function normalize(value: unknown, fallback: HostErrorCode): HostServiceError {
  if (value && typeof value === 'object' && 'code' in value && codes.includes(value.code as HostErrorCode)) {
    return error(value.code as HostErrorCode, 'message' in value && typeof value.message === 'string' ? value.message : value.code as string)
  }
  return error(fallback, fallback === 'OUTCOME_UNKNOWN' ? 'Outcome unknown; retry with the same idempotency key and input' : 'Board service unavailable')
}
const fields = (value: unknown, allowed: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key))

type ClientLifetime = { id: string; readonly closed: boolean; dispose(): Promise<void> }
const lifetimes = new Set<ClientLifetime>()
export async function invalidateBoardClients(id: string): Promise<void> {
  const results = await Promise.allSettled([...lifetimes].filter(client => client.id === id).map(client => client.dispose()))
  if (results.some(result => result.status === 'rejected')) console.warn('Capability board release pending; will retry before the next grant')
}

function snapshot(input: BoardCreateInput, options: IdempotencyOptions): { input: BoardCreateInput; key: string } {
  const invalid = () => error('INVALID_INPUT', 'Invalid board content or idempotency key')
  try {
    if (!fields(input, ['title', 'description', 'sources']) || !fields(options, ['idempotencyKey'])) throw invalid()
    const serialized = JSON.stringify({ input, key: options.idempotencyKey })
    // Reserve room for native caller, fixed operation and the private invocation handle.
    if (new TextEncoder().encode(serialized).length > 63 * 1024) throw invalid()
    const copy = JSON.parse(serialized)
    if (!fields(copy.input, ['title', 'description', 'sources']) || typeof copy.input.title !== 'string' || !copy.input.title.trim()
      || [...copy.input.title].length > 120 || (copy.input.description !== undefined && (typeof copy.input.description !== 'string' || [...copy.input.description].length > 20_000))
      || typeof copy.key !== 'string' || !copy.key || new TextEncoder().encode(copy.key).length > 128 || /\p{Cc}/u.test(copy.key)
      || (copy.input.sources !== undefined && !Array.isArray(copy.input.sources))) throw invalid()
    if (copy.input.sources?.length) throw error('UNSUPPORTED_SERVICE', 'Authorized board source snapshots are not available yet')
    return copy
  } catch (cause) { throw normalize(cause, 'INVALID_INPUT') }
}

// Trusted legacy host controller. Packages receive only board; never this factory or its grant handle.
export function createBoardClient(config: {
  id: string; version: string; permission: boolean; desktop: boolean
  assertActive(): void
  invoke(command: string, args: Record<string, unknown>): Promise<unknown>
}) {
  let closed = false
  let pending: Promise<string> | undefined
  let disposing: Promise<void> | undefined
  const active = () => {
    if (closed) throw error('CANCELLED', 'This Host invocation has ended')
    try { config.assertActive() } catch { throw error('PERMISSION_DENIED', 'Capability is no longer active at this version') }
  }
  const board: CapabilityHost['board'] = Object.freeze({
    async create(input: BoardCreateInput, options: IdempotencyOptions): Promise<BoardItemReference> {
      active()
      if (!config.desktop) throw error('UNSUPPORTED_SERVICE', 'board.create requires desktop Nooki')
      if (!config.permission) throw error('PERMISSION_DENIED', 'Capability requires board.create')
      const request = snapshot(input, options)
      if (!pending) {
        const retired = [...lifetimes].filter(client => client.id === config.id && client.closed)
        if (retired.length) { await Promise.allSettled(retired.map(client => client.dispose())); active() }
      }
      pending ??= config.invoke('capability_board_begin', { request: { capabilityId: config.id, version: config.version } }).then(value => {
        if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw error('RESOURCE_UNAVAILABLE', 'Invalid native invocation')
        return value
      })
      let handle: string
      const invocation = pending
      try { handle = await invocation } catch (cause) {
        if (pending === invocation) pending = undefined
        throw normalize(cause, 'RESOURCE_UNAVAILABLE')
      }
      active()
      try {
        return await config.invoke('capability_board_create', { request: { handle, ...request } }) as BoardItemReference
      } catch (cause) { throw normalize(cause, 'OUTCOME_UNKNOWN') }
    },
  })
  const client = {
    id: config.id,
    get closed() { return closed },
    board,
    dispose(): Promise<void> {
      closed = true
      disposing ??= (async () => {
        const handle = await pending?.catch(() => undefined)
        if (handle) {
          try { await config.invoke('capability_board_release', { request: { handle } }) }
          catch (cause) {
            const failure = normalize(cause, 'RESOURCE_UNAVAILABLE')
            if (failure.code !== 'PERMISSION_DENIED') throw failure
          }
        }
        lifetimes.delete(client)
      })().catch(cause => { disposing = undefined; throw cause })
      return disposing
    },
  }
  lifetimes.add(client)
  return client
}
