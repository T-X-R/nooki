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

### Model access, and why Nooki has none of its own

Nooki holds no model credentials and sends no model requests. A Capability requests the `ai.invoke`
permission and calls through the `Model Gateway`, which hands the request to one of the coding agents
installed on this machine. See [ADR 0005](adr/0005-nooki-is-the-agent-substrate.md) for why.

```text
Capability → Model Gateway → the chosen Agent Tool → one one-shot turn
Capability → Agent Host ───→ Codex Agent Runtime
```

#### Detection reads files; only work starts a process

`AgentTools` finds an agent by looking for its home directory and its binary, and reads its sign-in
state from that tool's own files — `~/.codex/auth.json` for Codex. Opening Settings starts no
processes. An agent that keeps its credentials where Nooki cannot look is reported as `unknown`
rather than guessed at, and is still offered, because refusing to try would be a guess dressed as a
fact.

Nooki never reads, copies, or stores a credential. The sign-in hint it shows is the command a person
would run in that tool.

#### One one-shot turn per invocation

Each agent is asked for a single answer with no session, no write access, and no Nooki-supplied
tools:

- Codex: `codex exec --ephemeral --json --sandbox read-only --skip-git-repo-check`
- Claude Code: `claude -p … --output-format json`
- pi: `pi --print --mode json …`

Each prints its own shape, and each is parsed on its own terms. Where a shape is not recognised the
raw output is preferred over an error, because a person would rather read an unexpected answer than
lose one. Timeouts, non-zero exits, and empty output map to one structured `InvocationError` that
knows how to say itself in either language.

The guards that remain Nooki's are Nooki's own: an empty request and an oversized one are refused
before any process starts.

#### What this costs

A machine with no agent installed has no AI inside Nooki. That is the honest consequence of not
shipping a model client, and Settings says so rather than offering a configuration that would not
work.

#### The minimum interface for the Model Gateway and Agent Host

```ts
type ModelRequest = {
  capabilityId: string;
  input: string;
};

type ModelResult = {
  provider: string;
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
