# C05b2b: Retained conversation send inputs

- Date: 2026-11-26; based on `a645f3d`, existing branch and PR #38.
- This receipt covers the retained-source prerequisite within C05b2b. Public review/adoption UI,
  package method/kit integration and C05c installed archive acceptance remain pending.

## Delivered behavior

An internal conversation job may carry a retained offer ID. On an explicit send, the main Host
captures its exact retained text through `conversation_handoff_sources`, alongside any additional
documents the user attached. The native command accepts IDs only, never replacement document bodies,
and derives its caller from the Webview. It requires no permission from the removed producer because
the offer is already user-owned. Capturing inputs does not create a conversation or start a turn.

The handoff store and snapshot capture share the task-data lock and restore barrier. Existing
snapshots must match retained references/text and the additional selection. Replays reuse saved
additional text even after its original is deleted. The combined selection is limited to 50 documents
and 8 MB; uploads are included in the send's existing count/size checks. Adding a current Library ID
already present in the retained offer fails visibly, preventing ambiguous versions in one send.

Sources retain revision, original grant, snapshot and handoff provenance. They use the existing
`sources` checkpoint and citation-reader format, so message references and capability commands in
the current conversation see the same retained text. Current-turn validation distinguishes retained
offer references from additional user-selected documents and rejects a mismatched offer/snapshot.
Ordinary sends and task-board sends keep their existing path; a handoff cannot be sent as task feedback.

Native conversation preparation gives offered versions their own working-copy filenames. An offered
historical version can coexist with a previously edited copy of the same Library document. Subsequent
turns reuse edits to that offered copy instead of replacing them with the original retained text.
The existing native file-count, per-file and aggregate limits still apply when preparing working files.

This path does not adopt text into the composer or perform user approval. The public review/adoption
flow must explicitly set the retained offer ID only after user action and preserve any unsent text.
No successful public handoff API has been exposed ahead of that flow.

## Verification

Six native tests use synthetic documents, the actual Library/store/snapshot owners and native
conversation preparation. They cover original deletion and producer uninstall; additional-source
replay after deletion; conflicts and duplicate references; preserved working edits; foreign callers,
forged content and invalid IDs; backup/restore and citation lookup; altered retained snapshot text;
capacity, data-lock contention and a failed snapshot write followed by successful retry.

Three send-job tests verify the native request, preserved uploads/citation snapshot, checkpoint
replay, invalid offer/task feedback, cancellation and combined source count. One additional
current-conversation-source test verifies retained plus extra documents and mismatched scope refusal.
These JavaScript tests use a deterministic Tauri boundary, not a live Agent. Native preparation
verifies actual working files; no installed interactive send or package approval is claimed here.

Red evidence: `/tmp/nooki-c05-retained-red.log` (missing native path),
`/tmp/nooki-c05-retained-js-red.log` (ordinary Library capture used for offered text), and
`/tmp/nooki-c05-retained-context-red.log` (current-turn source consumer rejected the retained set).
Focused results: `/tmp/nooki-c05-retained-native-focused.log` and
`/tmp/nooki-c05-retained-js-focused.log`.

Full regression exposed intermittent `RESOURCE_BUSY` and a marker timeout in the previous native
target tests while their independent process-launch fixtures ran concurrently. A focused parallel
recheck also failed; the same nine tests passed serially. Their fixture lifetimes are now isolated,
while the explicit `join!` cancellation/disable races remain concurrent. All nine pass under the
default test runner after this change. This is an observed test-interference fix; the exact OS-level
lock inheritance mechanism was not established. Evidence:
`/tmp/nooki-c05-retained-native-before-isolation.log`,
`/tmp/nooki-c05-retained-host-recheck.log`, `/tmp/nooki-c05-retained-host-serial.log`,
`/tmp/nooki-c05-retained-host-isolated.log`.

## Regression and desktop delivery

- `cargo test --offline --manifest-path src-tauri/Cargo.toml`: **275 top-level tests plus one nested
  profile child pass**, zero failures, two existing live-agent tests ignored. The default runner is
  used, with local socket/process access required by worker tests. `/tmp/nooki-c05-retained-native.log`.
- `npm test`: **196 platform + 5 capability tests pass**. `/tmp/nooki-c05-retained-js.log`.
- `npm run desktop:build` passes, including TypeScript checks; release compilation 36.04s, bundle
  25.28 MiB. `/tmp/nooki-c05-retained-build.log`.
- `npm run desktop:install` and `codesign --verify --deep --strict /Applications/Nooki.app` pass.
  `/tmp/nooki-c05-retained-install.log`. Installed executable SHA-256:
  `d0a43bf9dbac1344da51155eb61d0c6d6dccbfc4d413f461b101ba75e13ed1f6`.
- `git diff --check` passes. Review covered source ownership, immutable replay, restore locking,
  citation/checkpoint compatibility, preservation of working edits and the absence of implicit send.

The existing chunk-size advisory and the Vite tooling audit finding recorded in C05b1 remain.
No dependency versions or public contract/kit versions changed: app/platform 0.10.0, kit 0.9.0.
C05b2b's retained-input prerequisite is complete; its public review/adoption flow and C05c remain open.
