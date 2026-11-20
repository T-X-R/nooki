import type { DocumentGrant, LibrarySelectionResult } from '../../packages/capability-contract/src/index.ts'

export type LibraryPickerRequest = {
  selectionId: string; capabilityId: string; version: string; name: string; purpose: string; limit: number
  signal: AbortSignal
  confirm(ids: string[]): Promise<DocumentGrant>
}
export function createLibraryPicker() {
  let pending: LibraryPickerRequest | null = null
  let settle: ((result: LibrarySelectionResult | Error) => void) | undefined
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach(listener => listener())
  return {
    getSnapshot: () => pending,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    open(request: LibraryPickerRequest): Promise<LibrarySelectionResult> {
      if (pending) return Promise.reject(Object.assign(new Error('Another Library picker is open'), { code: 'RESOURCE_BUSY' }))
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
    dismiss(request: LibraryPickerRequest) { if (pending === request) settle?.({ status: 'dismissed' }) },
    complete(request: LibraryPickerRequest, result: LibrarySelectionResult) { if (pending === request) settle?.(result) },
  }
}
export const libraryPicker = createLibraryPicker()
