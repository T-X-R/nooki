import type { BrokerConfirmationProposal } from './capability-broker.ts'
import { createCapabilityBroker } from './capability-broker.ts'
import { getCapabilityModule, getRuntimeInstalledCapability, listAvailableCapabilities } from './capability-runtime.ts'
import { taskRunner } from './tasks.ts'

export function createRuntimeCapabilityBroker(confirm: (proposal: BrokerConfirmationProposal) => Promise<boolean>) {
  return createCapabilityBroker({
    listCapabilities: () => listAvailableCapabilities().flatMap((module) => {
      const installed = getRuntimeInstalledCapability(module.manifest.id)
      return installed ? [{ module, installed }] : []
    }),
    async execute(capabilityId, job, input) {
      const module = getCapabilityModule(capabilityId)
      const installed = getRuntimeInstalledCapability(capabilityId)
      if (!module || !installed?.enabled || !module.jobs?.[job]) throw new Error('Capability command is no longer available')
      const taskId = await taskRunner.start(capabilityId, job, input)
      await taskRunner.settled(taskId)
      const record = taskRunner.getSnapshot().find((item) => item.id === taskId)
      if (!record) throw new Error('Capability task result is unavailable')
      return { taskId, status: record.status, result: record.result, error: record.error }
    },
    confirm,
  })
}
