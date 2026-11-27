import type { ComponentType } from 'react'

export type AiInvocationResult = {
  provider: string
  model: string
  output: string
}

export type CapabilityEntrypoint = 'page' | 'command' | 'job'
export type CapabilityPermission = 'storage' | 'activity.read' | 'activity.write' | 'ai.invoke' | 'codex.sessions.read' | 'documents.publish' | 'documents.read-selected' | 'board.create' | 'board.attach-delivery' | 'conversations.handoff' | 'agents.run'
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
  purpose?: string
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

export type HostErrorCode = 'INVALID_INPUT' | 'PERMISSION_DENIED' | 'UNSUPPORTED_SERVICE' | 'CONFLICT' | 'RESOURCE_LIMIT' | 'RESOURCE_BUSY' | 'RESOURCE_UNAVAILABLE' | 'OUTCOME_UNKNOWN' | 'CANCELLED'
export type HostServiceError = Error & { readonly code: HostErrorCode }
export type LibrarySelectionRequest = {
  purpose: string
  /** This release supports document snapshots. Artifact requests fail explicitly. */
  kinds: ('document' | 'artifact')[]
  /** Document snapshots use text/markdown. Unsupported filters fail explicitly. */
  mediaTypes?: string[]
  limit?: number
}
export type LibrarySelectionResult = { status: 'dismissed' } | { status: 'selected'; grant: DocumentGrant }
export type IdempotencyOptions = { idempotencyKey: string }
/** Native-assigned opaque revision; compare for equality, never infer an edit count. */
export type BoardItemReference = { id: string; revision: number }
export type BoardSelectionRequest = { purpose: string; operations: ['attachDelivery']; limit?: number }
/** Metadata only. No task content, execution or acceptance authority is granted. */
export type BoardGrant = {
  id: string
  capabilityId: string
  capabilityVersion: string
  createdAt: string
  purpose: string
  operations: ['attachDelivery']
  items: (BoardItemReference & { title: string })[]
}
export type BoardSelectionResult = { status: 'dismissed' } | { status: 'selected'; grant: BoardGrant }
export type BoardDeliveryDocumentReference = Omit<DocumentReference, 'snapshotId' | 'locator'>
export type BoardAttachDeliveryInput = {
  grantId: string
  item: BoardItemReference
  title: string
  /** Own published documents or exact references from an active document selection; at most 50. */
  documents: BoardDeliveryDocumentReference[]
}
export type BoardAttachmentResult = { item: BoardItemReference; deliveryId: string }
export type BoardCreateInput = {
  title: string
  description?: string
  /** Nooki 0.6.0+: unchanged references from this package's active document selection (at most 50).
   * New creation requires current read-selected authority; exact committed replay does not reread sources.
   * Task/conversation snapshot IDs and locators are not accepted as creation inputs. */
  sources?: DocumentReference[]
}

export type ConversationHandoffInput = { title: string; text: string; sources?: DocumentReference[] }
export type ConversationHandoffTarget = { kind: 'new' } | { kind: 'conversation'; id: string }
export type ConversationHandoffReceipt = { draftId: string; target: ConversationHandoffTarget }
export type ConversationHandoffResult = { status: 'dismissed' } | { status: 'handedOff'; receipt: ConversationHandoffReceipt }

/** Selected snapshots only; execution policy and credentials belong to Nooki. */
export type AgentStartInput = {
  agentId: 'codex'
  instructions: string
  sources?: DocumentReference[]
  outputSchema?: CapabilityJsonSchema
}
export type AgentRunSnapshot = Readonly<{
  id: string
  agentId: 'codex'
  status: 'approved' | 'running' | 'unknown' | 'completed' | 'failed' | 'cancelled'
  /** Restored history is readable but cannot authorize execution or cancellation. */
  restored: boolean
  result: Readonly<{ text: string }> | null
}>
export type AgentStartResult = { status: 'dismissed' } | { status: 'started'; run: AgentRunSnapshot }
export type AvailableAgent = Readonly<{ id: 'codex'; name: string }>

export type CapabilityHost = {
  agents: {
    /** Returns only adapters ready for this invocation. An empty list is not a successful run. */
    listAvailable(): Promise<readonly AvailableAgent[]>
    /** Requires Host review. Retain the exact key/input; an uncertain reply never authorizes replay. */
    start(input: AgentStartInput, options: IdempotencyOptions): Promise<AgentStartResult>
    get(id: string): Promise<AgentRunSnapshot>
    /** Serial fresh snapshots, including an initial read. Unsubscribe never cancels execution. */
    subscribe(id: string, listener: (run: AgentRunSnapshot) => void, onError: (error: HostServiceError) => void): () => void
    /** Returns observed state; running/unknown means interruption is not yet confirmed. */
    cancel(id: string): Promise<AgentRunSnapshot>
  }

  conversations: {
    /** Nooki 0.11.0+: user-reviewed draft offer. Never sends a turn. Retry unchanged on uncertainty. */
    handoff(input: ConversationHandoffInput, options: IdempotencyOptions): Promise<ConversationHandoffResult>
  }
  library: {
    requestSelection(request: LibrarySelectionRequest): Promise<LibrarySelectionResult>
  }
  board: {
    /** Nooki 0.8.0+: approve exact task revisions for attaching a delivery. */
    requestSelection(request: BoardSelectionRequest): Promise<BoardSelectionResult>
    /** Nooki 0.9.0+: retain documents on the exact approved task version without accepting/executing. */
    attachDelivery(input: BoardAttachDeliveryInput, options: IdempotencyOptions): Promise<BoardAttachmentResult>
    /** Creates a draft item, never delegates work. Retry an uncertain outcome with the same key/input. */
    create(input: BoardCreateInput, options: IdempotencyOptions): Promise<BoardItemReference>
  }
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
