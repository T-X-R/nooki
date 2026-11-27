import type { BoardGrant, BoardSelectionResult } from '../../packages/capability-contract/src/index.ts'

export type BoardPickerRequest = {
  selectionId: string; capabilityId: string; version: string; name: string; purpose: string; limit: number
  signal: AbortSignal
  confirm(items: import('../../packages/capability-contract/src/index.ts').BoardItemReference[]): Promise<BoardGrant>
}
export function createBoardPicker() {
  let pending: BoardPickerRequest | null = null
  let settle: ((result: BoardSelectionResult | Error) => void) | undefined
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach(listener => listener())
  return {
    getSnapshot: () => pending,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    open(request: BoardPickerRequest): Promise<BoardSelectionResult> {
      if (pending) return Promise.reject(Object.assign(new Error('Another task picker is open'), { code: 'RESOURCE_BUSY' }))
      if (request.signal.aborted) return Promise.reject(Object.assign(new Error('Selection cancelled'), { code: 'CANCELLED' }))
      return new Promise((resolve, reject) => {
        const abort = () => settle?.(Object.assign(new Error('Selection cancelled'), { code: 'CANCELLED' }))
        settle = result => {
          request.signal.removeEventListener('abort', abort)
          pending = null; settle = undefined; changed()
          if (result instanceof Error) reject(result); else resolve(result)
        }
        request.signal.addEventListener('abort', abort, { once: true })
        pending = request; changed()
      })
    },
    dismiss(request: BoardPickerRequest) { if (pending === request) settle?.({ status: 'dismissed' }) },
    complete(request: BoardPickerRequest, result: BoardSelectionResult) { if (pending === request) settle?.(result) },
  }
}
export const boardPicker = createBoardPicker()
