# Capability Contract

This package is the stable type boundary between Capability Packages and the Workbench. A capability depends on the Manifest, Host, storage, and page-entry types defined here, without depending on shell pages or the Tauri implementation.

## Follow the platform language and theme

The platform publishes its current language and theme through `host.environment`. A Capability Package owns its translations and styles and subscribes to environment changes. It must not read the platform's Zustand store, i18next instance, or page DOM.

```tsx
import { useSyncExternalStore } from 'react'
import type { CapabilityPageProps } from '../../packages/capability-contract/src'

export function CapabilityPage({ host }: CapabilityPageProps) {
  const environment = useSyncExternalStore(
    host.environment.subscribe,
    host.environment.getSnapshot,
    host.environment.getSnapshot,
  )

  const copy = messages[environment.language]
  return (
    <main lang={environment.locale} data-theme={environment.theme}>
      <h1>{copy.title}</h1>
    </main>
  )
}
```

`getSnapshot()` returns:

- `language`: `zh` or `en`, used to select the package's own translated copy.
- `locale`: `zh-CN` or `en-US`, used to format dates, numbers, and other locale-sensitive values.
- `theme`: `light` or `dark`, used to select the package theme.

When the platform language or theme changes, `subscribe` immediately notifies every open capability. Capability Packages can use platform CSS tokens such as `--surface`, `--ink`, `--line`, and `--accent` directly instead of duplicating platform theme state.

```css
.capability-page { background: var(--surface); color: var(--ink); color-scheme: light; }
.capability-page[data-theme="dark"] { color-scheme: dark; }
```

A Capability Package should also provide a name and description under `locales.zh` and `locales.en` in `manifest.json`. The platform uses these values in the capability catalog, Today entry point, and top bar. If a localized field is missing, the platform falls back to the top-level Manifest `name` or `description`.

## Read today's Codex session source

A Capability that owns Codex session processing can request `codex.sessions.read` and read the current local date partition through the Capability Host:

```ts
const source = await host.codex.sessions.readTodayFiles()
```

The host resolves the system's current local date and returns raw JSONL text from only that date's active and archived session directories. It validates installation state, enablement, and permission, but does not interpret session events. Parsing and any derived behavior remain owned by the Capability Package.

## Publish a document

Capabilities that produce durable documents declare `documents.publish` and submit a Document Publication through the platform-owned Document Gateway:

```ts
await host.documents.publish({
  key: '2026-09-04',
  title: '2026-09-04 Daily review',
  collectionKey: 'daily-reviews',
  collectionName: 'Daily reviews',
  documentDate: '2026-09-04',
  content: '# Daily review',
})
```

`key` and `collectionKey` are lowercase stable identifiers, not paths. The Gateway handles permission checks, assigns the Capability namespace, validates the publication, and passes it to platform persistence and indexing. Reusing the same key for the same date updates the document in place. Disablement and uninstallation block new publications but do not delete published documents.

The Document Gateway is separate from `host.ai`. Workbench never assumes that every model response is a durable document; the Capability decides when a result is ready to publish without knowing how the platform stores or displays it.

## Run a task

Declare `job` in manifest entrypoints and export a `jobs` map of `CapabilityJob` definitions. Pages submit with `host.tasks.start(job, input)`, observe `getSnapshot` / `subscribe`, and can `cancel(id)` or `retry(id)` within their own Capability. The job context provides a cancellation signal, a scoped Host and `step(key, operation)` for persisted checkpoints. Do not keep a separate execution state machine in each page.

Use JSON-serializable data and idempotent sequential steps. Explicit retry reuses completed steps; startup marks unfinished runs interrupted without invoking business code. Package version changes invalidate checkpoint retry. See [INFRASTRUCTURE.md](../../INFRASTRUCTURE.md) for the complete behavior and a working standalone example.
