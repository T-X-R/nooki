# C05b2b: Public handoff review and retained draft adoption

- Date: 2026-11-26; based on `50ff44f`, existing feature branch and PR #38.
- Public contract/app/platform **0.11.0**, exported kit **0.10.0**.
- This completes C05b2b and its C05b2/C05b parents. C05c independent installed ZIP acceptance
  remains open; C05 is not complete.

## Delivered behavior

`host.conversations.handoff(input, { idempotencyKey })` accepts a title, text and optional unchanged
selected-document references. It snapshots the proposal before awaiting native review, rejects
caller-supplied targets and source bodies, and returns dismissal or a retained-draft receipt.
The public permission now requires platform 0.11.0; preview refuses with `UNSUPPORTED_SERVICE`.
The contract, exported checker, Skill and native version floor agree.

The Host reviews package identity, full offered text, source titles/revisions and destination.
Choosing a new chat does not discover conversations or connect to an Agent. Existing ordinary chat
metadata is paginated through the existing native owner. The first commit attempt freezes the
selected destination; uncertain retries cannot change it. Exact committed replay returns metadata
without reopening the offer. Disposal/disable closes approval and suppresses late navigation.

Approved offers open separately from the composer and remain available from Capability drafts.
Explicit adoption appends text and retains the source association, preserving existing unsent text
and attachments. Explicit send uses the retained native snapshot path already delivered in the
[retained-input receipt](C05b2b-sources.md). Missing/archived/task targets fail visibly rather than
being silently redirected. Native offers survive package removal; existing ordinary composer edits
remain memory-owned as before, so app-restart persistence of manual unsent edits is not claimed.

## Automated and real-component checks

- `npm test`: **203 platform + 5 capability tests pass**. Seven new client cases cover immutable
  input, dismissal, replay, frozen uncertain retry, invalid input/permissions/preview, malformed
  native receipt uncertainty and disposal during begin/commit. Red evidence for the missing client
  and malformed receipt preceded the implementation/fix.
- `cargo test --offline --manifest-path src-tauri/Cargo.toml`: **275 top-level tests plus one nested
  profile child pass**, zero failures; two existing live-agent tests ignored. This slice only changes
  native minimum-version checks/fixtures. The first full run failed an existing task-attachment
  conflict assertion; its exact focused rerun and a subsequent default full run passed. The cause
  of that intermittent failure is not established; no test or production behavior was weakened.
- `tests/ui/conversation-handoff.mjs`: actual client/review/inbox/composer components pass in isolated
  headless Chrome, using synthetic native IPC. Checks include Escape/focus restoration, lost-reply
  retry, existing-target pagination, replay without navigation, missing-target errors, separate
  adoption, preserved unsent text across component navigation, explicit-send-only behavior, retained
  source dispatch, disabled producer/late completion, Chinese/English, light/dark and 320/768/1240 px.
  The adopted composer and narrow dark review were also visually inspected. This is component
  evidence, not an installed package or real Tauri approval result. The suite is in `npm run test:ui`.
- Existing `tests/ui/conversation-reconnect.mjs` passes: reconnect reuses the original turn, completion
  survives reload, and manual reconnect never resends a prompt.

- The broader existing `tests/ui/conversation.mjs` fails its save-to-Library nested-menu Escape
  assertion at line 324. The identical test against unchanged committed `50ff44f`, exported to a
  separate temporary directory and served on port 5194, fails at the same assertion. This existing
  issue is not attributed to handoff and remains unresolved; the whole UI suite is not reported green.
  Logs: `/tmp/nooki-c05-ui-conversation.log`, `/tmp/nooki-c05-ui-conversation-baseline.log`.

Logs: `/tmp/nooki-c05-ui-js.log`, `/tmp/nooki-c05-ui-client-red.log`,
`/tmp/nooki-c05-ui-receipt-red.log`, `/tmp/nooki-c05-ui-native-first.log`,
`/tmp/nooki-c05-ui-attachment-recheck.log`, `/tmp/nooki-c05-ui-native.log`,
`/tmp/nooki-c05-ui-components.log`, `/tmp/nooki-c05-ui-reconnect.log`.
Screenshots: `/tmp/nooki-c05-handoff-adopted.png` and
`/tmp/nooki-c05-handoff-{zh,en}-{light,dark}-{320,768,1240}.png`.

## Independent exported kit

`npm run capability:kit -- /tmp/nooki-c05-ui-kit.zip` exports kit 0.10.0/platform 0.11.0.
The exported scaffold created an outside-checkout project at
`/var/folders/9c/15n4n4352453j0stxgkrlkkr0000gn/T/nooki-c05-ui-kit-46q9viuj/package`.
It installed its own dependencies (no symlinks), passed `npm run check` and `npm run pack`, and its
contract matches the canonical source byte-for-byte. Type checking accepts public handoff and rejects
a caller-specified destination or a missing idempotency key. The existing kit regression rejects the
handoff permission at platform 0.10.0 and accepts 0.11.0.

Its archive contains exactly `entry.js`, `manifest.json` and `style.css`, declares `storage` and
`conversations.handoff`, and requires platform 0.11.0. SHA-256:
`3f6cdfeaf1d06e414dd3d66289ef2d7b20dcebade9b5a922cab89b7bdfe0b562`.
This is a compile/pack fixture, not an installed handoff demonstration. C05c will build dedicated
Reader/Peer archives and obtain approval for their new handoff permission before installation.

## Desktop delivery and limits

`npm run desktop:build` passes including TypeScript checks (release compilation 35.82s; bundle
25.28 MiB). `npm run desktop:install` and strict deep signature verification pass. Installed
`/Applications/Nooki.app/Contents/MacOS/app` SHA-256:
`9ab05d2d1236674a402f1b096ca0e00a62017e2f81b691961ff0ca543db28d5d`.
Logs: `/tmp/nooki-c05-ui-desktop-build.log`, `/tmp/nooki-c05-ui-desktop-install.log`.

Review covered immutable intent, native ownership, lifecycle cleanup, target loss, source provenance,
composer preservation and absence of implicit send. The existing chunk-size advisory and pinned Vite
development-dependency audit finding remain unresolved. No live model turn, production isolation
against hostile packages or installed handoff acceptance is claimed here.
