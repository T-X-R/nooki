import Ajv, { type ErrorObject } from 'ajv'
import type {
  CapabilityCommand,
  CapabilityCommandConfirmation,
  CapabilityCommandEffect,
  CapabilityLanguage,
  CapabilityModule,
  ConversationCapabilitySource,
  InstalledCapability,
  TaskStatus,
} from '../../packages/capability-contract/src/index.ts'

export type BrokerCatalogEntry = Readonly<{
  module: CapabilityModule
  installed: InstalledCapability
}>

export type BrokerCommandSummary = Readonly<{
  capabilityId: string
  capabilityName: string
  commandId: string
  title: string
  description: string
  effect: CapabilityCommandEffect
  confirmation: CapabilityCommandConfirmation
  acceptsConversationSources?: boolean
}>

export type BrokerCommandDescription = BrokerCommandSummary & Readonly<{
  inputSchema: Readonly<Record<string, unknown>>
  outputSchema?: Readonly<Record<string, unknown>>
}>

export type BrokerConfirmationProposal = Readonly<{
  invocationId: string
  command: BrokerCommandDescription
  input: unknown
  language?: CapabilityLanguage
  context?: BrokerInvocationContext
  sources?: readonly Readonly<{ kind: 'library' | 'upload'; title: string }>[]
}>

export type BrokerInvocationContext = Readonly<{
  threadId: string
  turnId: string
  agent: string
}>

export type BrokerInvocationStatus = 'proposed' | 'awaiting_confirmation' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type BrokerInvocationUpdate = BrokerConfirmationProposal & Readonly<{
  status: BrokerInvocationStatus
  taskId?: string
  result?: unknown
  error?: string
}>

export type BrokerExecution = Readonly<{
  taskId: string
  status: TaskStatus
  result: unknown
  error?: string | null
}>

export type CapabilityBrokerDependencies = Readonly<{
  listCapabilities(): readonly BrokerCatalogEntry[]
  execute(capabilityId: string, job: string, input: unknown, onStarted: (taskId: string) => void): Promise<BrokerExecution>
  conversationSources?(context: BrokerInvocationContext): readonly ConversationCapabilitySource[]
  confirm(proposal: BrokerConfirmationProposal): Promise<boolean>
  onInvocation?(update: BrokerInvocationUpdate): void
  recoverInvocation?(request: Extract<CapabilityBrokerRequest, { action: 'invoke' }>): CapabilityBrokerResponse | 'conflict' | undefined
}>

export type CapabilityBrokerRequest =
  | Readonly<{ action: 'search'; query?: string; capabilityId?: string; language?: CapabilityLanguage }>
  | Readonly<{ action: 'describe'; capabilityId: string; commandId: string; language?: CapabilityLanguage }>
  | Readonly<{ action: 'invoke'; invocationId: string; capabilityId: string; commandId: string; input: unknown; language?: CapabilityLanguage; context?: BrokerInvocationContext }>

export type CapabilityBrokerErrorCode =
  | 'COMMAND_NOT_AVAILABLE'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'CONFIRMATION_DENIED'
  | 'INVOCATION_CONFLICT'
  | 'INVOCATION_LIMIT'
  | 'EXECUTION_FAILED'
  | 'EXECUTION_CANCELLED'
  | 'EXECUTION_INTERRUPTED'
  | 'CONVERSATION_SOURCE_UNAVAILABLE'

export type CapabilityBrokerResponse =
  | Readonly<{ ok: true; action: 'search'; commands: readonly BrokerCommandSummary[] }>
  | Readonly<{ ok: true; action: 'describe'; command: BrokerCommandDescription }>
  | Readonly<{ ok: true; action: 'invoke'; invocationId: string; taskId: string; status: 'completed'; result: unknown }>
  | Readonly<{ ok: false; error: Readonly<{ code: CapabilityBrokerErrorCode; message: string }> }>

const ajv = new Ajv({ allErrors: true, strict: false })

function failure(code: CapabilityBrokerErrorCode, message: string): CapabilityBrokerResponse {
  return { ok: false, error: { code, message } }
}

