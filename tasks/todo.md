# Conversation Capability Broker TODO

- [x] Inspect the existing capability runtime, task runner, conversation hosts, and all three agent protocols.
- [x] Confirm current Codex dynamic-tool, Claude MCP, and pi extension integration points.
- [x] Create a feature branch from the latest `origin/master`.
- [x] Record architecture, safety boundaries, slices, and completion criteria.
- [x] Slice 1: write failing command-contract and package-validation tests.
- [x] Slice 1: implement the optional command contract and compatibility validation.
- [x] Slice 1 checkpoint: run focused contract/package tests and commit.
- [x] Slice 2: write failing capability-broker tests.
- [x] Slice 2: implement search, describe, invoke, validation, confirmation gating, idempotency, and normalized results.
- [x] Slice 2 checkpoint: run focused broker tests and commit.
- [x] Slice 3: implement invocation state plus the reusable conversation card with tests.
- [x] Slice 3 checkpoint: verify confirmation and persisted history behavior and commit.
- [x] Slice 4: implement and test the Rust renderer/native relay.
- [x] Slice 4 checkpoint: verify authenticated socket relay, renderer response, and duplicate/late reply rejection and commit.
- [x] Slice 5: implement and test the Codex dynamic-tool adapter and legacy-session messaging.
- [x] Slice 6: implement and test the Claude Code MCP adapter.
- [x] Slice 7: implement and test the pi extension adapter.
- [x] Agent checkpoint: verify common tool registration and relay wiring across Codex, Claude Code, and pi and commit.
- [x] Slice 8: migrate the bundled Codex daily review to an explicit confirmed command.
- [x] Slice 8: update capability authoring documentation, starter templates, and compatibility guidance.
- [x] Run the full platform, capability, UI, TypeScript, and Rust verification suite. (The unrelated legacy `scratch_img_test` still requires its missing `/tmp/nooki-sandbox-home` fixture; all feature and application suites pass.)
- [x] Manually verify discovery, confirmation, invocation, cancellation, failure, and conversation rendering.
- [x] Quit Nooki, run `npm run desktop:build`, and run `npm run desktop:install`.
- [x] Review the final diff for scope, security, compatibility, and generated artifacts.
- [x] Push `codex/conversation-capability-broker` and open an English pull request into `master`.

## Direct attachment handoff follow-up

- [x] Extend command contract, loader checks, and authoring guidance for opt-in conversation sources.
- [x] Resolve only current-turn Library snapshots and uploads with source-isolation tests.
- [x] Inject trusted sources via the broker and show titles, not contents, during confirmation.
- [x] Teach the common agent tool description when to search/use matching capabilities.
- [x] Update and test the Weekly report package, then produce a new ZIP.
- [x] Run platform and package automated verification, including static ZIP rendering.
- [ ] Manually invoke the installed Weekly report package with conversation attachments. This requires importing version 1.2.0; package creation alone does not install it.
- [x] Rebuild/reinstall Nooki 0.3.1 from this branch.
- [x] Commit, push, and update PR #29.

## Codex active-turn follow-up

- [x] Reproduce unsupported turn-listing during an active turn and verify no duplicate prompt.
- [x] Replace unsupported history API usage with the supported read contract.
- [x] Track new turns from the returned turn and pre-subscribed event stream, with receipt-only reconnect.
- [x] Run focused and broader verification, then rebuild/reinstall Nooki.
- [x] Commit and push only this fix; update existing PR #29.
