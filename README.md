# Personal Workbench

Personal Workbench is a local-first desktop host for installable capabilities. Reports, tables, journals, and future agents enter through a stable platform contract instead of being built into the shell.

The initial release includes the React interface and a Tauri 2 desktop host. The host persists the selected AI Provider, manages Capability manifests and lifecycle state, enforces permissions, and keeps API credentials outside Capability code.

## Current platform foundation

- Fixed desktop shell with an independently scrolling content area.
- Simplified Chinese and English interfaces powered by `i18next` and `react-i18next`.
- Persistent theme, language, and globally selected AI Provider preferences.
- A stable `CapabilityHost.environment` interface that lets installed Capability pages follow platform language and Light/Dark changes without importing shell state.
- Capability registration, listing, enablement, disablement, and uninstallation.
- A platform-owned Document Gateway and Document Library that retain published Markdown by source, collection, and month after the source Capability is uninstalled.
- A discovered `capabilities/` catalog with installable Diary and Codex Daily Review packages; installed state is kept separately from package source.
- A host-owned `ai.invoke` interface guarded by installation, enablement, and `ai.invoke` permission checks.
- Direct Responses-compatible requests for managed API key Providers.
- Codex CLI execution for Codex subscription tasks.

The first production Capability lives at `capabilities/diary`. Its editor, storage, and activity-event logic are package-owned. The Workbench discovers package entry points without importing Diary business code into the shell. The desktop app also installs trusted local `.capability.zip` packages without rebuilding Workbench; browser preview and the desktop registry both keep install state independent from the catalog.

Codex Daily Review lives at `capabilities/codex-daily-review`. It owns session parsing, task extraction, prompt construction, and presentation. The platform only provides permission-checked access to raw files from today's Codex session partition and the shared AI Provider interface.

Capabilities that generate long-lived documents declare `documents.publish` and call `host.documents.publish()`. The Document Gateway assigns the source namespace, validates stable collection and document keys, and sends the Markdown to the platform-owned Document Library. Capabilities never provide arbitrary filesystem paths or depend on library UI and persistence code. Publishing the same key again updates the existing document; uninstalling a Capability retains its published documents.

Installation saves the package and its registry entry; uninstallation removes its executable package and registry entry. Capability data is namespaced by Capability ID and is retained on uninstall, so the platform and other installed Capabilities continue to work unchanged. The checked-in `installed-capabilities/` directory documents the separate installed-package boundary used by the desktop data directory.

## Tasks and independent packages

Workbench 0.2 provides platform-owned task execution with persisted checkpoints, cancellation, explicit retry and interrupted-task recovery. Codex Daily Review uses this shared runner. Capability updates, disablement and uninstallation stop its running work before changing lifecycle state.

Build reviewed local packages with `npm run capability:pack -- <directory>` and import them through Capability Center. Installation checks compatibility and requested permissions, validates the executable before activation, and retains the previous external version for rollback. These packages execute trusted code in the host realm; untrusted-code isolation is not part of package format v1.

See [INFRASTRUCTURE.md](INFRASTRUCTURE.md) for the contract, persistence and cancellation semantics, package format, and a standalone example.

## Run the development shell

```sh
npm install
npm run dev
```

The browser preview renders the complete shell but never reads credentials or invokes a model. Native Provider access is available only in the Tauri desktop app.

## Select an AI Provider

Open **Settings → AI Provider** and choose one of the available sources:

- **Managed API key** imports the selected model, Responses endpoint, and credential source from `~/.codex/api.config.toml`. The desktop host performs the request and shares this Provider with every authorized Capability.
- **Codex subscription** uses `~/.codex/config.toml` and the login session managed by the local Codex CLI.

Workbench persists only the Provider selection. An API key remains inside the desktop host and is never returned to the frontend, copied into the platform registry, or passed to a Capability. Workbench does not read Codex `auth.json`.

## Runtime logs

Development and release builds write operational logs to `~/Library/Logs/com.personal.workbench/Workbench.log`. Logs use local timestamps, rotate at 2 MB, and retain the three most recent files. They record lifecycle events, Capability IDs, Provider stages, HTTP metadata, byte counts, durations, and error categories. They never record credentials, Authorization headers, raw Codex sessions, complete prompts, or Provider response text.

## Invoke AI from a Capability

A Capability declares the `ai.invoke` permission in its manifest and calls only the Capability Host:

```ts
// Workbench supplies host through CapabilityPageProps or the job context.
const result = await host.ai.invoke('Summarize today\'s activity')
```

The request contains neither a `providerKind` nor an API key. The host verifies the Capability and resolves the globally selected Provider. Changing that selection automatically affects every installed Capability without additional user configuration.

## Build and install the desktop app

Install Rust from <https://rustup.rs>, then run:

```sh
npm run desktop:dev
npm run desktop:build
```

The release bundle is created at:

- `src-tauri/target/release/bundle/macos/Workbench.app`

Install it into `/Applications`:

```sh
npm run desktop:install
```

After later source changes, rebuild and replace the installed app with one command:

```sh
npm run desktop:update
```

Build a DMG separately when needed:

```sh
npm run desktop:build:dmg
```

## Verification

```sh
npm run build
npm run test:platform
npm run test:capabilities
cd src-tauri
cargo test --offline
cargo clippy --offline -- -D warnings
```

Provider contract tests use a local fake HTTP endpoint and never invoke a real model. All Rust tests live under `src-tauri/tests/` and use the `*_test.rs` naming convention.

See [CONTEXT.md](CONTEXT.md) for the project language and domain definitions.

## Review real activity and reuse selected documents

Workbench 0.3 connects Today to saved journal entries, generated documents and tasks that need attention. Activity links open the corresponding Library document or task details and remain available after restarting.

In **Library**, search by body text as well as title, source, collection and date. Select individual documents, optionally filter to the current Monday–Sunday week, and choose **Authorize a capability**. Review the exact document list and recipient before confirming. Authorization is limited to immutable snapshots of those documents for that Capability version.

Install **Weekly Review** from Capability Center (or build `capabilities/weekly-review` as a standalone package). Open an authorized selection, confirm the AI input scope, and manually generate a draft. Every section includes clickable source citations. Review the draft before confirming publication to Library; failed publication can be retried independently without another model invocation.
