import { invoke } from '@tauri-apps/api/core'
import { taskRunner } from './tasks'
import { applyPackageStyles, loadPackageModule, removePackageStyles, type PackagePayload } from './package-loader'
import {
  installCapability as installNativeCapability,
  listCapabilities as listNativeCapabilities,
  setCapabilityEnabled as setNativeCapabilityEnabled,
  uninstallCapability as uninstallNativeCapability,
  updateCapability as updateNativeCapability,
} from './capability-host'
import type { CapabilityModule, InstalledCapability } from '../packages/capability-contract/src'

export type { CapabilityModule } from '../packages/capability-contract/src'

const browserInstalledKey = 'personal-workbench-installed-capabilities'

const discoveredModules = import.meta.glob('../capabilities/*/index.tsx', {
  eager: true,
  import: 'default',
}) as Record<string, CapabilityModule>

const availableCapabilities = Object.values(discoveredModules)
const externalModules = new Map<string, CapabilityModule>()
const runtimeInstalled = new Map<string, InstalledCapability>()
const loadErrors = new Map<string, string>()

export function getRuntimeInstalledCapability(id: string) { return runtimeInstalled.get(id) }
export function getCapabilityLoadError(id: string) { return loadErrors.get(id) }


function isDesktopHost(): boolean {
  return Boolean(window.__TAURI_INTERNALS__)
}

