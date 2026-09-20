# ADR 0002: The platform manages the AI Provider; Capability Packages hold no credentials

- Status: superseded by [ADR 0005](0005-nooki-is-the-agent-substrate.md)
- Date: 2026-09-03

## Context

The workbench and several capabilities may each want an agent. If every capability configured its own
API key, the result would be repeated configuration, leaked secrets, and no usable call audit. A
person expects to configure the Codex setup on this machine once and have the platform and its
capabilities reuse it.

## Decision

The platform core provides a `Model Gateway`, an `Agent Host`, and a `Credential Broker`:

- A capability requests only `ai.invoke`. Ordinary model calls go through `ModelGateway.invoke()`;
  work that needs tools and process management goes through `AgentHost.run()`.
- The `Codex API Profile Importer` reads only the current provider's model, protocol, endpoint, and
  credential source from `~/.codex/api.config.toml`.
- The `Responses API Adapter` calls the model endpoint from inside the host process, so one API key
  provider can serve every authorized capability.
- The `Codex Subscription Adapter` reuses the machine's `~/.codex/config.toml` and login state
  through the default `codex exec`.
- The frontend and Capability Packages never receive a raw token, API key, or Codex auth file.

The current version reads the API profile on demand inside the host process and neither copies nor
displays the credentials in it. If a person later confirms migrating a plaintext API key out of a
config file, the platform moves it into the system keychain only, and never retains the original in
the platform database. Subscription login stays with the CLI.

## The distinction that matters

A Codex/ChatGPT subscription login and an OpenAI API key are not the same kind of credential. A
subscription login is usable only by a Codex client that supports that login state; an API key is the
credential meant for API calls. The platform can manage both provider kinds, but it must never
forward a subscription token to an arbitrary HTTP client as though it were an API key.

## Security defaults

- API key providers are called through the host's Responses API Adapter. Codex subscription work uses
  `codex exec --ephemeral` with a restricted sandbox.
- File writes, external commands, and network access follow capability permissions and per-task
  confirmation.
- Never switch providers automatically, and never echo request headers or secrets in error messages.
- The active provider is chosen by the person in Settings. Only the provider kind is stored; neither
  config file nor its auth content is copied.
- Every call records the capability ID, provider, model, input references, duration, and result
  state. Raw credentials are never recorded.

## Consequences and mitigations

- The Responses API Adapter has to handle protocols, timeouts, and vendor errors. Keep it in a single
  host module and contract-test it against a local fake HTTP server.
- Running through the Codex CLI still means handling process lifecycle, JSON output, and
  cancellation. Keep that only in the subscription adapter.
- Keychain storage for API keys needs a per-platform implementation. The first version can support
  environment variables plus the system keychain of the current desktop platform.
- A capability can still submit sensitive content to a model. Control that separately through data
  permissions such as `activity.read` and `files.read`, and show the data scope before a task starts.

## Follow-up (2026-09-17): user-configured compatible endpoints

The `compatible-api` Provider is now implemented. A person configures a name, base URL, model,
request protocol, and credential; Nooki proposes no vendor list and no example endpoints.

- One managed adapter covers the OpenAI Responses, OpenAI Chat Completions, and Anthropic Messages
  protocols, so a single Provider selection reaches any of those services.
- A credential is either stored on this device or referenced through an environment variable. Storing
  a key locally is a deliberate exception to "references only": a person who brings their own key
  needs it to survive a restart, and no credential is exposed to the interface or to Capability
  Packages.
- The key file sits in the platform data directory, is written atomically, and is restricted to the
  current user on Unix. Moving it into the system keychain stays the next step and does not change
  this contract.
- Listings return a credential kind and a masked hint only, and an update that leaves the key field
  empty keeps the stored credential.

## Not decided here

- Specific models, temperatures, prompts, and the agent orchestration framework.
- Whether local Ollama or LM Studio will be supported later. If they are, it only takes another
  Provider Adapter.
