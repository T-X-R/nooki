import type { ComponentType } from 'react'

export type AiInvocationResult = {
  provider: string
  model: string
  output: string
}

export type CapabilityEntrypoint = 'page' | 'command' | 'widget' | 'job'
export type CapabilityPermission = 'storage' | 'activity.read' | 'activity.write' | 'ai.invoke' | 'codex.sessions.read' | 'documents.publish' | 'documents.read-selected'
export type CapabilityLanguage = 'zh' | 'en'
export type CapabilityTheme = 'light' | 'dark'

export type CapabilityEnvironment = Readonly<{
  language: CapabilityLanguage
  locale: 'zh-CN' | 'en-US'
  theme: CapabilityTheme
}>

export type CapabilityManifestTranslation = {
  name: string
  description?: string
}

export type CapabilityManifest = {
  id: string
  version: string
  name: string
  description?: string
  icon?: string
  locales?: Partial<Record<CapabilityLanguage, CapabilityManifestTranslation>>
  entrypoints: CapabilityEntrypoint[]
  permissions: CapabilityPermission[]
  minPlatformVersion: string
}

export type InstalledCapability = {
  manifest: CapabilityManifest
  enabled: boolean
  packageVersion?: string
  previousPackageVersion?: string
}

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type TaskRecord = Readonly<{
  // Missing ownerKind denotes a legacy Capability task. Existing wire names remain compatible.
  ownerKind?: 'platform'
  scope?: string
  id: string
  capabilityId: string
  capabilityVersion: string
  job: string
  input: unknown
  status: TaskStatus
  stage: string | null
  attempt: number
  checkpoints: Record<string, unknown>
  result: unknown
  error: string | null
  createdAt: string
  updatedAt: string
}>

export type CapabilityTasks = {
  getSnapshot(): readonly TaskRecord[]
  subscribe(listener: () => void): () => void
  start(job: string, input: unknown): Promise<string>
  cancel(id: string): Promise<void>
  retry(id: string): Promise<void>
}

export type CapabilityTaskContext = {
  host: Omit<CapabilityHost, 'tasks'>
  signal: AbortSignal
  // Completed steps are reused on retry. Side effects must be idempotent:
  // an app exit can occur between the side effect and checkpoint persistence.
  step<T>(key: string, operation: () => Promise<T>): Promise<T>
}

export type CapabilityJob = {
  run(input: unknown, context: CapabilityTaskContext): Promise<unknown>
}

export type CapabilityJsonSchema = Readonly<Record<string, unknown>>
export type CapabilityCommandEffect = 'read' | 'draft' | 'write' | 'external'
export type CapabilityCommandConfirmation = 'never' | 'when-needed' | 'always'

export type CapabilityCommandTranslation = {
  title: string
  description?: string
}

// Jobs are private execution units. Commands are the explicit, user-facing
// surface that conversations and other platform clients may discover.
export type CapabilityCommand = {
  job: string
  title: string
  description: string
  locales?: Partial<Record<CapabilityLanguage, CapabilityCommandTranslation>>
  inputSchema: CapabilityJsonSchema
  outputSchema?: CapabilityJsonSchema
  effect: CapabilityCommandEffect
  confirmation: CapabilityCommandConfirmation
  // Nooki supplies this turn's attached sources in input.conversationSources.
  // Agents cannot provide or select this reserved field.
  acceptsConversationSources?: boolean
}

export type ConversationCapabilitySource = Readonly<{
  kind: 'library' | 'upload'
  title: string
  content: string
  documentDate?: string
  reference?: DocumentReference
}>

export type ActivityEventInput = {
  type: string
  title: string
  key?: string
  target?: DocumentReference
  payload?: unknown
  sensitivity?: 'normal' | 'private'
}

export type CapabilityStorage = {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

export type CodexSessionTextFile = {
  name: string
  archived: boolean
  content: string
}

export type CodexDailySessionFiles = {
  date: string
  files: CodexSessionTextFile[]
}

// Snapshot identity is independent of the producing Capability's private storage.
// Future evidence can add a quote locator without changing the document identity.
export type DocumentReference = {
  kind: 'library-document'
  documentId: string
  title: string
  grantId?: string
  snapshotId?: string
  revision?: string
  locator?: { quote: string }
}

export type SelectedDocument = {
  reference: DocumentReference
  documentDate: string
  content: string
}

export type DocumentGrant = {
  id: string
  capabilityId: string
  capabilityVersion: string
  createdAt: string
  documents: Omit<SelectedDocument, 'content'>[]
}

export type ActivityEvent = ActivityEventInput & {
  id: string
  source: string
  occurredAt: string
  taskId?: string
}

export type DocumentPublication = {
  activity?: { type: string; title: string; key?: string }

  key: string
  title: string
  collectionKey: string
  collectionName: string
  documentDate: string
  content: string
}

export type CapabilityHost = {
  tasks: CapabilityTasks
  environment: {
    getSnapshot(): CapabilityEnvironment
    subscribe(listener: () => void): () => void
  }
  ai: {
    invoke(input: string): Promise<AiInvocationResult>
  }
  codex: {
    sessions: {
      readTodayFiles(): Promise<CodexDailySessionFiles>
    }
  }
  storage: CapabilityStorage
  documents: {
    publish(document: DocumentPublication): Promise<void>
    listGrants(): Promise<DocumentGrant[]>
    readSelected(grantId: string, documentId: string): Promise<SelectedDocument>
    open(reference: DocumentReference): void
  }
  activity: {
    write(event: ActivityEventInput): Promise<void>
  }
}

export type CapabilityPageProps = {
  host: CapabilityHost
}

export type CapabilityModule = {
  manifest: CapabilityManifest
  Page: ComponentType<CapabilityPageProps>
  jobs?: Record<string, CapabilityJob>
  commands?: Record<string, CapabilityCommand>
}
