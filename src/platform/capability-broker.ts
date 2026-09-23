import Ajv, { type ErrorObject } from 'ajv'
import type {
  CapabilityCommand,
  CapabilityCommandConfirmation,
  CapabilityCommandEffect,
  CapabilityLanguage,
  CapabilityModule,
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
}>

export type BrokerCommandDescription = BrokerCommandSummary & Readonly<{
  inputSchema: Readonly<Record<string, unknown>>
  outputSchema?: Readonly<Record<string, unknown>>
}>

export type BrokerConfirmationProposal = Readonly<{
  invocationId: string
  command: BrokerCommandDescription
  input: unknown
}>

export type BrokerExecution = Readonly<{
  taskId: string
  status: TaskStatus
  result: unknown
  error?: string | null
}>

export type CapabilityBrokerDependencies = Readonly<{
  listCapabilities(): readonly BrokerCatalogEntry[]
  execute(capabilityId: string, job: string, input: unknown): Promise<BrokerExecution>
  confirm(proposal: BrokerConfirmationProposal): Promise<boolean>
}>

export type CapabilityBrokerRequest =
  | Readonly<{ action: 'search'; query?: string; capabilityId?: string; language?: CapabilityLanguage }>
  | Readonly<{ action: 'describe'; capabilityId: string; commandId: string; language?: CapabilityLanguage }>
  | Readonly<{ action: 'invoke'; invocationId: string; capabilityId: string; commandId: string; input: unknown; language?: CapabilityLanguage }>

export type CapabilityBrokerErrorCode =
  | 'COMMAND_NOT_AVAILABLE'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'CONFIRMATION_DENIED'
  | 'INVOCATION_CONFLICT'
  | 'EXECUTION_FAILED'
  | 'EXECUTION_CANCELLED'
  | 'EXECUTION_INTERRUPTED'

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
    }))
  })
}

function validationMessage(errors: ErrorObject[] | null | undefined) {
  if (!errors?.length) return 'Input does not match the command schema'
  return errors.map((error) => {
    const path = error.instancePath || error.params && 'missingProperty' in error.params && `/${String(error.params.missingProperty)}` || '/'
    return `${path} ${error.message ?? 'is invalid'}`
  }).join('; ')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}

function needsConfirmation(command: CapabilityCommand) {
  if (command.confirmation === 'always') return true
  return command.confirmation === 'when-needed' && ['write', 'external'].includes(command.effect)
}

export function createCapabilityBroker(dependencies: CapabilityBrokerDependencies) {
  const invocations = new Map<string, { signature: string; response: Promise<CapabilityBrokerResponse> }>()

  const find = (capabilityId: string, commandId: string, language?: CapabilityLanguage) =>
    enabledCommands(dependencies.listCapabilities(), language).find((item) =>
      item.description.capabilityId === capabilityId && item.description.commandId === commandId)

  const invoke = async (request: Extract<CapabilityBrokerRequest, { action: 'invoke' }>): Promise<CapabilityBrokerResponse> => {
    const selected = find(request.capabilityId, request.commandId, request.language)
    if (!selected) return failure('COMMAND_NOT_AVAILABLE', 'Capability command is not installed, enabled, or available')

    let validate
    try { validate = ajv.compile(selected.command.inputSchema) }
    catch { return failure('INVALID_INPUT', 'Capability command has an invalid input schema') }
    if (!validate(request.input)) return failure('INVALID_INPUT', validationMessage(validate.errors))

    if (needsConfirmation(selected.command) && !await dependencies.confirm({
      invocationId: request.invocationId,
      command: selected.description,
      input: request.input,
    })) return failure('CONFIRMATION_DENIED', 'Capability command was not confirmed')

    let execution: BrokerExecution
    try { execution = await dependencies.execute(request.capabilityId, selected.command.job, request.input) }
    catch (error) {
      return failure('EXECUTION_FAILED', error instanceof Error && error.message ? error.message : 'Capability command failed')
    }

    if (execution.status === 'completed') {
      if (selected.command.outputSchema) {
        let validateOutput
        try { validateOutput = ajv.compile(selected.command.outputSchema) }
        catch { return failure('INVALID_OUTPUT', 'Capability command has an invalid output schema') }
        if (!validateOutput(execution.result)) return failure('INVALID_OUTPUT', 'Capability command returned an invalid result')
      }
      return { ok: true, action: 'invoke', invocationId: request.invocationId, taskId: execution.taskId, status: 'completed', result: execution.result }
    }
    if (execution.status === 'cancelled') return failure('EXECUTION_CANCELLED', execution.error || 'Capability command was cancelled')
    if (execution.status === 'interrupted') return failure('EXECUTION_INTERRUPTED', execution.error || 'Capability command was interrupted')
    return failure('EXECUTION_FAILED', execution.error || 'Capability command failed')
  }

  return {
    async handle(request: CapabilityBrokerRequest): Promise<CapabilityBrokerResponse> {
      if (request.action === 'search') {
        const query = request.query?.trim().toLocaleLowerCase() ?? ''
        const commands = enabledCommands(dependencies.listCapabilities(), request.language)
          .filter(({ description }) => !request.capabilityId || description.capabilityId === request.capabilityId)
          .filter(({ description }) => !query || [description.capabilityId, description.capabilityName, description.commandId, description.title, description.description]
            .some((value) => value.toLocaleLowerCase().includes(query)))
          .map(({ description: { inputSchema: _input, outputSchema: _output, ...summary } }) => summary)
        return { ok: true, action: 'search', commands }
      }
      if (request.action === 'describe') {
        const selected = find(request.capabilityId, request.commandId, request.language)
        return selected
          ? { ok: true, action: 'describe', command: selected.description }
          : failure('COMMAND_NOT_AVAILABLE', 'Capability command is not installed, enabled, or available')
      }

      const signature = canonical(request)
      const existing = invocations.get(request.invocationId)
      if (existing) return existing.signature === signature
        ? existing.response
        : failure('INVOCATION_CONFLICT', 'Invocation ID was already used with different arguments')
      const response = invoke(request)
      invocations.set(request.invocationId, { signature, response })
      return response
    },
  }
}