function commandCopy(module: CapabilityModule, commandId: string, command: CapabilityCommand, language: CapabilityLanguage = 'en'): BrokerCommandDescription {
  const capabilityTranslation = module.manifest.locales?.[language]
  const commandTranslation = command.locales?.[language]
  return {
    capabilityId: module.manifest.id,
    capabilityName: capabilityTranslation?.name || module.manifest.name,
    commandId,
    title: commandTranslation?.title || command.title,
    description: commandTranslation?.description ?? command.description,
    effect: command.effect,
    confirmation: command.confirmation,
    ...(command.acceptsConversationSources && { acceptsConversationSources: true }),
    inputSchema: command.inputSchema,
    outputSchema: command.outputSchema,
  }
}

function enabledCommands(entries: readonly BrokerCatalogEntry[], language?: CapabilityLanguage) {
  return entries.flatMap(({ module, installed }) => {
    if (!installed.enabled || !module.manifest.entrypoints.includes('command') || !module.commands) return []
    return Object.entries(module.commands).map(([commandId, command]) => ({
      module,
      command,
      description: commandCopy(module, commandId, command, language),
    })).filter(({ command }) => !command.acceptsConversationSources || module.manifest.permissions.includes('documents.read-selected') && command.inputSchema.type === 'object')
  })
}

function validationMessage(errors: ErrorObject[] | null | undefined) {
  if (!errors?.length) return 'Input does not match the command schema'
  return errors.map((error) => {
    const path = error.instancePath || error.params && 'missingProperty' in error.params && `/${String(error.params.missingProperty)}` || '/'
    return `${path} ${error.message ?? 'is invalid'}`
  }).join('; ')
}

export function canonicalBrokerValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBrokerValue).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalBrokerValue(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}

export function capabilityInvocationSignature(request: Extract<CapabilityBrokerRequest, { action: 'invoke' }>) {
  return canonicalBrokerValue({
    action: request.action,
    invocationId: request.invocationId,
    capabilityId: request.capabilityId,
    commandId: request.commandId,
    input: request.input,
    language: request.language,
    context: request.context,
  })
}

function needsConfirmation(command: CapabilityCommand) {
  return command.confirmation === 'always' || ['write', 'external'].includes(command.effect)
}

