import type { CapabilityTaskContext, TaskRecord } from '../packages/capability-contract/src/index.ts'

export type TaskContext = Pick<CapabilityTaskContext, 'signal' | 'step'> & { executionId: string }
export type TaskJob = { run(input: unknown, context: TaskContext): Promise<unknown> }
export type TaskRunnerDependencies = {
  read(): Promise<TaskRecord[]>
  write(records: readonly TaskRecord[]): Promise<void>
  resolve(ownerId: string, job: string): { version: string; definition: TaskJob; ownerKind?: 'platform'; scope?(input: unknown): string }
  cancelInvocation(id: string): Promise<void>
}

export function createTaskRunner(dependencies: TaskRunnerDependencies) {
  let records: readonly TaskRecord[] = []
  let initialized: Promise<void> | undefined
  let persistence: Promise<unknown> = Promise.resolve()
  const listeners = new Set<() => void>()
  const executions = new Map<string, { controller: AbortController; done: Promise<void> }>()
  const pausedCapabilities = new Set<string>()

  const emit = () => listeners.forEach((listener) => listener())
  const commit = (change: (current: readonly TaskRecord[]) => readonly TaskRecord[]) => {
    const operation = persistence.then(async () => {
      const next = change(records)
      await dependencies.write(next)
      records = next
      emit()
    })
    persistence = operation.catch(() => undefined)
    return operation
  }
  const initialize = () => initialized ??= (async () => {
    records = (await dependencies.read()).map((record) => record.status === 'running'
      ? { ...record, status: 'interrupted' as const, error: 'Execution interrupted when Workbench closed' }
      : record)
    await dependencies.write(records)
    emit()
  })()
  const find = (id: string) => {
    const record = records.find((item) => item.id === id)
    if (!record) throw new Error('Task not found')
    return record
  }
  const update = (id: string, patch: Partial<TaskRecord>, guard?: () => void) => commit((current) => {
    guard?.()
    return current.map((record) => record.id === id ? { ...record, ...patch, updatedAt: new Date().toISOString() } : record)
  })
  const resolve = (record: Pick<TaskRecord, 'capabilityId' | 'capabilityVersion' | 'job'>) => {
    if (pausedCapabilities.has(record.capabilityId)) throw new Error('Capability lifecycle change in progress')
    const resolved = dependencies.resolve(record.capabilityId, record.job)
    if (resolved.version !== record.capabilityVersion) throw new Error('Task belongs to a different capability version. Start a new task.')
    return resolved.definition
  }

  const execute = (record: TaskRecord, definition: TaskJob) => {
    const controller = new AbortController()
    const signal = controller.signal
    const assertActive = () => {
      signal.throwIfAborted()
      if (find(record.id).status !== 'running' || find(record.id).attempt !== record.attempt) throw new Error('Task execution is no longer active')
      resolve(record)
    }
    const done = (async () => {
      try {
        // Defer business execution until the execution handle is registered.
        await Promise.resolve()
        assertActive()
        let stepActive = false
        const result = await definition.run(structuredClone(record.input), {
          executionId: `${record.id}:${record.attempt}`,
          signal,
          async step<T>(key: string, operation: () => Promise<T>): Promise<T> {
            assertActive()
            if (!/^[a-z0-9-]+$/.test(key) || stepActive) throw new Error('Task steps require stable keys and sequential execution')
            const checkpoints = find(record.id).checkpoints
            if (Object.hasOwn(checkpoints, key)) return structuredClone(checkpoints[key]) as T
            stepActive = true
            try {
              await update(record.id, { stage: key }, assertActive)
              assertActive()
              const value = await operation()
              assertActive()
              await update(record.id, { checkpoints: { ...find(record.id).checkpoints, [key]: structuredClone(value ?? null) } }, assertActive)
              assertActive()
              return value
            } finally {
              stepActive = false
            }
          },
        })
        assertActive()
        await update(record.id, { status: 'completed', result: result ?? null, error: null }, assertActive)
      } catch (error) {
        if (!signal.aborted && find(record.id).status === 'running' && find(record.id).attempt === record.attempt) {
          const message = error instanceof Error ? error.message : String(error)
          try {
            await update(record.id, { status: 'failed', error: message }, () => signal.throwIfAborted())
          } catch {
            if (signal.aborted) return
            // Keep a visible failure if the disk is unavailable; the persisted
            // running record becomes interrupted on the next app start.
            records = records.map((item) => item.id === record.id ? { ...item, status: 'failed', error: `Could not persist task: ${message}` } : item)
            emit()
          }
        }
      } finally {
        if (executions.get(record.id)?.controller === controller) executions.delete(record.id)
      }
    })()
    executions.set(record.id, { controller, done })
  }

  const cancel = async (id: string) => {
    await initialize()
    const record = find(id)
    if (record.status !== 'running') return
    executions.get(id)?.controller.abort()
    // Cancel the native invocation before returning; a late invocation with
    // the same attempt id is rejected by the native cancellation token.
    await dependencies.cancelInvocation(`${id}:${record.attempt}`)
    await commit((current) => current.map((item) => item.id === id && item.attempt === record.attempt && item.status === 'running' ? { ...item, status: 'cancelled', error: null, updatedAt: new Date().toISOString() } : item))
  }

  return {
    initialize,
    getSnapshot: () => records,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async start(capabilityId: string, job: string, input: unknown) {
      await initialize()
      const resolved = dependencies.resolve(capabilityId, job)
      const now = new Date().toISOString()
      const record: TaskRecord = {
        id: crypto.randomUUID(), capabilityId, capabilityVersion: resolved.version, job, ownerKind: resolved.ownerKind, scope: resolved.scope?.(input),
        input: structuredClone(input), status: 'running', stage: null, attempt: 1,
        checkpoints: {}, result: null, error: null, createdAt: now, updatedAt: now,
      }
      const definition = resolve(record)
      await commit((current) => {
        resolve(record)
        if (current.some((item) => item.capabilityId === capabilityId && item.job === job && item.scope === record.scope && item.status === 'running')) throw new Error('This job is already running')
        return [...current, record]
      })
      execute(record, definition)
      return record.id
    },
    cancel,
    async retry(id: string) {
      await initialize()
      const record = find(id)
      if (!['failed', 'interrupted', 'cancelled'].includes(record.status)) throw new Error('Only stopped tasks can be retried')
      const definition = resolve(record)
      const next = { ...record, status: 'running' as const, attempt: record.attempt + 1, error: null }
      await commit((current) => {
        resolve(record)
        if (current.some((item) => item.capabilityId === record.capabilityId && item.job === record.job && item.scope === record.scope && item.status === 'running')) throw new Error('This job is already running')
        return current.map((item) => item.id === id ? next : item)
      })
      execute(next, definition)
    },
    async withCapabilityStopped<T>(capabilityId: string, action: () => Promise<T>): Promise<T> {
      await initialize()
      if (pausedCapabilities.has(capabilityId)) throw new Error('Capability lifecycle change in progress')
      pausedCapabilities.add(capabilityId)
      try {
        await persistence
        await Promise.all(records.filter((record) => record.capabilityId === capabilityId && record.status === 'running').map((record) => cancel(record.id)))
        return await action()
      } finally {
        pausedCapabilities.delete(capabilityId)
      }
    },
    async settled(id: string) { await executions.get(id)?.done },
  }
}
