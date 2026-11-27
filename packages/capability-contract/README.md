# Capability Contract

This package is the stable type boundary between Capability Packages and the Nooki. A capability depends on the Manifest, Host, storage, and page-entry types defined here, without depending on shell pages or the Tauri implementation.

## Shipped contract and portable verification

The exported kit targets Nooki 0.15.0's Host contract and legacy archive format. There is no
separate negotiated Host API version yet; record the kit version from `workbench.json` alongside the
tested Nooki version. The toolbox design describes future services, not methods available in this kit.
The canonical types include the current document references, selected snapshots, publications and
conversation attachment inputs and reviewed chat handoff. Reviewed observable Agent runs are available through the bindings below. `ai.invoke` is the existing model gateway, not an agent-run handle.

`agents.run` is a separate execution permission, declared since 0.12.0. The public Agent
bindings below require Nooki 0.13.0+ (cancellation state requires 0.14.0+). Prepared Nooki 0.15.0
Apple Silicon builds include the dedicated Codex component and reuse Codex file login. Check
`listAvailable()` at runtime: missing components/login or unsupported native configuration return
an empty list, and new execution fails with `UNSUPPORTED_SERVICE`. Authenticated/installed acceptance
and the complete meeting workflow remain in development. There is no ordinary chat, `ai.invoke`, or
synthetic-success fallback.

| Surface | Desktop Nooki | Portable `preview/host.ts` |
|---|---|---|
| Environment snapshot/subscription | Host language/theme | Controlled in-memory simulation |
| `storage` | Package-private persistent JSON, permission checked | Empty per instance; JSON copies and permission checks; resets on reload |
| Jobs, document grants/publication/open, activity writes, AI and Codex sources | Existing scoped Host operations | Explicit unavailable error; no empty-success responses |
| `library.requestSelection` | Host-owned document picker; explicit selection or dismissal | `UNSUPPORTED_SERVICE`; no simulated grants |
| `board.create` | Permission-checked durable draft creation with an idempotency key | `UNSUPPORTED_SERVICE`; no simulated success |
| `board.attachDelivery` | Retain authorized documents on an exact selected task revision, with idempotent replay | `UNSUPPORTED_SERVICE`; no simulated write |
| `board.requestSelection` | Host-owned approval of exact task revisions for attachment | `UNSUPPORTED_SERVICE`; no simulated approval |
| `conversations.handoff` | Host-reviewed retained draft, explicit adoption/send in native chat | `UNSUPPORTED_SERVICE`; no simulated approval |
| `agents` | Reviewed execution bindings and scoped retained snapshots; availability requires an enabled native component | Empty available list; all execution/observation methods return `UNSUPPORTED_SERVICE` |
| Board update/delegation, other chat operations, scheduling, binary artifacts, services | Not exported yet | Not exported |

### Reviewed Agent runs (bindings in Nooki 0.13.0+)

Declare `agents.run`, require `minPlatformVersion: "0.13.0"`, and check
`await host.agents.listAvailable()` before offering execution. Only Codex is in scope. Save the exact
intent and idempotency key in package storage **before** starting, then save the returned run ID:

```ts
const started = await host.agents.start(
  { agentId: 'codex', instructions: 'Summarize this meeting.', sources: selectedReferences },
  { idempotencyKey: savedIntentKey },
)
if (started.status === 'started') {
  await host.storage.set('meeting-run-id', started.run.id)
  const unsubscribe = host.agents.subscribe(started.run.id, run => {
    // Render run.status; completed results contain run.result.text.
    // Save to the Library through documents.publish only on the user's save action.
  }, error => {
    // Keep the same run reference when observation is unavailable.
    console.error(error.code)
  })
  // Call unsubscribe when leaving the view; this does not cancel native work.
}
```

Nooki displays the instructions, selected source versions and optional `outputSchema` in a Host-owned
review. Packages cannot supply approvals, policies, credentials, source bodies or native session IDs.
Sources must be unchanged active Library selection references (up to 50); declare
`documents.read-selected` when requesting them. Instructions allow up to 20,000 characters, the
optional schema is an object of at most 16,384 UTF-8 bytes, and the entire serialized request must fit
63 KiB. Returned text is bounded to 1 MB. The current result is text; schema-aware result validation,
artifacts and Host questions are still pending implementation.

