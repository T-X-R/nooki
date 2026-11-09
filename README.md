# Nooki

Nooki is a local-first macOS workspace for documents and AI agents. Use Codex, Claude Code, or pi to work on documents in your Library, and manage the skills your agents share from one place.

## Build for macOS

Get the source from [GitHub Releases](https://github.com/T-X-R/nooki/releases) or clone this repository. If a release includes a DMG, you can install it by opening the DMG and dragging Nooki to Applications.

To build from source, install Node.js 22 or later, npm, Rust, and the Xcode Command Line Tools (`xcode-select --install`). Run these commands from the repository root. Quit Nooki before running the install command if it is already open.

```sh
npm ci
npm run desktop:build
npm run desktop:install
```

Open Nooki from Applications. The build also leaves a copy at `src-tauri/target/release/bundle/macos/Nooki.app`. Run `npm run desktop:build:dmg` to create a local DMG. See [macOS releases and updates](docs/macos-releases.md) for the signed distribution workflow.

## Features

- **Document Library** — import, search, organize, and edit documents, with version history and Markdown export.
- **Conversations** — discuss and revise Library documents or Markdown/text attachments with the selected agent, preview document changes, and save selected results to the Library.
- **Skill Pool** — manage shared skills in `~/.agents/skills` and distribute them to your coding tools.
- **Task board** — organize to-dos, goals, and follow-ups.
- **Capability Center** — extend the workspace by importing `.capability.zip` packages.

## AI setup

1. Install Codex, Claude Code, or pi and configure authentication in that tool.
2. Open **Settings → Agent access** to see which agents Nooki detects and choose which one handles capability requests through `ai.invoke`.
3. Start a Conversation and choose an agent. Each conversation stays with the agent that started it.

AI requests use the selected agent's credentials and quota. The Library and task board work without an agent.

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

After `npm ci`, run `npm run desktop:dev` to start the desktop app in development mode. Use `npm run dev` for a browser preview. Conversations with installed agents require the desktop app.

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
