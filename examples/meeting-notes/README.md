# Meeting notes capability

An independent reference package for Nooki 0.17.0 or later. It was scaffolded from the exported
workbench capability kit and built outside the Nooki checkout before being preserved here.
The package imports only its bundled public contract and UI. Nooki supplies React at runtime.

Select approved Library snapshots, enter a meeting title, and generate notes through a Host-reviewed
Codex Job. The package retains the draft and original run ID. Reopening observes existing work.
Saving is explicit: save the completed draft to Library, then open it, create a non-running todo,
attach the saved notes to a selected task, or hand a draft to chat for review. Chat handoff does not
send a message. Published notes and created tasks are Host-owned records.

## Build and preview

```sh
npm ci
npm run check
npm test
npm run pack
npm run dev
```

The installable archive is `dist/example.meeting-notes-1.2.0.capability.zip`.
Importing and installing the archive, approving permissions, and running Codex are separate user
operations. The Host needs its dedicated Codex component and a supported native login.

The ordinary preview does not provide real Agent or native grant services. `preview/acceptance.html`
is an explicitly labeled synthetic fixture. To exercise its core UI flow while Vite is running on
port 1431, set `PLAYWRIGHT_MODULE` to an installed Playwright module and run
`node scripts/tests/ui.mjs`. Test fixtures are excluded from the packaged entry graph.

## Requested permissions

| Permission | Purpose |
| --- | --- |
| `storage` | Retain frozen inputs, draft text, run IDs and operation receipts |
| `documents.read-selected` | Use source snapshots approved through the Host picker |
| `documents.publish` | Explicitly save finished notes to Library |
| `agents.run` | Ask the Host to review and execute Codex work |
| `board.create` | Explicitly create a todo without executing it |
| `board.attach-delivery` | Attach saved notes to a task selected in the Host picker |
| `conversations.handoff` | Prepare a reviewed chat draft without sending it |

## Verification and remaining scope

Type checking, archive validation/build, four focused behavior tests, and the synthetic browser
flow pass. These cover retained results, explicit publication, dismissal, cancellation, reopening
without duplicate Agent calls, and retrying an uncertain attachment with the original persisted
request. Host tests separately cover observing a claimed run from a later Job attempt without
reparenting it or adopting an unused approval.

Installed package behavior and authenticated Codex execution are not yet accepted. Broad theme,
language, viewport, upgrade/removal and fault matrices belong to consolidated toolbox acceptance.
Native questions appear in the Nooki Host notice; the package displays public progress and an
input-needed hint. Binary artifacts and explicit independent Host execution delegation
remain platform work; this package's chat draft handoff does not implement that delegation.

New drafts request validated summary, decisions, action items and open questions. The package renders
that data as readable notes before explicit saving. Existing drafts retain their text-only request
format and exact retry intent. Invalid-format results remain failed and cannot be published.