`start` returns `{ status: 'dismissed' }` when the review is closed, or
`{ status: 'started', run }` for the retained run. Closing after an uncertain confirmation does not
prove that nothing started: retain the same key/input and reconcile it unchanged. A repeated start
returns the same run; pending work is observed, never resubmitted. `get(id)` and
`subscribe(id, listener, onError)` return fresh scoped snapshots with `id`, `agentId`, `status`,
`restored`, and `result`. Status is `approved`, `running`, `unknown`, `completed`, `failed`, or
`cancelled`; only `completed` has `{ text }`. Private correlation and native identifiers are omitted.
Subscriptions are serial, poll at one second after each read, stop on terminal/restored state or
revoked authority, and release callbacks on disposal. They never start work.

`cancel(id)` requests interruption and returns the observed snapshot. `running` or `unknown` is not
proof of cancellation. Imported history is marked `restored` and cannot control execution. Terminal
results can be read without a currently available component. This release's default unavailable
component also prevents exposure before remaining native submission/lifecycle integration is done.
Preview advertises no available Agent and rejects start/get/subscribe/cancel explicitly.

### Reviewed conversation handoff (Nooki 0.11.0+)

Declare `conversations.handoff` and `minPlatformVersion: "0.11.0"` or newer. The receipt-persistence
example also needs `storage`. Call:

```ts
const result = await host.conversations.handoff(
  { title: 'Review notes', text: 'Please review the selected notes.', sources: selectedReferences },
  { idempotencyKey: savedIntentKey },
)
if (result.status === 'handedOff') {
  // Persist the receipt as metadata; it is not a conversation read or send grant.
  await host.storage.set('handoff-receipt', result.receipt)
}
```

`sources` defaults to an empty list. Each supplied reference must be unchanged from an active
Library selection (`kind`, `documentId`, `title`, `grantId`, `revision`); declare
`documents.read-selected` to obtain that selection. Arbitrary IDs, source bodies and package-chosen
conversation targets are rejected. Nooki shows the package, full draft and selected source versions;
the user chooses a new or existing ordinary conversation. Task execution conversations are excluded.

A successful result is `{ status: 'handedOff', receipt: { draftId, target } }`; cancellation returns
`{ status: 'dismissed' }`. The receipt's target is `{ kind: 'new' }` or
`{ kind: 'conversation', id }`. Nooki retains the draft and exact source text as user-owned work.
Opening previews it separately from the composer. Adopting appends text and retained sources;
only the user's explicit send starts a turn. Existing unsent text remains intact. The chat's
**Capability drafts** entry lists saved offers after restart or producer removal. If an existing
target disappears, opening fails visibly without substituting a new conversation.

Persist one exact input/key per intent. Unknown outcomes must be retried unchanged. The first
commit attempt freezes the user-selected target; changing it requires cancelling and reviewing
again. A committed replay returns the original receipt without recapturing revoked sources or
navigating again. Dismissal/disposal does not undo an offer already saved before a lost reply.
A receipt cannot open/read history, send a turn, or authorize a different capability.

Limits: title 120 characters, text 20,000 characters, at most 50 selected references and a 63 KiB
client envelope. Native retained storage is bounded to 256 offers/8 MB content/12 MB encoded data;
capacity failures retain existing offers. Preview rejects this operation with `UNSUPPORTED_SERVICE`.

Legacy packages require a Page; jobs and job-backed commands are optional. `widget` has never had a
supported package loader and is no longer advertised by the public type. The legacy `activity.read`
permission remains recognized for compatibility, but it exposes no public read method. This kit
does not add page-free packages or the future archive/API/data-version negotiation.

Use the same deterministic preview Host for local tests, without importing Nooki's source:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPreviewHost } from './host.ts'

