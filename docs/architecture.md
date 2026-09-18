# Personal Workbench: first-version design

> **Status: historical design document.** This records the design the first version was built from.
> Parts of the stack section were not followed, and the shipped structure differs. Read
> [Where the implementation diverged](#10-where-the-implementation-diverged) before treating any
> statement here as current. For what the code does today, read [the README](../README.md) for the
> source layout and [INFRASTRUCTURE.md](../INFRASTRUCTURE.md) for the capability contracts.

## 1. Goals and non-goals

### Goals

The first version delivers a personal desktop app shell that can be maintained for a long time:

1. It is usable with no capability package installed.
2. The person can see the Capability Center, installation state, enabled/disabled state, and
   permission explanations.
3. Capabilities attach through a small, stable interface, so the business code for weekly reviews,
   tables, and journals stays out of the core.
4. An agent capability that reads activity events can be added later, but the first version wires up
   no specific model.
5. Local-first, single-user, no public distribution; updates are local development and manual
   installation.

### Non-goals

- No weekly review or table business pages in the first version. The journal is the first
  independent capability package, and it exists to prove the pluggable path.
- No remote capability marketplace, account system, collaboration, or cloud sync.
- No continuous capture of the screen, clipboard, or full application content by default.
- The model conversation box is not the star of the home page.
- Capability packages do not configure their own API key and do not read Codex login files.

## 2. Recommended stack

### Default: Tauri 2 + React + Vite + TypeScript

- **Desktop host**: Tauri 2. It provides a light desktop window, filesystem, and system-level
  capabilities. The frontend stays a web stack, and controlled commands are added in Rust when a
  native capability is actually needed.
- **Frontend**: React + Vite + TypeScript. A personal app needs no SSR, Vite's local development and
  build paths are shorter, and it suits lazy-loading capability interfaces per module.
- **Styling**: Tailwind CSS v4 with our own design tokens. Components use Radix Primitives (or
  equivalent accessible primitives). No template library's default look is mistaken for product
  design.
- **Motion**: Motion (`motion/react`), used only for page transitions, drawers, the command palette,
  and installation feedback. It respects `prefers-reduced-motion`.
- **Icons**: one icon family for the whole project.
- **State**: Zustand carries workbench session state only (active capability, command palette,
  theme). Capability data goes through host interfaces, so capabilities never share global state
  directly.
- **Local data**: the platform provides a storage adapter; a capability only ever sees a namespace
  keyed by its capability ID.
- **Packages**: the platform, the capability contract, the runtime, and future capability packages
  can be maintained separately, while the first version still ships a single desktop app.

### Update and maintenance strategy

- The platform core and the capability contract use semantic versioning. A capability manifest
  declares its minimum platform version.
- Platform data is upgraded only through migration scripts. A capability package may never alter
  platform tables.
- Daily development runs with hot reload; a local desktop bundle is produced when it is needed, with
  no release pipeline configured.
- Capability packages import and roll back independently. If a platform upgrade fails, the previous
  registry and a data backup are kept.

### AI Provider and unified credentials

The platform gains a global `Model Gateway` and `Agent Host`. A capability requests the `ai.invoke`
permission and calls through them; it stores no API key of its own. The call chain is:

```text
Capability → Model Gateway → Provider Resolver → Credential Broker → Responses API Adapter
Capability → Agent Host ──────────────────────────────────────────→ Codex Agent Runtime
```

#### The two credential sources must stay distinct

1. **Codex/ChatGPT subscription login** belongs to the Codex client on this machine. The platform
   neither reads nor copies the login token; the `Codex Subscription Adapter` invokes the local
   `codex exec` and lets Codex use its own default configuration and login state.
2. **API key**: the host imports the current model, the Responses protocol endpoint, and the
   credential source from `~/.codex/api.config.toml`, and the `Responses API Adapter` calls the
   endpoint directly. The key never reaches the frontend and is never handed to a capability package.

This is what makes "configure once, shared by the platform and every capability" possible without
treating a subscription as a general-purpose API key. A capability package no longer configures
credentials, but it still declares data permissions such as `activity.read` and tool permissions.

What the platform persists is a provider reference, never the secret itself:

```ts
type ProviderProfile = {
  id: string;
  kind: 'codex-api' | 'codex-subscription' | 'compatible-api';
  codexHome?: string;
  profile?: string;
  model?: string;
  baseUrl?: string;
  credentialRef?: string; // OS keychain / environment reference
};
```

#### Compatibility with an existing local Codex setup

At startup the platform can discover `CODEX_HOME` and the Codex profile the person selected, and read
the current model, provider, wire API, and base URL. The current desktop version offers two entry
points: `codex-api` imports a managed provider from `~/.codex/api.config.toml`, and
`codex-subscription` uses the default `~/.codex/config.toml` together with the Codex login state.
Each source is then handled on its own terms:

- Subscription/login state: go straight through `codex exec`, without copying the auth file.
- An API key from an environment variable or an API profile: resolved on demand by the host adapter
  and used directly, with no second entry by the capability.
- Migrating an inline plaintext API key into the system keychain later: only after an explicit prompt
  and confirmation, cleaning up the original afterwards. The platform database always holds a
  credential reference only.

That makes "no extra configuration for the platform or its capability packages" true, without
coupling Codex's private credential storage into the workbench.

#### Recommended provider strategy

- Settings offers one switchable call source: managed API key, Codex subscription, or a custom
  compatible endpoint.
- Importing non-sensitive Codex configuration (model, provider, base URL, profile) is supported.
  Authentication stays with the Codex CLI or the keychain; auth files are not parsed.
- A provider health check returns only available/unavailable and a reason. It never echoes a token, a
  request header, or a secret buried in a full error.
- Ordinary API key model calls go through the Responses API. Codex subscription agent work uses the
  CLI's `--ephemeral` flag and a restricted sandbox.
- Never switch providers automatically. The person can see the actual provider, model, and data scope
  for every agent task.
- The `Codex Agent Runtime` starts a child process with an argument array and an explicit
  `CODEX_HOME`, never a concatenated shell string. Timeouts, cancellation, and non-zero exits map to
  platform errors uniformly.

#### Compatible endpoints

The third Provider entry, `compatible-api`, is configured by the person rather than imported from a
Codex file. Nooki ships no vendor catalogue and no example endpoints: the person states a name, a
base URL, a model, a request protocol, and a credential.

- One managed adapter serves three request protocols: `responses` (OpenAI Responses), `chat` (OpenAI
  Chat Completions), and `anthropic` (Anthropic Messages). The adapter appends the protocol path to
  the configured base URL, sends the matching payload, and reads the matching text output.
- A credential is either stored on this device or read from a named environment variable. A loopback
  base URL may run without a credential, which keeps local runtimes usable.
- Stored endpoints live in `compatible-endpoints.json` inside the platform data directory, written
  through a temporary file and restricted to the current user on Unix.
- The interface never receives a key. Endpoint listings carry only a credential kind and a masked
  hint such as `••••1234`, and an update that leaves the key field empty keeps the stored credential.
- The person keeps several endpoints and switches the active one. The Model Gateway, the health
  check, and the test invocation all resolve that single active endpoint, so Capability Packages
  still request only `ai.invoke`.

#### The minimum interface for the Model Gateway and Agent Host

```ts
type ModelRequest = {
  capabilityId: string;
  input: string;
};

type ModelResult = {
  providerId: string;
  model: string;
  output: string;
};

interface ModelGateway {
  invoke(request: ModelRequest): Promise<ModelResult>;
}

type AgentRequest = {
  capabilityId: string;
  task: string;
  inputRefs: string[];              // references to activity events / capability data,
                                    // never a platform database handle
  tools?: Array<'activity.read' | 'files.read' | 'files.write'>;
  outputSchema?: unknown;
};

type AgentResult = {
  runId: string;
  providerId: string;
  model: string;
  output: unknown;
  inputRefs: string[];
};

interface AgentHost {
  run(request: AgentRequest): Promise<AgentResult>;
}
```

What matters about these two interfaces: a capability submits input or a task and never touches a
credential, while the platform owns provider selection, permission audit, cancellation, retry, and
the call record. Ordinary generation is not forced into an agent session.

### Why not Electron by default

Electron has the wider Node ecosystem, but it bundles a browser and a Node runtime together, at a
higher memory and package cost. This project is mainly a local productivity interface and needs no
native Node plugins, so Tauri comes first. If a future capability package has to lean heavily on a
native Node SDK, replace the host layer with Electron then — without changing the capability
contract.

### Why not a plain web app or PWA first

A plain web app or PWA produces pages fastest, but local storage, file import and export, system
shortcuts, and offline data isolation are all held back by browser permissions. It works as a
read-only companion later, not as the primary host now.

### If only macOS were ever supported

SwiftUI + AppKit would be a viable second route: the highest fidelity for native windows, shortcuts,
and system materials, but a higher cost for dynamic capability installation, cross-version contracts,
and reusing web capabilities. Unless you are certain you will only ever maintain macOS and are
willing to write capabilities as Swift modules too, Tauri 2 remains the recommendation.

## 3. Overall structure

```text
apps/desktop
├── shell                 # navigation, layout, command palette, empty states, settings
├── platform              # Tauri commands, storage, files/paths, logging
└── runtime               # capability discovery, validation, installation, enable/disable, routing

packages/capability-contract
└── manifest + host interface + shared value types

capabilities/             # distributable capability sources; one package per capability
└── diary/

installed-capabilities/   # the installed-state directory convention, separate from package sources
└── README.md
```

There is only one core dependency direction:

```text
Shell → Runtime → Capability Contract
Platform Adapter ────────────────┘
Capability Package → Host Interface (never back into Shell internals)
```

## 4. The pluggable capability contract

A capability exposes one registration entry point to the platform, and the platform hides the
complexity behind the Runtime and the Host Interface:

```ts
export type CapabilityManifest = {
  id: string;                 // stable reverse-domain id
  version: string;
  name: string;
  description: string;
  icon: string;
  entrypoints: Array<'page' | 'command' | 'widget' | 'job'>;
  permissions: Array<'storage' | 'activity.read' | 'activity.write' | 'ai.invoke' | 'documents.publish'>;
  minPlatformVersion: string;
};

export type CapabilityModule = {
  manifest: CapabilityManifest;
  register(host: CapabilityHost): void | Promise<void>;
};

export type CapabilityHost = {
  storage: CapabilityStorage;       // the capability's own namespace
  commands: CapabilityCommands;     // register/run visible commands
  activity: CapabilityActivity;     // permission-controlled activity read and write
  documents: CapabilityDocuments;   // the Document Gateway for publishing durable documents
  ui: CapabilityUi;                 // register pages, home widgets, and settings entries
};
```

Design constraints:

- A capability never imports `@tauri-apps/api`, a storage client, or a Shell page.
- `register` must be safe to call repeatedly. On disable, the Runtime revokes that capability's
  routes, commands, and jobs.
- The manifest is what installation review is based on. Permissions are shown at install time and
  checked again at runtime.
- A capability package carries a version and a minimum platform version. On incompatibility, show the
  reason rather than attempting a silent load.
- The first version supports importing a local directory or archive. Remote download and signature
  verification wait for the marketplace stage.

## 5. Lifecycle and state

```text
discovered → validated → installed → enabled → running
                                  ↘ disabled
installed/disabled → uninstalled (package and user data confirmed separately)
```

The `Capability Registry` records at least `id`, `version`, `source`, `installedAt`, `enabled`,
`manifestHash`, and `lastError`.

Installation has to be explainable:

1. Select a local capability package.
2. Show its name, version, entry points, and permissions.
3. Validate the manifest, the platform version, and ID conflicts.
4. Install into the application data directory and write the registry.
5. Enable and mount the entry points by default; the person can disable or uninstall it separately in
   the Capability Center.

### Package form and trust level

A capability package should be an importable archive containing at least `manifest.json`, a built ESM
entry point, and static assets. The first version only allows a person to import a trusted capability
from this machine, running in the same WebView process. That matches the maintenance cost and the
deep integration a personal app wants, but it must not be misdescribed as a security sandbox.

If third-party capability downloads are ever opened up, add a separate sandboxed run level then — a
separate WebView or iframe, signature verification, and finer permission proxying. Until that
isolation exists, a remote marketplace or installing other people's code must not be a product
promise.

## 6. The first-version interface

### Information architecture

- **Today**: the default home page. With no capabilities, it shows the Capability Center empty state
  and recent platform activity.
- **Capability Center**: installed, not enabled, and unavailable states. The first version provides a
  local import entry point and installation instructions.
- **Settings**: appearance, data directory, backup, and diagnostics.
- **AI settings**: the global provider source, current model, health check, and credential state.
  These do not reappear on a capability page.
- **Command palette**: `⌘K` / `Ctrl+K`. The first version carries navigation, theme switching, and
  the Capability Center entry only.

### Visual direction

- Light by default: cool grey background, near-black text, a single electric blue accent. Dark mode
  reuses the same hue and introduces no second colour system.
- A narrow left rail, a central workspace, and a right context drawer when needed. No permanent
  three-column dashboard.
- Express relationships with dividers, whitespace, and list hierarchy. Cards are only for genuinely
  actionable installation and permission objects.
- Corner radius stays in the 12–14px range. Buttons get compact tactile feedback, and page
  transitions stay between 160–220ms.
- An empty state explains why it is empty and what to do next, rather than showing an illustration.
- The first screen of the home page keeps one primary action: install your first capability.

### States that must be covered

- First launch, no capability package.
- Package importing, validation failure, permission confirmation, installation success.
- Installed but disabled, failed to enable, incompatible version.
- Data directory not writable, storage locked, capability runtime error.
- The agent empty state when there are no activity events (a placeholder in the first version; no
  model call).
- During an agent call: provider, model, input data scope, cancellation, retry, and failure states.

## 7. Activity events and the agent placeholder

The platform defines the record of fact only, never the summarization algorithm:

```ts
type ActivityEvent = {
  id: string;
  occurredAt: string;
  source: string;       // shell or capability id
  type: string;
  title: string;
  payload: unknown;
  sensitivity: 'normal' | 'private';
};
```

A future daily summary capability queries events in a time range through `activity.read`, calls
`ai.invoke` after the person confirms, and outputs a draft carrying its source event IDs. It does not
run in the background and does not upload raw data by default. The model provider and the prompts
belong to that capability's own implementation and never enter the platform core.

## 8. First-version milestones and acceptance

### M0: a running shell

- Desktop window launch, theme switching, routing, command palette.
- The home page and Capability Center empty states when no capability exists.
- A placeholder for global AI provider state in Settings (the first version may show "not configured"
  and perform no model call).

Acceptance: it still starts after deleting every future capability directory; theme and current page
survive a refresh.

### M1: the capability registry (no concrete capability shipped)

- Manifest types and a validator.
- Local import, install, enable, disable, and uninstall of a capability package.
- An installation review page showing permissions and version information.

Acceptance: a test capability package completes the whole lifecycle; once disabled, its pages,
commands, and jobs are all invisible; uninstalling the package does not delete user data by accident.

### M2: data and diagnostics groundwork

- A storage adapter, migrations, and backup export.
- Uniform error presentation and diagnostic logs.
- `Model Gateway`, `Document Gateway`, `Agent Host`, the Codex Agent Runtime, the Responses API
  Adapter, and the provider health check.

Acceptance: the registry and settings recover after a restart; a simulated storage lock produces an
actionable error; a test capability can only call `ModelGateway.invoke` or `AgentHost.run` and cannot
read credentials; the platform reuses an already-logged-in Codex CLI or a configured API key.

### M3: the first real capability

Build the journal before the weekly review: it exercises editing, storage, activity events, and later
agent input, without pulling in complex table interaction first.

As implemented: `capabilities/diary` is attached as an independent package. The Capability Center
discovers it from the package directory, and installed state lives in a separate registry. The
editor, the entry storage, and the `activity.write` calls are all implemented by the journal package
itself. Uninstalling removes only that package's installed state; it does not delete capability data
and does not change the platform or any other capability.

## 9. Decisions to avoid deliberately

- Do not make each capability a separate window or a separate database.
- Do not let a capability read platform tables directly.
- Do not preload weekly review, table, or journal business models into the platform core.
- Do not build remote accounts, payments, and a signing service on day one for the sake of a future
  plugin marketplace.
- Do not adopt AI purple gradients, a full-screen chat, or dense KPI cards as the default home page
  language.

## 10. Where the implementation diverged

Verified against the code on 2026-09-18. The design above is kept as written; these are the points
where it no longer describes the repository.

| Design says | The repository does |
|---|---|
| pnpm workspace | npm with `package-lock.json`. `packages/*` are plain directories, not workspace members. |
| `@phosphor-icons/react` | `@radix-ui/react-icons`. The "one icon family" rule still holds. |
| SQLite storage adapter | No SQLite dependency. Platform state is JSON files in the platform data directory, reached through Tauri commands, plus `localStorage` in the browser preview. |
| `apps/desktop/{shell,platform,runtime}` | `src/{app,features,platform,shared}` with the Rust host in `src-tauri/`. See the README for the layout and its layering rule. |
| Permissions end at `documents.publish` | The contract also carries `codex.sessions.read` and `documents.read-selected`. |

Two later decisions are not reflected in the body above at all: the Document Gateway
([ADR 0003](adr/0003-platform-owned-document-library.md)) and the Skill Pool
([ADR 0004](adr/0004-platform-owned-skill-pool.md)).
