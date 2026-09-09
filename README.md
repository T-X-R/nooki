# Nooki

Nooki is a local-first desktop app for your notes, documents, and AI conversations. Keep your work in one place and add tools through installable capabilities.

## Features

- **Document Library** — import, search, organize, and edit documents, with version history and Markdown export.
- **Conversations** — work with your documents through Codex and save useful answers to the Library.
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

Open **Capability Center → Developer center** to install the development skill for Codex or Claude Code, or download the kit for another tool. Build a capability with the kit, then import its `.capability.zip` in Nooki.

Only install packages you trust: capabilities execute code inside the desktop host.

## Development

```sh
npm run build
npm run test:platform
npm run test:capabilities
cd src-tauri
cargo test -- --test-threads=1
```

See [Capability infrastructure](INFRASTRUCTURE.md) and [Domain concepts](CONTEXT.md) for technical details.

Write repository documentation and pull request titles and descriptions in English.
