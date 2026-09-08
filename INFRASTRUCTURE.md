# Capability infrastructure, version 0.2

Workbench owns task execution and installed package lifecycle. A Capability owns its UI, job definitions, business steps, input parsing and document publication decisions. Pages only submit work and subscribe to platform snapshots.

## Task execution

A module declares `job` in its manifest entrypoints and exports `jobs: Record<string, CapabilityJob>`. The page starts work with `host.tasks.start(job, input)`. The host scopes this interface to the Capability; the platform Tasks page can inspect, cancel and retry all tasks.

The runner stores task inputs, package version, attempt, status, completed step results and final result in `tasks.json` under the desktop application data directory. Browser preview uses local storage. Storage failure prevents a task from starting. Every completed step is persisted before the next step begins.

```ts
jobs: {
  report: {
    async run(input, { host, signal, step }) {
      const report = await step('generate', () => host.ai.invoke(String(input)))
      await step('publish', () => host.documents.publish({
        key: 'daily-report', title: 'Daily report',
        collectionKey: 'reports', collectionName: 'Reports',
        documentDate: '2026-09-08', content: report.output,
      }))
      return report
    },
  },
}
```

Use sequential steps with stable lowercase keys. Inputs, results and checkpoints must be JSON-serializable. Completed checkpoints are reused on retry, including after restarting Workbench. Step operations must be idempotent: a process can exit after an external effect but before its checkpoint is saved. Document publication already supports stable keys. This is not an exactly-once guarantee for arbitrary external effects.

A task has one of `running`, `completed`, `failed`, `cancelled`, or `interrupted` states. App startup converts persisted `running` records to `interrupted`; it never automatically reruns business code or invokes AI. Users explicitly retry interrupted tasks. Version changes require starting a new task; checkpoints cannot be interpreted by a different package version.

Only one execution of a given Capability/job can run at a time. Leaving its page does not cancel it. Cancellation aborts its signal, prevents subsequent Host writes and checkpoints, and cancels native AI requests. Codex CLI execution uses an asynchronous child with kill-on-drop and a ten-minute timeout. HTTP cancellation drops the local request; it cannot guarantee that a remote Provider stops processing or charging for a request already received. Job implementations should observe `signal` during their own asynchronous work. The host cannot forcibly preempt synchronous JavaScript running in the shared realm.

Disablement, uninstallation, updates and rollbacks pause new task starts and cancel current executions before changing package state. Task records and published documents are retained. Task history may contain input and generated document text and stays in the user's local application data directory; it is separate from operational logs.

Codex Daily Review uses the same runner through four steps: scan, summarize, save, publish. Retrying a failed publication does not scan sessions or invoke a model again. Its existing `latest-review` storage remains readable for migration from version 0.1.

## Independently installed packages

Version 1 of the package format supports **trusted, reviewed local code**, executing in the same JavaScript realm as Workbench. It is not an untrusted-code sandbox. The installer explains this and asks the user to approve the package and its full permissions, highlighting additions on update. Inspection reads data only; executable evaluation happens after confirmation. Capability code must perform work through CapabilityHost and avoid top-level effects, direct Tauri calls, shell state imports and global CSS selectors.

A `.capability.zip` contains only:

- `manifest.json`: Capability manifest, including SemVer version and minimum platform version.
- `entry.js`: a self-contained IIFE exporting the default CapabilityModule as `WorkbenchCapability`.
- `style.css`: optional package-owned styles, scoped to the Capability's own selectors.

React and its JSX runtime are supplied by Workbench as `WorkbenchReact` and `WorkbenchJSXRuntime`; the packaging command externalizes those imports to avoid duplicate React hook runtimes. Other dependencies and assets must be bundled. A Page is required for package format v1. Command and widget declarations remain reserved; the supported executable interfaces are Page and jobs.

Build a package using Node, the project's dependencies and Python 3 (standard library only):

```sh
npm run capability:pack -- capabilities/diary
npm run capability:pack -- capabilities/codex-daily-review
npm run capability:pack -- examples/checkpoint-demo /tmp/workbench-packages
```

Import the resulting ZIP through Capability Center in the desktop app. The example is outside the built-in catalog: it can be built after the desktop app and installed without rebuilding Workbench. It deliberately fails once after a ten-second checkpoint, allowing a retry to publish a document without repeating the completed wait. It never invokes AI.

The installer limits compressed size to 12 MB and each decoded file to 10 MB. It rejects extra files, path traversal, symlinks, malformed manifests, unsupported minimum platform versions and version conflicts. It parses entries in memory and does not extract arbitrary archive paths to disk.

Installation validates the module export before committing the active version. Native persistence saves an immutable package payload at `installed-capabilities/<id>/<version>.json` and then atomically updates the registry pointer. A failed package or registry write leaves the previous active version authoritative. A frontend load or render failure is visible; the user can return to Capability Center and roll back to the previous externally installed version. Rollback also preserves enablement and cancels running work. Package code must keep data changes backward compatible if it expects rollback to work; executable rollback does not reverse arbitrary business data migrations.

Uninstallation removes the package's registry entry and executable payloads while keeping namespaced Capability storage, task records and published documents. The built-in `capabilities/` catalog remains available as starter content; external installations override matching built-in IDs and are not silently replaced by bundled updates.

## Verification

```sh
npm run build
npm run test:platform
npm run test:capabilities
cd src-tauri
cargo test --offline
cargo clippy --offline -- -D warnings
```

Provider tests bind a local fake HTTP endpoint; no real model is invoked. Task tests cover checkpoint retry, late completion after cancellation, interrupted startup, duplicate starts, version fencing, lifecycle cancellation and storage failure. Installer tests cover malformed archives, compatibility, restart persistence, update rollback, registry-write failure and data preservation.

## Desktop acceptance (2026-09-08)

A debug bundle with a separate `com.personal.workbench.infrastructure-qa` identifier was built. The checkpoint demo was packaged afterward, imported through the native file picker, approved and opened without another Workbench build. The first run failed at the intended publication step with one saved checkpoint; retry completed with two checkpoints and its Markdown was verified in the Document Library. A second run was interrupted by quitting the app; after relaunch its persisted status was `interrupted` with attempt 1 and no automatic rerun. The installed package and the earlier completed task both survived relaunch. Provider calls were not used in this acceptance flow.