function readBrowserInstalledIds(): string[] {
  try {
    const raw = window.localStorage.getItem(browserInstalledKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeBrowserInstalledIds(ids: string[]): void {
  window.localStorage.setItem(browserInstalledKey, JSON.stringify(ids))
}

export function listAvailableCapabilities(): CapabilityModule[] {
  const catalog = new Map(availableCapabilities.map((module) => [module.manifest.id, module]))
  for (const installed of runtimeInstalled.values()) {
    if (installed.packageVersion) catalog.set(installed.manifest.id, externalModules.get(installed.manifest.id)
      ?? { manifest: installed.manifest, Page: () => null })
  }
  return [...catalog.values()]
}

export function getCapabilityModule(id: string): CapabilityModule | undefined {
  if (runtimeInstalled.get(id)?.packageVersion) return externalModules.get(id)
  return availableCapabilities.find((capability) => capability.manifest.id === id)
}

export async function listInstalledCapabilityPackages(): Promise<InstalledCapability[]> {
  if (isDesktopHost()) return listNativeCapabilities()

  const installedIds = new Set(readBrowserInstalledIds())
  return availableCapabilities
    .filter((capability) => installedIds.has(capability.manifest.id))
    .map((capability) => ({ manifest: capability.manifest, enabled: true }))
}

export async function installCapabilityPackage(id: string): Promise<InstalledCapability> {
  const capability = getCapabilityModule(id)
  if (!capability) throw new Error('找不到可安装的能力包')

  if (isDesktopHost()) {
    const installed = await installNativeCapability(capability.manifest)
    runtimeInstalled.set(id, installed)
    return installed
  }

  const installedIds = new Set(readBrowserInstalledIds())
  if (installedIds.has(id)) throw new Error('能力已经安装')
  installedIds.add(id)
  writeBrowserInstalledIds([...installedIds])
  const disabledIds = new Set(readBrowserDisabledIds())
  disabledIds.delete(id)
  window.localStorage.setItem(browserDisabledKey, JSON.stringify([...disabledIds]))
  const installed = { manifest: capability.manifest, enabled: true }
  runtimeInstalled.set(id, installed)
  return installed
}

export async function setCapabilityPackageEnabled(id: string, enabled: boolean): Promise<void> {
  await taskRunner.withCapabilityStopped(id, async () => {
    await changeCapabilityEnabled(id, enabled)
    const installed = runtimeInstalled.get(id)
    if (installed) runtimeInstalled.set(id, { ...installed, enabled })
  })
  await getInstalledCapabilityPackagesWithState()
}

async function changeCapabilityEnabled(id: string, enabled: boolean): Promise<void> {
  if (isDesktopHost()) {
    await setNativeCapabilityEnabled(id, enabled)
    return
  }

  const installedIds = new Set(readBrowserInstalledIds())
  if (!installedIds.has(id)) throw new Error('能力尚未安装')
  // The browser preview has no separate registry record for disabled packages.
  // Keep the state in a second key so package data remains untouched.
  const disabledIds = new Set(readBrowserDisabledIds())
  if (enabled) disabledIds.delete(id)
  else disabledIds.add(id)
  window.localStorage.setItem(browserDisabledKey, JSON.stringify([...disabledIds]))
}

const browserDisabledKey = 'personal-workbench-disabled-capabilities'

function readBrowserDisabledIds(): string[] {
  try {
    const raw = window.localStorage.getItem(browserDisabledKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export async function getInstalledCapabilityPackagesWithState(): Promise<InstalledCapability[]> {
  let installed = await listInstalledCapabilityPackages()
  if (isDesktopHost()) {
    for (const capability of installed) {
      const available = availableCapabilities.find((item) => item.manifest.id === capability.manifest.id)
      // Bundled updates may not silently expand the granted permissions.
      if (!capability.packageVersion && available && isNewerVersion(available.manifest.version, capability.manifest.version)
        && available.manifest.permissions.every((permission) => capability.manifest.permissions.includes(permission))) {
        await taskRunner.withCapabilityStopped(capability.manifest.id, () => updateNativeCapability(available.manifest))
      }
    }
    installed = await listNativeCapabilities()
  } else {
    const disabledIds = new Set(readBrowserDisabledIds())
    installed = installed.map((capability) => ({ ...capability, enabled: !disabledIds.has(capability.manifest.id) }))
  }
  runtimeInstalled.clear()
  installed.forEach((item) => runtimeInstalled.set(item.manifest.id, item))
  for (const capability of installed) {
    if (!capability.packageVersion || !capability.enabled) continue
    const id = capability.manifest.id
    if (externalModules.get(id)?.manifest.version === capability.packageVersion) continue
    try {
      const payload = await invoke<PackagePayload>('capability_package_read', { id, previous: false })
      externalModules.set(id, await loadPackageModule(payload))
      applyPackageStyles(id, payload.styles)
      loadErrors.delete(id)
    } catch (error) {
      externalModules.delete(id)
      loadErrors.set(id, String(error))
    }
  }
  return installed
}

export async function inspectCapabilityArchive(file: File): Promise<{ bytes: number[]; payload: PackagePayload; expectedVersion: string | null }> {
  if (!isDesktopHost()) throw new Error('独立能力包安装需要桌面版 Workbench / Desktop Workbench required')
  if (file.size > 12 * 1024 * 1024) throw new Error('能力包不能超过 12 MB / Package exceeds 12 MB')
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
  const payload = await invoke<PackagePayload>('capability_package_inspect', { bytes })
  return { bytes, payload, expectedVersion: runtimeInstalled.get(payload.manifest.id)?.manifest.version ?? null }
}

export async function installCapabilityArchive(candidate: Awaited<ReturnType<typeof inspectCapabilityArchive>>): Promise<void> {
  const { payload, bytes, expectedVersion } = candidate
  await taskRunner.withCapabilityStopped(payload.manifest.id, async () => {
    // Validate executable exports before changing the durable registry pointer.
    const module = await loadPackageModule(payload)
    const installed = await invoke<InstalledCapability>('capability_package_install', { bytes, expectedVersion })
    externalModules.set(payload.manifest.id, module)
    runtimeInstalled.set(payload.manifest.id, installed)
    applyPackageStyles(payload.manifest.id, payload.styles)
    loadErrors.delete(payload.manifest.id)
  })
}

export async function rollbackCapabilityPackage(id: string): Promise<void> {
  await taskRunner.withCapabilityStopped(id, async () => {
    const payload = await invoke<PackagePayload>('capability_package_read', { id, previous: true })
    const module = await loadPackageModule(payload)
    const installed = await invoke<InstalledCapability>('capability_package_rollback', { id, expectedVersion: runtimeInstalled.get(id)?.manifest.version })
    externalModules.set(id, module)
    runtimeInstalled.set(id, installed)
    applyPackageStyles(id, payload.styles)
    loadErrors.delete(id)
  })
}

function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
    return match ? match.slice(1).map(Number) : null
  }
  const candidateParts = parse(candidate)
  const currentParts = parse(current)
  if (!candidateParts || !currentParts) return false
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) return candidateParts[index] > currentParts[index]
  }
  return false
}

export async function uninstallCapabilityPackage(id: string): Promise<void> {
  await taskRunner.withCapabilityStopped(id, async () => {
    await removeCapabilityPackage(id)
    runtimeInstalled.delete(id)
    externalModules.delete(id)
    loadErrors.delete(id)
    removePackageStyles(id)
  })
}

async function removeCapabilityPackage(id: string): Promise<void> {
  if (isDesktopHost()) {
    await uninstallNativeCapability(id)
    return
  }

  const installedIds = new Set(readBrowserInstalledIds())
  if (!installedIds.delete(id)) throw new Error('能力尚未安装')
  writeBrowserInstalledIds([...installedIds])
  const disabledIds = new Set(readBrowserDisabledIds())
  disabledIds.delete(id)
  window.localStorage.setItem(browserDisabledKey, JSON.stringify([...disabledIds]))
}
