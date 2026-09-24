import * as React from 'react'
import * as JSXRuntime from 'react/jsx-runtime'
import type { CapabilityManifest, CapabilityModule } from '../../packages/capability-contract/src/index.ts'

export type PackagePayload = { manifest: CapabilityManifest; entry: string; styles: string }
type PackageWindow = Window & {
  WorkbenchReact?: typeof React
  WorkbenchJSXRuntime?: typeof JSXRuntime
  WorkbenchCapability?: CapabilityModule
}

const runtime = window as PackageWindow
runtime.WorkbenchReact = React
runtime.WorkbenchJSXRuntime = JSXRuntime
let loading: Promise<unknown> = Promise.resolve()

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasValidCommands(module: CapabilityModule) {
  if (!isObject(module.commands) || !Object.keys(module.commands).length) return false
  return Object.entries(module.commands).every(([id, command]) => {
    if (!/^[a-z][a-z0-9._-]*$/.test(id) || !isObject(command)) return false
    if (typeof command.job !== 'string' || !command.job.trim() || typeof module.jobs?.[command.job]?.run !== 'function') return false
    if (typeof command.title !== 'string' || !command.title.trim() || typeof command.description !== 'string' || !command.description.trim()) return false
    if (!isObject(command.inputSchema) || command.outputSchema !== undefined && !isObject(command.outputSchema)) return false
    if (!['read', 'draft', 'write', 'external'].includes(command.effect)) return false
    if (!['never', 'when-needed', 'always'].includes(command.confirmation)) return false
    if (command.acceptsConversationSources !== undefined && (command.acceptsConversationSources !== true
      || !module.manifest.permissions.includes('documents.read-selected') || command.inputSchema.type !== 'object'
      || isObject(command.inputSchema.properties) && Object.hasOwn(command.inputSchema.properties, 'conversationSources')
      || Array.isArray(command.inputSchema.required) && command.inputSchema.required.includes('conversationSources'))) return false
    if (command.locales !== undefined && (!isObject(command.locales) || Object.values(command.locales).some((translation) =>
      !isObject(translation) || typeof translation.title !== 'string' || !translation.title.trim()
        || translation.description !== undefined && typeof translation.description !== 'string'))) return false
    return true
  })
}

// Package v1 executes reviewed/trusted code in the host realm. It is not a
// sandbox for untrusted third-party JavaScript. Never evaluate during inspection.
export function loadPackageModule(payload: PackagePayload): Promise<CapabilityModule> {
  const operation = loading.then(async () => {
    runtime.WorkbenchCapability = undefined
    const url = URL.createObjectURL(new Blob([payload.entry], { type: 'text/javascript' }))
    const script = document.createElement('script')
    script.src = url
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (event: ErrorEvent) => {
          if (event.filename === url) finish(new Error(event.message))
        }
        window.addEventListener('error', onError)
        const finish = (error?: Error) => {
          window.removeEventListener('error', onError)
          error ? reject(error) : resolve()
        }
        script.onload = () => finish()
        script.onerror = () => finish(new Error('Could not load capability entry.js'))
        document.head.append(script)
      })
      const module = runtime.WorkbenchCapability as CapabilityModule | undefined
      if (!module || typeof module.Page !== 'function'
        || module.manifest.id !== payload.manifest.id || module.manifest.version !== payload.manifest.version
        || JSON.stringify(module.manifest.permissions) !== JSON.stringify(payload.manifest.permissions)
        || JSON.stringify(module.manifest.entrypoints) !== JSON.stringify(payload.manifest.entrypoints)
        || module.manifest.minPlatformVersion !== payload.manifest.minPlatformVersion) {
        throw new Error('Package export does not match its manifest or Page contract')
      }
      if (module.manifest.entrypoints.includes('job') && (!module.jobs || Object.values(module.jobs).some((job) => typeof job.run !== 'function'))) {
        throw new Error('Package declares jobs without executable job definitions')
      }
      if (module.manifest.entrypoints.includes('command') && !hasValidCommands(module)) {
        throw new Error('Package declares commands without valid command definitions backed by executable jobs')
      }
      if (!module.manifest.entrypoints.includes('command') && module.commands !== undefined) {
        throw new Error('Package exports commands without declaring the command entrypoint')
      }
      return { ...module, manifest: { ...module.manifest, ...payload.manifest } }
    } finally {
      script.remove()
      URL.revokeObjectURL(url)
      runtime.WorkbenchCapability = undefined
    }
  })
  loading = operation.catch(() => undefined)
  return operation
}

const styles = new Map<string, HTMLStyleElement>()
export function applyPackageStyles(id: string, source: string) {
  removePackageStyles(id)
  const style = document.createElement('style')
  style.dataset.capability = id
  style.textContent = source
  document.head.append(style)
  styles.set(id, style)
}
export function removePackageStyles(id: string) {
  styles.get(id)?.remove()
  styles.delete(id)
}
