import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { CapabilityBrokerRequest, CapabilityBrokerResponse } from './capability-broker.ts'
import { createRuntimeCapabilityBroker } from './capability-broker-runtime.ts'
import { capabilityInvocationStore } from '../features/conversation/capability-invocations.ts'

type CapabilityRequestEvent = { id: string; request: CapabilityBrokerRequest }

const broker = createRuntimeCapabilityBroker(
  capabilityInvocationStore.requestConfirmation,
  capabilityInvocationStore.update,
)
let connecting: Promise<unknown> | undefined

export const capabilityBrokerClient = {
  connect() {
    if (!window.__TAURI_INTERNALS__) return Promise.resolve()
    connecting ??= listen<CapabilityRequestEvent>('workbench:capability-request', ({ payload }) => {
      void broker.handle(payload.request)
        .catch((): CapabilityBrokerResponse => ({ ok: false, error: { code: 'EXECUTION_FAILED', message: 'Capability broker failed' } }))
        .then((response) => invoke('capability_broker_respond', { id: payload.id, response }))
        .catch(() => {})
    }).then(() => invoke('capability_broker_ready')).catch((error) => { connecting = undefined; throw error })
    return connecting
  },
}