test('save a note', async () => {
  const { host } = createPreviewHost({
    id: 'org.example.notes', name: 'Notes', version: '1.0.0',
    minPlatformVersion: '0.3.2', entrypoints: ['page'], permissions: ['storage'],
  })
  await host.storage.set('note', 'Synthetic text')
  assert.equal(await host.storage.get('note'), 'Synthetic text')
  await assert.rejects(host.documents.listGrants(), /requires desktop Nooki/)
})
```

Save this as `preview/storage.test.mjs` and run `node --test preview/storage.test.mjs` with Node
22.22.3 (the verified runtime). Keeping this JavaScript test under `preview/` avoids adding Node
types or Node imports to the browser package's typecheck and import-boundary checks.
Every Host instance begins empty; the preview reads neither browser storage nor native credentials.
Use `setEnvironment` returned alongside `host` to exercise language/theme changes. This harness tests
package UI and storage logic only. It does not simulate grants, Jobs, agents, durability, cancellation
or native isolation. Test those using the actual archive in an isolated desktop profile.

From the scaffolded project, run `npm install`, `npm run check`, and `npm run pack`. Packaging also
requires Python 3 for ZIP creation. The resulting archive contains the manifest, bundled entry and
scoped styles; preview tools stay in the source project. Preview data no longer persists in browser
storage: copy any useful test text before upgrading an older starter. Desktop package data is unaffected.

## Create a task-board draft

Declare `board.create` in `permissions` and require `minPlatformVersion: "0.4.0"` or newer.
Installation shows this permission and requires the user's consent. Call only the public Host:

```ts
const item = await host.board.create(
  { title: 'Review meeting actions', description: 'Check the next steps with the team.' },
  { idempotencyKey: 'meeting-2026-11-20-review' },
)
// item: { id: string, revision: number }
```

Choose a stable key for one user intent and retain the key/input before submitting. Reuse them after
an uncertain reply or an explicit retry; generating a new key may create a second item. A successful
request creates a `todo` card with native package/version provenance and a native-assigned revision. It does not start
an agent, delegate a Goal or accept a delivery. The user controls those later actions in Nooki.

Same package/operation/key and normalized input return the original reference, including after
restart with fresh authorization or after the user deletes the card. Reusing a key with different
input returns `CONFLICT`. Omitted description and sources normalize to `""` and `[]`; text whitespace
is preserved. The receipt's original revision does not change when the user later edits the card.
Receipts have no automatic expiry; at capacity, new intents fail while existing receipts remain
replayable. User-requested restoration of an older backup rolls back board state and receipts.

Starting with Nooki 0.7.0, every task has an opaque positive safe-integer revision, including ordinary
user drafts and native Goals. Compare revisions for equality; do not assume a new task starts at 1
or that successive edits increment its revision by exactly one. Changed and new tasks draw from one
persisted board sequence; unchanged tasks retain their revisions, and deleting/recreating an ID does
not reuse its previous revision. Renderer-supplied revisions are not authoritative. Legacy boards
receive deterministic revisions on read without a disk rewrite, persisted on their next save.
Backup restore is an explicit rollback boundary; it invalidates capability authority and may restore
an older sequence. Restore-induced Goal changes receive new revisions within the restored board.
An idempotent create replay still returns its original reference, not the task's current revision.

| Input or retention boundary | Limit |
|---|---|
| Title | Nonblank, at most 120 Unicode scalar values |
| Description | At most 20,000 Unicode scalar values |
| Key | Nonempty, at most 128 UTF-8 bytes, no control characters |
| Public input/key envelope | At most 63 KiB serialized UTF-8; native envelope at most 64 KiB |
| Sources | Up to 50 unique selected-document references; at most 8,000,000 UTF-8 bytes of combined snapshot bodies |
| Receipts | At most 256 per package, 1,024 per profile and 1 MiB serialized ledger |

Requests reject unknown fields, including owner, capability ID, authorization and execution state.
`IdempotencyOptions`, `BoardCreateInput`, `BoardItemReference`, `HostErrorCode` and `HostServiceError`
are exported canonical types. Board failures are `Error` objects with a stable `.code`:

| Code | Package behavior |
|---|---|
| `INVALID_INPUT` | Correct the input before resubmission |
| `PERMISSION_DENIED` | Stop; installation, permission or invocation is no longer authorized |
| `UNSUPPORTED_SERVICE` | Explain the unavailable operation; preview cannot create real items |
| `CONFLICT` | Refresh/reconcile state; do not silently change the key to bypass a conflicting intent |
| `RESOURCE_LIMIT` | Explain the capacity limit; existing receipts remain available |
| `RESOURCE_BUSY` / `RESOURCE_UNAVAILABLE` | Allow an explicit retry using the same key and input |
| `OUTCOME_UNKNOWN` | The item may exist; retry only with the same key and input |
| `CANCELLED` | This Host's page/job lifetime has ended; stop using it |

The host acquires one native invocation lazily per page/job, shares it across concurrent creates,
and releases it when the page unmounts or the job ends/cancels. Late grant completion after disposal
is released without submitting a create. Cancellation cannot undo a mutation already admitted at
the native commit boundary; reconcile that outcome with the same key. A package must not cache a
Host across page lifetimes or inspect native handles. Declaring permission does not expose board
listing or grant execution authority. Preview always refuses `board.create` and touches no board.

The legacy controller runs in the trusted main WebView. Native effects recheck caller label,
installation generation and permission, but legacy packages share the main JavaScript realm and
can bypass its module boundaries if malicious. This API is not hostile-package isolation; isolated
runtime enforcement remains separate work. Do not import Tauri or host controller modules.

### Select existing tasks (Nooki 0.8.0)

Declare `board.attach-delivery` and `minPlatformVersion: "0.8.0"` or newer. The Host presents a
picker naming the package, purpose and attach-only operation; only the user chooses tasks.

```ts
const selection = await host.board.requestSelection({
  purpose: 'Attach the reviewed meeting notes',
  operations: ['attachDelivery'],
  limit: 1,
})
if (selection.status === 'selected') {
  const { id: grantId, items } = selection.grant
  // Preserve these exact references. They contain id, revision and title, not task bodies.
}
```

`purpose` is required (1–1,000 Unicode characters after rejecting blank text); `limit` defaults to
one and may be 1–50. Only `['attachDelivery']` is supported. Other operations fail explicitly.
Dismissal returns `{status: 'dismissed'}` and no grant. The metadata result identifies this package
and version, purpose, operation, approval time and exact selected item revisions. It provides no
full-board read, task content, delegation or acceptance authority. Do not infer edit counts from a
revision. A changed task requires a fresh selection, even when its title later becomes identical.

Confirmation retries retain the same approved task versions. A lost issuance reply is cleaned up by
host-owned request correlation; package disposal/lifecycle changes close the picker and prevent late
results. The user can inspect and revoke task grants from **Task board → Task access**. Stale,
inactive and revoked grants remain visible; revoking does not delete tasks or retained deliveries.
Restore invalidates earlier task approval even when an archive contains its ledger. Browser preview
always rejects this native service with `UNSUPPORTED_SERVICE`.

## Attach retained document text (Nooki 0.9.0)

Declare `board.attach-delivery` and require `minPlatformVersion: "0.9.0"` or newer when using
`board.attachDelivery`. A selection alone is not an attachment, execution or acceptance. To attach
text from your own published documents also declare `documents.publish`; for selected documents
from any producer declare `documents.read-selected` and preserve their exact active grant references.

```ts
const chosen = await host.board.requestSelection({
  purpose: 'Attach reviewed meeting notes', operations: ['attachDelivery'], limit: 1,
})
if (chosen.status === 'selected') {
  const { id, revision } = chosen.grant.items[0] // Only id/revision belong in the item input.
  const intent = {
    input: {
      grantId: chosen.grant.id, item: { id, revision }, title: 'Reviewed meeting notes',
      documents: [publicationReference(manifest.id, publishedNotes)],
    },
    options: { idempotencyKey: crypto.randomUUID() },
  }
  // Persist the whole intent using declared storage before dispatch when restart recovery is needed.
  const result = await host.board.attachDelivery(intent.input, intent.options)
  // result.item is the committed task version; result.deliveryId identifies the retained delivery.
}
```

The request title is 1–120 Unicode characters after rejecting blank text. Supply 1–50 distinct
`library-document` references (`kind`, `documentId`, `title`, optional `grantId`/`revision`). Task or
conversation snapshot IDs, quote locators, execution/acceptance fields and other request properties
are rejected. A selected reference needs both `grantId` and `revision`; it retains the approved
snapshot. A plain reference must belong to this package and retains the current document at commit.
An optional plain revision is its canonical publication hash, not `updatedAt`. Text retention does
not copy remote images or other passive dependencies; artifact publication is a later service.

The native transaction checks the exact approved task version and live installation/permissions,
then atomically saves retained text, the new task revision and a durable receipt. Existing Agent
delivery and task status remain unchanged. Missing/revoked grants or a changed task reject a new
effect; request a new selection for a new intent. Exact committed replay returns the original
`{item, deliveryId}` without rereading originals or adding another delivery. Revocation can block
new effects while retaining committed metadata. A changed input under the same key conflicts;
an inactive/removed package cannot invoke even a replay.

On `OUTCOME_UNKNOWN` or transport uncertainty, retry the same key **and complete original input**.
Do not replace its selected revision with `result.item.revision`, obtain a fresh grant or generate a
new key for an uncertain old intent. Those actions create different requests. Receipts are retained
at bounded capacity; `RESOURCE_LIMIT` does not discard earlier outcomes. Existing bounds are 64
deliveries per task, 256 across the board, 8 MB serialized retained delivery data, and 256 receipts
per package/1,024 globally. Older completed attachments remain user-owned after source deletion,
revocation or package removal. Explicit task deletion or restoring an older backup may remove them.

Task details show **Attached deliveries** with producer/version/time and expandable retained text.
Viewing a delivery is read-only. External Markdown links and images are shown as text, without
loading live resources. The existing board refresh observes native writes; an attachment response
is not a renderer-side optimistic write. Full independent ZIP/native UI acceptance remains C04c3.

## Create a draft from selected documents

For nonempty sources, require `minPlatformVersion: "0.6.0"` and declare both `board.create` and
`documents.read-selected`. Pass the references returned by the Host picker unchanged; the Host
captures source content and validates authority without requiring the package to read document bodies.

```ts
const selection = await host.library.requestSelection({
  purpose: 'Create a review task using the selected meeting notes.', kinds: ['document'], limit: 5,
})
if (selection.status === 'selected') {
  const intent = {
    input: { title: 'Review meeting notes', sources: selection.grant.documents.map(doc => doc.reference) },
    options: { idempotencyKey: crypto.randomUUID() },
  }
  // This package also declares storage. Persist before the first attempt, then reuse on retry.
  await host.storage.set('pending-review', intent)
  const item = await host.board.create(intent.input, intent.options)
}
```

Each creation source must have exactly `kind`, `documentId`, `title`, `grantId` and `revision`.
Task/conversation `snapshotId`, `locator`, duplicate document IDs and arbitrary current-document
references are not accepted here. Metadata must match the canonical selection, and the grant must
belong to this package's currently authorized installation/version. Missing, foreign, revoked or
stale grants cannot create a new task; aggregate content bounds still apply across multiple grants.

Exact committed retries return only the original item reference and do not reread or reauthorize
the sources. The package must still have current `board.create` authority. Thus a committed retry
can succeed after source revocation, while a new key with that source is denied. Changed source
identity under the same key conflicts; do not replace a saved selection silently to make a retry pass.
Existing user-owned task citations remain readable after source edits, revocation or package removal.
Creation remains todo-only; later delegation is an explicit user action in Nooki. Portable preview
continues to reject creation with `UNSUPPORTED_SERVICE`, including sourced creation.

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

For responsive pages, the Host also exposes `--workbench-page-width`, `--workbench-page-gutter`, `--workbench-page-top`, `--workbench-page-bottom`, and `--workbench-reading-width`. Use these CSS tokens with local fallback values to keep package layouts aligned with platform pages. The page entry fills the available content height; editor and reader pages can use a flex column with `height: 100%`, a remaining-space panel, and independently scrollable content. Retain a usable minimum height and a narrow-window fallback. Resizing must not remount the page or reset in-progress edits or tasks.

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

The Document Gateway is separate from `host.ai`. Nooki never assumes that every model response is a durable document; the Capability decides when a result is ready to publish without knowing how the platform stores or displays it.

## Run a task

Declare `job` in manifest entrypoints and export a `jobs` map of `CapabilityJob` definitions. Pages submit with `host.tasks.start(job, input)`, observe `getSnapshot` / `subscribe`, and can `cancel(id)` or `retry(id)` within their own Capability. The job context provides a cancellation signal, a scoped Host and `step(key, operation)` for persisted checkpoints. Do not keep a separate execution state machine in each page.

Use JSON-serializable data and idempotent sequential steps. Explicit retry reuses completed steps; startup marks unfinished runs interrupted without invoking business code. Package version changes invalidate checkpoint retry. See [INFRASTRUCTURE.md](../../INFRASTRUCTURE.md) for the complete behavior and a working standalone example.

## Expose a conversation command

Jobs are private execution units. To let conversations discover and invoke one safely, also declare `command` in `manifest.entrypoints` and export a `commands` map. Each command names its backing job and supplies user-facing copy, JSON Schema input/output contracts, an effect classification, and a confirmation policy.

```ts
export default {
  manifest,
  Page,
  jobs: { summarize },
  commands: {
    summarize: {
      job: 'summarize',
      title: 'Summarize notes',
      description: 'Create a draft summary from the supplied notes.',
      inputSchema: {
        type: 'object',
        properties: { notes: { type: 'string', minLength: 1 } },
        required: ['notes'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      effect: 'draft',
      confirmation: 'never',
    },
  },
} satisfies CapabilityModule
```

Use `read` for inspection, `draft` for reversible generated output, `write` for local durable changes, and `external` when data leaves Nooki or an external system changes. `always` asks in the Nooki UI before execution; `when-needed` asks whenever the effect requires it; `never` is only for safe read/draft operations. Nooki always confirms `write` and `external` effects even if a package declares a weaker policy. Nooki validates schemas, enabled state, confirmation, task lifecycle, and results centrally. Agent-specific APIs must not be imported by a Capability.

Packages without `commands` remain compatible but are not callable from conversations. Nooki never exposes every job automatically: adding a command is an explicit public API and safety decision by the package author.

### Accept this turn's attached documents

To support “attach documents and ask in one sentence”, request `documents.read-selected` and set `acceptsConversationSources: true` on the specific command. Keep `conversationSources` **out** of the command's JSON input schema: it is reserved for Nooki, not supplied by the agent. Nooki resolves the current running turn's captured Library snapshots and UTF-8 uploads, shows their titles for confirmation, and injects `input.conversationSources` into the backing job after confirmation. If there is no live matching turn, invocation fails closed. No separate Library grant is needed for these *conversation* attachments; page-based access still uses grants.

```ts
commands: {
  summarize: {
    job: 'summarize', title: 'Summarize attachments', description: 'Draft from this turn’s attachments.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    effect: 'draft', confirmation: 'when-needed', acceptsConversationSources: true,
  },
}
// In the job: input.conversationSources is an array of
// { kind: 'library' | 'upload', title, content, documentDate?, reference? }.
```

Only commands that opt in receive content. This handoff uses the same broker for Codex, Claude Code, pi, and future adapters. A Library source carries its immutable `DocumentReference` for citations; an upload has no Library reference, so label it by filename instead of inventing a link. Keep contents out of summaries/results unless the result genuinely requires them. The broker confirms source sharing even for a `read` or `draft` command.

## Record a business activity

`host.activity.write({ type, title, key?, target? })` requires `activity.write`. Nooki assigns the source, timestamp and, inside a job, task ID. A stable `key` updates one fact within that Capability rather than appending duplicate rows. `target` is a `DocumentReference`; omit it for job activities that should open their task details. Legacy events remain readable and fall back to their source Capability when no exact target was recorded.

A publication may opt into a document activity with `activity: { type, title, key? }`. This uses the existing `documents.publish` authorization, always targets the successfully published document, and never grants arbitrary activity writes. Publication and activity persistence are separate effects; a failed activity write rejects the publication call, so an idempotent retry repairs it without duplicating the document.

## Request document selection

Declare `documents.read-selected` and require `minPlatformVersion: "0.5.0"` or newer:

```ts
const selection = await host.library.requestSelection({
  purpose: 'Use the selected notes to draft meeting actions.',
  kinds: ['document'],
  mediaTypes: ['text/markdown'], // Optional; unsupported filters are refused.
  limit: 3,
})
if (selection.status === 'selected') {
  const { grant } = selection // Metadata only; no document body in the picker result.
  const source = await host.documents.readSelected(grant.id, grant.documents[0].reference.documentId)
  // Use source.content and retain source.reference for citations.
}
// { status: 'dismissed' } creates no grant and shares no document content.
```

The host displays the installed recipient, version, package-provided purpose, saved document titles
and explicit authorization controls. The package cannot choose the recipient, inspect the list,
read previews or approve on the user's behalf. Selection captures the saved version at confirmation;
unsaved editor drafts are not included. Existing snapshots remain immutable when live documents change.

`LibrarySelectionRequest` and `LibrarySelectionResult` are canonical exported types. Purpose must
contain 1–1,000 Unicode scalar values and cannot be blank; limit is 1–50, default 1. Kinds must be a
nonempty array. This version implements only `document` and `text/markdown`; artifact requests or
other media types return `UNSUPPORTED_SERVICE` rather than silently ignoring filters. Unknown fields
return `INVALID_INPUT`. The existing 50-document / 8 MB grant bounds still apply.

One picker can be open at a time; a competing request returns `RESOURCE_BUSY`. Pages and jobs may
request selection; ending the caller lifetime closes its pending picker and prevents late result
delivery. Disabling, reinstalling or changing the recipient while selection is pending cannot grant
the replacement installation access. Native approval sessions expire after 15 minutes; reopen the
picker to make a fresh selection. Abandoned sessions are reclaimed on the next native selection call.

Confirmation retries retain the first approved IDs and the same private session. The host UI offers
explicit retry after an uncertain native outcome; it never silently captures a different selection.
Cancellation cannot undo a grant already accepted at the native capture boundary. Such a grant stays
visible in Document access, even if the caller closed before receiving the result. The user can revoke
future reads there; already delivered content cannot be recalled. Revocation preserves source citations.

Picker failures use the stable `HostServiceError.code` values listed for board operations. The portable
preview always returns `UNSUPPORTED_SERVICE`; a successful stub is not evidence of native sharing.
Legacy packages remain trusted code in the main JavaScript realm; this is a scoped Host workflow,
not hostile-package isolation. Never import Tauri or private selection controllers.

## Read an explicitly selected document

Declare `documents.read-selected` with `minPlatformVersion: "0.3.0"`. The **Nooki Library UI** creates the authorization after the user reviews the selected titles and recipient. CapabilityHost has no direct grant-creation, full-library listing, search, or private cross-Capability storage interface. Nooki 0.5.0 adds the host-owned picker below.

```ts
const grants = await host.documents.listGrants()
const grant = grants.at(-1)
if (grant) {
  const selected = await host.documents.readSelected(
    grant.id,
    grant.documents[0].reference.documentId,
  )
  // selected.content is the authorized snapshot, never an arbitrary live file.
}
```

Grants bind an immutable selection to a Capability ID and version. Nooki's native and browser-development Hosts reject documents outside that grant; the portable kit's preview Host does not implement grants and rejects these calls. Native checks also reject missing permissions, disabled or uninstalled recipients, and version mismatches. A grant contains up to 50 documents and 8 MB of UTF-8 content. The Capability still decides when to call AI and must explain the input scope before generation.

Nooki 0.4.0's native Host additionally binds a grant to the current installation generation. Restart
preserves a valid grant; disabling/re-enabling, updating or reinstalling the recipient requires a new
user selection, even when its version string is unchanged. Older native grants without this binding
remain user-readable citation snapshots but cannot authorize package reads. Native revocation blocks
future reads without deleting the snapshot or erasing content already delivered to the package.
Restoring older user data cannot undo local revocation or reuse a removed snapshot ID for different
content; select again with a new grant ID. A busy or interrupted data restore refuses grant operations
until the data transaction finishes or recovery completes. This native behavior does not make the
shared-realm browser development Host an isolation boundary. In Nooki 0.5.0, users inspect and revoke
access through **Library → Document access**, including grants whose recipient is disabled or removed.

`DocumentReference` carries `kind: "library-document"`, `documentId`, `title`, and optional `grantId`, `snapshotId` and `revision`. A grant ID identifies the retained snapshot. `locator.quote` is reserved for future finer evidence addressing; this release opens the whole source document. `snapshotId` addresses platform-owned conversation evidence independently of capability grants. Use `referenceHref()` and `parseReferenceHref()` from `src/references.ts` for Markdown citations, and `host.documents.open(reference)` to ask Nooki to display a source. Snapshot citations remain readable by the user after the producing or consuming Capability is uninstalled. Do not construct filesystem paths or read another Capability's storage.

Platform Conversations use Codex session APIs directly. Their Library access and task ownership do not add full-library or Codex-session access to CapabilityHost. Existing packages continue to use scoped grants and the platform Model Gateway.

Since Nooki 0.14.0, Agent snapshots include `cancellationRequested`. This records local cancellation
separately from `status`, which continues to describe the observed native outcome. A cancellation
request with a running/unknown status still needs reconciliation; do not publish its result as a
successful Job. A Job-created Host automatically binds Agent starts to that Job's exact attempt;
packages never supply a parent/owner field. Cancelling the Job persistently cancels its children and
blocks retry while any prior child has an uncertain outcome. Page disposal only stops subscriptions.
The native owner observes active sessions without requiring a page subscription and requests
interruption when installation/source authority or parent lifetime ends. Prepared Nooki 0.15.0 macOS builds include startup reconciliation and component activation.
Authentication and installed end-to-end acceptance remain pending.
