# ADR 0001: Tauri 2 as the desktop host

- Status: proposed
- Date: 2026-09-03

## Context

The workbench is a single-user, local-first personal app. It does not need public distribution, but
it does need durable local data, file access, system shortcuts, and optional native capabilities.
Business capabilities have to stay pluggable, so the platform and the business pages must not be
welded together.

## Decision

Host a React + Vite + TypeScript frontend inside Tauri 2. The platform exposes files, storage, and
system capabilities through controlled Tauri commands. A Capability Package depends only on
`CapabilityHost` and never reaches for a Tauri API directly.

## Rationale

- Keeps web frontend ergonomics while still shipping a desktop application.
- Smaller default bundle and runtime footprint than Electron; a local app does not need a full Node
  runtime.
- Native capabilities stay concentrated in platform adapters, which keeps the capability contract
  decoupled from the host implementation.
- If the host is ever replaced with Electron, the Capability Contract survives and the migration is
  confined to the host adapter.

## Consequences and mitigations

- A small amount of Rust has to be maintained. Confine it to platform adapters and cover the commands
  with integration tests.
- Loading external capability packages dynamically needs an asset protocol, version validation, and
  permission review. The first version only supports local import with explicit confirmation.
- Tauri's plugin ecosystem is narrower than Node's. If a capability ever requires a native Node SDK,
  evaluate an Electron adapter then rather than paying for that flexibility up front.

## Not decided here

- A remote capability marketplace, signing, and automatic updates.
- The specific model providers and the agent orchestration approach.
- Multiple workspaces, cloud sync, and cross-device accounts.
