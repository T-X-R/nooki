import { invoke } from '@tauri-apps/api/core'
import type { AiInvocationResult } from './platform'
import type {
  ActivityEventInput,
  CapabilityEnvironment,
  CapabilityHost,
  CapabilityManifest,
  CapabilityPermission,
  CapabilityStorage,
  CodexDailySessionFiles,
  DocumentPublication,
  InstalledCapability,
} from '../packages/capability-contract/src'
import { publishCapabilityDocument } from './document-library'
import { capabilityTasks } from './tasks'
import { getRuntimeInstalledCapability } from './capability-runtime'

export type {
  ActivityEventInput,
  CapabilityEntrypoint,
  CapabilityEnvironment,
  CapabilityHost,
  CapabilityLanguage,
  CapabilityManifest,
  CapabilityManifestTranslation,
  CapabilityPermission,
  CapabilityStorage,
  CapabilityTheme,
  CodexDailySessionFiles,
  CodexSessionTextFile,
  DocumentPublication,
  InstalledCapability,
} from '../packages/capability-contract/src'

const storageMemory = new Map<string, string>()

function readEnvironment(): CapabilityEnvironment {
  const language = document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'zh'
  return Object.freeze({
    language,
    locale: language === 'en' ? 'en-US' : 'zh-CN',
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  })
}

function createEnvironment(): CapabilityHost['environment'] {
  let snapshot = readEnvironment()
  const listeners = new Set<() => void>()
  const observer = new MutationObserver(() => {
    const next = readEnvironment()
    if (next.language === snapshot.language && next.theme === snapshot.theme) return
    snapshot = next
    listeners.forEach((listener) => listener())
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'data-theme'] })

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
}

const capabilityEnvironment = createEnvironment()

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return storageMemory.get(key) ?? null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    storageMemory.set(key, value)
  }
}

function createStorage(capabilityId: string, permissions: CapabilityPermission[] | undefined, assertActive: () => void): CapabilityStorage {
  const prefix = `personal-workbench:capability:${capabilityId}:`
  const assertPermission = () => {
    assertActive()
    if (permissions && !permissions.includes('storage')) throw new Error('能力未获得 storage 权限')
  }
  return Object.freeze({
    async get<T>(key: string) {
      assertPermission()
      const raw = readStorage(`${prefix}${key}`)
      if (raw === null) return null
      try {
        return JSON.parse(raw) as T
      } catch {
        return null
      }
    },
    async set<T>(key: string, value: T) {
      assertPermission()
      writeStorage(`${prefix}${key}`, JSON.stringify(value))
    },
    async remove(key: string) {
      assertPermission()
      try {
        window.localStorage.removeItem(`${prefix}${key}`)
      } catch {
        storageMemory.delete(`${prefix}${key}`)
      }
    },
  })
}

function createActivityWriter(capabilityId: string, permissions: CapabilityPermission[] | undefined, assertActive: () => void) {
  const key = 'personal-workbench:activity-events'
  return {
    async write(event: ActivityEventInput) {
      assertActive()
      if (permissions && !permissions.includes('activity.write')) throw new Error('能力未获得 activity.write 权限')
      const raw = readStorage(key)
      let events: Array<ActivityEventInput & { id: string; occurredAt: string; source: string }> = []
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          events = Array.isArray(parsed) ? parsed as typeof events : []
        } catch {
          events = []
        }
      }
      events.push({
        ...event,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        occurredAt: new Date().toISOString(),
        source: capabilityId,
        sensitivity: event.sensitivity ?? 'normal',
      })
      writeStorage(key, JSON.stringify(events.slice(-200)))
    },
  }
}

export function createCapabilityHost(capabilityId: string, permissions?: CapabilityPermission[], capabilityName = capabilityId, execution?: { id: string; signal: AbortSignal }): CapabilityHost {
  if (!capabilityId.trim()) throw new Error('Capability ID is required')
  const assertActive = () => {
    execution?.signal.throwIfAborted()
    if (!getRuntimeInstalledCapability(capabilityId)?.enabled) throw new Error('Capability is not installed or enabled')
  }

  return Object.freeze({
    environment: capabilityEnvironment,
    tasks: capabilityTasks(capabilityId),
    storage: createStorage(capabilityId, permissions, assertActive),
    documents: Object.freeze({
      async publish(document: DocumentPublication): Promise<void> {
        assertActive()
        if (permissions && !permissions.includes('documents.publish')) {
          throw new Error('能力未获得 documents.publish 权限')
        }
        await publishCapabilityDocument(capabilityId, capabilityName, document)
      },
    }),
    activity: Object.freeze(createActivityWriter(capabilityId, permissions, assertActive)),
    codex: Object.freeze({
      sessions: Object.freeze({
        async readTodayFiles() {
          assertActive()
          if (permissions && !permissions.includes('codex.sessions.read')) {
            throw new Error('能力未获得 codex.sessions.read 权限')
          }
          try {
            return await invoke<CodexDailySessionFiles>('capability_codex_sessions_read_daily_files', {
              request: { capabilityId },
            })
          } catch (error) {
            throw new Error(typeof error === 'string' ? error : '读取 Codex sessions 失败')
          }
        },
      }),
    }),
    ai: Object.freeze({
      async invoke(input: string) {
        assertActive()
        try {
          return await invoke<AiInvocationResult>('capability_ai_invoke', {
            request: { capabilityId, input, executionId: execution?.id },
          })
        } catch (error) {
          throw new Error(typeof error === 'string' ? error : '能力调用 AI 失败')
        }
      },
    }),
  })
}

export async function installCapability(manifest: CapabilityManifest): Promise<InstalledCapability> {
  return invoke<InstalledCapability>('install_capability', { manifest })
}

export async function updateCapability(manifest: CapabilityManifest): Promise<InstalledCapability> {
  return invoke<InstalledCapability>('update_capability', { manifest })
}

export async function listCapabilities(): Promise<InstalledCapability[]> {
  return invoke<InstalledCapability[]>('list_capabilities')
}

export async function setCapabilityEnabled(id: string, enabled: boolean): Promise<void> {
  await invoke('set_capability_enabled', { id, enabled })
}

export async function uninstallCapability(id: string): Promise<void> {
  await invoke('uninstall_capability', { id })
}
