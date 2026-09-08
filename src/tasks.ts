import { invoke } from '@tauri-apps/api/core'
import type { CapabilityTasks, TaskRecord } from '../packages/capability-contract/src'
import { createTaskRunner } from './task-runner'
import { createCapabilityHost } from './capability-host'
import { getCapabilityModule, getRuntimeInstalledCapability } from './capability-runtime'

const browserKey = 'personal-workbench-tasks-v1'
export const taskRunner = createTaskRunner({
  read: async () => window.__TAURI_INTERNALS__
    ? invoke<TaskRecord[]>('tasks_read')
    : JSON.parse(localStorage.getItem(browserKey) ?? '[]'),
  write: async (records) => {
    if (window.__TAURI_INTERNALS__) await invoke('tasks_write', { records })
    else localStorage.setItem(browserKey, JSON.stringify(records))
  },
  resolve(capabilityId, job) {
    const installed = getRuntimeInstalledCapability(capabilityId)
    const module = getCapabilityModule(capabilityId)
    if (!installed?.enabled || !module) throw new Error('Capability is not installed or enabled')
    if (!module.manifest.entrypoints.includes('job') || !module.jobs?.[job]) throw new Error('Capability job not found')
    return { manifest: module.manifest, definition: module.jobs[job] }
  },
  host(capabilityId, execution) {
    const module = getCapabilityModule(capabilityId)!
    return createCapabilityHost(capabilityId, module.manifest.permissions, module.manifest.name, execution)
  },
  cancelInvocation: async (id) => {
    if (window.__TAURI_INTERNALS__) await invoke('task_cancel_invocation', { id })
  },
})

export function capabilityTasks(capabilityId: string): CapabilityTasks {
  let previous: readonly TaskRecord[] | undefined
  let snapshot: readonly TaskRecord[] = []
  const assertOwner = (id: string) => {
    if (!taskRunner.getSnapshot().some((record) => record.id === id && record.capabilityId === capabilityId)) throw new Error('Task not found for capability')
  }
  return {
    getSnapshot() {
      const records = taskRunner.getSnapshot()
      if (records !== previous) { previous = records; snapshot = records.filter((record) => record.capabilityId === capabilityId) }
      return snapshot
    },
    subscribe: taskRunner.subscribe,
    start: (job, input) => taskRunner.start(capabilityId, job, input),
    cancel: async (id) => { assertOwner(id); await taskRunner.cancel(id) },
    retry: async (id) => { assertOwner(id); await taskRunner.retry(id) },
  }
}