export function createCapabilityBroker(dependencies: CapabilityBrokerDependencies) {
  const maximumInvocations = 1_000
  const invocations = new Map<string, { signature: string; response: Promise<CapabilityBrokerResponse> }>()

  const find = (capabilityId: string, commandId: string, language?: CapabilityLanguage) =>
    enabledCommands(dependencies.listCapabilities(), language).find((item) =>
      item.description.capabilityId === capabilityId && item.description.commandId === commandId)

  const invoke = async (request: Extract<CapabilityBrokerRequest, { action: 'invoke' }>): Promise<CapabilityBrokerResponse> => {
    const selected = find(request.capabilityId, request.commandId, request.language)
    if (!selected) return failure('COMMAND_NOT_AVAILABLE', 'Capability command is not installed, enabled, or available')

    if (selected.command.acceptsConversationSources && request.input && typeof request.input === 'object' && Object.hasOwn(request.input, 'conversationSources')) return failure('INVALID_INPUT', 'conversationSources is reserved for Nooki')
    let validate
    try { validate = ajv.compile(selected.command.inputSchema) }
    catch { return failure('INVALID_INPUT', 'Capability command has an invalid input schema') }
    if (!validate(request.input)) return failure('INVALID_INPUT', validationMessage(validate.errors))

    let sources: readonly ConversationCapabilitySource[] = []
    if (selected.command.acceptsConversationSources) {
      if (!request.context || !dependencies.conversationSources) return failure('CONVERSATION_SOURCE_UNAVAILABLE', 'A live conversation turn is required for attached sources')
      try { sources = dependencies.conversationSources(request.context) }
      catch { return failure('CONVERSATION_SOURCE_UNAVAILABLE', 'Attached sources are unavailable for this conversation turn') }
    }

    const proposal = { invocationId: request.invocationId, command: selected.description, input: request.input, language: request.language, context: request.context,
      ...(sources.length && { sources: sources.map(({ kind, title }) => ({ kind, title })) }) }
    dependencies.onInvocation?.({ ...proposal, status: 'proposed' })

    if (sources.length || needsConfirmation(selected.command)) {
      dependencies.onInvocation?.({ ...proposal, status: 'awaiting_confirmation' })
      if (!await dependencies.confirm(proposal)) {
        dependencies.onInvocation?.({ ...proposal, status: 'cancelled', error: 'Capability command was not confirmed' })
        return failure('CONFIRMATION_DENIED', 'Capability command was not confirmed')
      }
    }

    let execution: BrokerExecution
    let started = false
    try {
      const input = selected.command.acceptsConversationSources ? { ...(request.input as Record<string, unknown>), conversationSources: sources } : request.input
      execution = await dependencies.execute(request.capabilityId, selected.command.job, input, (taskId) => {
        started = true
        dependencies.onInvocation?.({ ...proposal, status: 'running', taskId })
      })
    }
    catch (error) {
      const message = error instanceof Error && error.message ? error.message : 'Capability command failed'
      dependencies.onInvocation?.({ ...proposal, status: 'failed', error: message })
      return failure('EXECUTION_FAILED', message)
    }
    if (!started) dependencies.onInvocation?.({ ...proposal, status: 'running', taskId: execution.taskId })

    if (execution.status === 'completed') {
      if (selected.command.outputSchema) {
        let validateOutput
        try { validateOutput = ajv.compile(selected.command.outputSchema) }
        catch {
          dependencies.onInvocation?.({ ...proposal, status: 'failed', taskId: execution.taskId, error: 'Capability command has an invalid output schema' })
          return failure('INVALID_OUTPUT', 'Capability command has an invalid output schema')
        }
        if (!validateOutput(execution.result)) {
          dependencies.onInvocation?.({ ...proposal, status: 'failed', taskId: execution.taskId, error: 'Capability command returned an invalid result' })
          return failure('INVALID_OUTPUT', 'Capability command returned an invalid result')
        }
      }
      dependencies.onInvocation?.({ ...proposal, status: 'completed', taskId: execution.taskId, result: execution.result })
      return { ok: true, action: 'invoke', invocationId: request.invocationId, taskId: execution.taskId, status: 'completed', result: execution.result }
    }
    if (execution.status === 'cancelled') {
      dependencies.onInvocation?.({ ...proposal, status: 'cancelled', taskId: execution.taskId, error: execution.error || undefined })
      return failure('EXECUTION_CANCELLED', execution.error || 'Capability command was cancelled')
    }
    if (execution.status === 'interrupted') {
      dependencies.onInvocation?.({ ...proposal, status: 'interrupted', taskId: execution.taskId, error: execution.error || undefined })
      return failure('EXECUTION_INTERRUPTED', execution.error || 'Capability command was interrupted')
    }
    dependencies.onInvocation?.({ ...proposal, status: 'failed', taskId: execution.taskId, error: execution.error || 'Capability command failed' })
    return failure('EXECUTION_FAILED', execution.error || 'Capability command failed')
  }

  return {
    async handle(request: CapabilityBrokerRequest): Promise<CapabilityBrokerResponse> {
      if (request.action === 'search') {
        // Command summaries are the capability catalog. The agent matches the user's intent
        // against this small catalog; a literal query must never hide a useful capability.
        const commands = enabledCommands(dependencies.listCapabilities(), request.language)
          .filter(({ description }) => !request.capabilityId || description.capabilityId === request.capabilityId)
          .map(({ description: { inputSchema: _input, outputSchema: _output, ...summary } }) => summary)
        return { ok: true, action: 'search', commands }
      }
      if (request.action === 'describe') {
        const selected = find(request.capabilityId, request.commandId, request.language)
        return selected
          ? { ok: true, action: 'describe', command: selected.description }
          : failure('COMMAND_NOT_AVAILABLE', 'Capability command is not installed, enabled, or available')
      }

      const signature = capabilityInvocationSignature(request)
      const existing = invocations.get(request.invocationId)
      if (existing) return existing.signature === signature
        ? existing.response
        : failure('INVOCATION_CONFLICT', 'Invocation ID was already used with different arguments')
      const recovered = dependencies.recoverInvocation?.(request)
      if (recovered === 'conflict') return failure('INVOCATION_CONFLICT', 'Invocation ID was already used with different arguments')
      if (recovered) {
        invocations.set(request.invocationId, { signature, response: Promise.resolve(recovered) })
        return recovered
      }
      if (invocations.size >= maximumInvocations) return failure('INVOCATION_LIMIT', 'Capability invocation limit reached; restart Nooki before starting more commands')
      const response = invoke(request)
      invocations.set(request.invocationId, { signature, response })
      return response
    },
  }
}
