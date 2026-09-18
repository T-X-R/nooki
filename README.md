# Nooki

Nooki is a local-first desktop app for your notes, documents, and AI conversations. Keep your work in one place and add tools through installable capabilities.

## Features

- **Document Library** — import, search, organize, and edit documents, with version history and Markdown export.
- **Conversations** — discuss and revise Library documents or Markdown/text attachments with Codex, preview document changes, and save selected results to the Library.
- **Skill pool** — keep every agent skill in `~/.agents/skills`, resolve duplicates by hand, and distribute them to the coding tools installed on your machine.
- **Capabilities** — add tools such as Diary and Codex Daily Review from the Capability Center.
- **Local workspace** — manage tasks, back up your data, and choose between English and Simplified Chinese or light and dark themes.

## Getting started

For local development, install Node.js, npm, Rust, and the native build tools required by Tauri.

```sh
npm install
npm run desktop:dev
```

To preview the interface in a browser:

```sh
npm run dev
```

Codex sessions and native AI Provider access require the desktop app.

## AI setup

Open **Settings → AI Provider** to configure AI access for capabilities:

- **Managed API key** reads the model, endpoint, and credential source from `~/.codex/api.config.toml`.
- **Codex subscription** uses the local Codex CLI configuration and login session.

Conversations use the local Codex CLI directly. Install Codex and sign in before using them.

## Build for macOS

```sh
npm run desktop:build
npm run desktop:install
```

This builds `src-tauri/target/release/bundle/macos/Nooki.app` and installs it in `/Applications`. Run `npm run desktop:build:dmg` to create a DMG.

## Capability development

Open **Capability Center → Developer center** to install the development skill into the skill pool, from where it reaches Codex, Claude Code, and any other tool you registered. You can also download the kit and place it yourself. Build a capability with the kit, then import its `.capability.zip` in Nooki.

Only install packages you trust: capabilities execute code inside the desktop host.

## Project layout

```
src/app/          entry point, the App shell, and global styles
src/features/     user-facing areas: activity, capabilities, conversation,
                  library, settings, skills, tasks
src/platform/     host infrastructure shared by features: capability runtime,
                  document library, task runner, activity store, AI provider,
                  user data
src/shared/       framework-level helpers with no domain knowledge
src-tauri/        the Rust desktop host
packages/         the capability contract and shared capability UI
capabilities/     first-party capabilities, each with colocated tests
skills/           the capability development skill published to the skill pool
tests/            platform tests; tests/ui holds the browser suites
```

Features may import from `platform`, from `shared`, and from each other;
`platform` and `shared` must not import from `features`. The one exception is
`platform/tasks.ts`, which reaches into `features/conversation/conversation-jobs.ts`
to register the built-in conversation job — see the note in that file.

Relative imports inside `src` carry an explicit `.ts`/`.tsx` extension, because
`node --test` resolves the same modules without a bundler.

## Development

```sh
npm run build
npm test
cd src-tauri
cargo test -- --test-threads=1
```

`npm test` runs the platform and capability suites. The browser suites need a
dev server on port 5193 and a Playwright install:

```sh
npm run dev -- --host 127.0.0.1 --port 5193
npm run test:ui
```

See [Capability infrastructure](INFRASTRUCTURE.md) and [Domain concepts](CONTEXT.md) for technical
details.

`docs/` holds the design record: the [architecture](docs/architecture.md) the first version was
built from, the [decision records](docs/adr/), and the feature specs. Start with
[what Nooki is](docs/adr/0005-nooki-is-the-agent-substrate.md), then the
[Skill Pool spec](docs/spec-skill-pool.md) and the [Settings spec](docs/spec-settings.md).
Notes that are not meant for the repository live in `docs/local/`, which stays untracked.

Write repository documentation and pull request titles and descriptions in English.
