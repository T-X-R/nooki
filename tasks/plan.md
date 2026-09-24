# Conversation Capability Broker

## Goal

Let Nooki conversations discover and invoke explicitly exposed capability commands through one stable platform contract. The implementation must work with Codex, Claude Code, and pi, allow future agent adapters, and keep existing capability packages compatible.

## Product and safety decisions

- Capability jobs remain private implementation details. Only commands declared in a capability manifest/module are callable from a conversation.
- Existing packages without commands continue to load and run from their current pages, but are not automatically exposed to agents.
- Agents see one stable Nooki broker tool instead of one tool per capability. The broker supports discovery, description, and invocation.
- The broker owns validation, permission checks, confirmation policy, task lifecycle, idempotency, and normalized results/errors. Agent adapters only translate their native protocol to the broker protocol.
- Capability-internal AI calls do not receive conversation capability tools, preventing accidental recursive invocation.
- Write or external-side-effect commands require an explicit policy declaration and user confirmation when required.
- The renderer remains the capability execution host because installed JavaScript capability modules already run there. Native agent processes communicate with it through a local authenticated relay.

## Public contracts

### Capability command

Each callable command declares a stable ID, localized title/description, JSON input schema, output/result metadata, effect (`read`, `draft`, `write`, or `external`), confirmation policy (`never`, `when-needed`, or `always`), and the backing job.

### Broker tool

The public tool is `nooki_capabilities` with three actions:

1. `search` — find enabled commands by natural-language query and optional capability filter.
2. `describe` — return the exact command schema, effect, confirmation policy, and availability.
3. `invoke` — validate input, obtain any required confirmation, run the backing task, and return a normalized result envelope.

### Invocation lifecycle

`proposed -> awaiting_input | awaiting_confirmation -> running -> completed | failed | cancelled | interrupted`

Every invocation carries a stable invocation ID plus conversation, turn, tool-call, capability, command, task, and agent identifiers where available.

## Architecture

```text
Codex dynamic tool ─┐
Claude MCP adapter ─┼─> AgentCapabilityTransport ─> local relay ─> CapabilityBroker
pi extension ───────┘                                      │
                                                           ├─> confirmation / invocation store
                                                           ├─> existing task runner
                                                           └─> common conversation invocation card
```

Future agents implement only `AgentCapabilityTransport`; capability authors implement only the command contract.

## Implementation slices

### 1. Command contract and compatibility

- Add the optional command contract and normalized broker result/error types.
- Validate command declarations during package loading without rejecting legacy packages.
- Update the capability starter/developer kit and contract tests.
- Verify: legacy fixtures still load; malformed commands fail with actionable errors; valid commands round-trip.

### 2. Renderer capability broker

- Implement enabled-command discovery, search, describe, input validation, effect/confirmation gating, idempotent task execution, and result normalization.
- Back execution with the existing capability task runner rather than calling jobs directly.
- Verify with focused broker tests covering disabled/missing commands, invalid input, duplicate invocation IDs, cancellation, and normalized failures.

### 3. Invocation state and common UI

- Add a shared invocation store and reusable conversation card for proposed, confirmation, running, success, failure, and cancellation states.
- Make confirmation an explicit user action and preserve cards in conversation history.
- Verify with component/state tests and a manual conversation flow.

### 4. Native relay

- Add a Rust bridge that accepts canonical broker requests, emits them to the renderer, and resolves replies.
- Expose a same-user local socket for detached native-agent workers and enforce request IDs, size/time limits, and fail-closed behavior.
- Verify serialization, timeout, disconnect, duplicate-reply, and app-shutdown behavior.

### 5. Codex adapter

- Register the generic broker as a Codex app-server dynamic tool for new sessions.
- Handle `item/tool/call` requests and return protocol-shaped results instead of treating them as approvals.
- Surface a clear limitation/migration path for sessions created before dynamic tools were registered.
- Verify with fake app-server tests for list/search/describe/invoke and failures.

### 6. Claude Code adapter

- Add a headless MCP stdio mode that forwards `tools/list` and `tools/call` to the native relay.
- Inject the scoped MCP configuration into Nooki-launched Claude sessions.
- Verify MCP initialization, tool schema, invocation, relay failure, and process cleanup.

### 7. pi adapter

- Provide an explicit Nooki pi extension that registers the generic broker tool and forwards calls to the native relay.
- Load it only for Nooki-launched pi sessions and retain the existing tool allowlist behavior.
- Verify registration, invocation, relay failure, and process cleanup.

### 8. Capability migration and authoring docs

- Declare safe public commands for bundled capabilities where their current behavior and inputs are understood.
- Do not auto-publish or expose ambiguous side effects; model generation and publication as separate commands when possible.
- Document command authoring, confirmation/effect rules, results, and legacy-package behavior.
- Verify the bundled command schemas against their backing jobs.

### 9. End-to-end delivery

- Run focused tests after each slice, then the complete platform, capability, UI, TypeScript, and Rust checks.
- Manually verify discovery and invocation with Codex, Claude Code, and pi, including confirmation and failure states.
- Rebuild and reinstall `/Applications/Nooki.app` from the verified branch.
- Commit incrementally, push the feature branch, and open an English pull request into `master` for human review.

## Explicit non-goals for the first release

- Automatically exposing arbitrary legacy jobs.
- Letting an agent bypass capability permissions or user confirmation.
- Moving installed JavaScript capability execution into each agent process.
- Designing agent-specific capability APIs beyond thin protocol adapters.

## Completion criteria

- A newly authored command is discoverable and callable without modifying conversation or agent-specific code.
- The same command works through Codex, Claude Code, and pi with equivalent broker semantics.
- Adding a future agent requires a transport adapter, not changes to capability packages.
- Legacy capabilities continue to work as before.
- Side effects are visible, attributable, confirmable, cancellable, and represented in conversation history.
- All automated checks pass and the installed desktop app matches the verified branch.

## Follow-up: direct conversation attachments (2026-09-24)

Goal: a user can attach documents and ask for a task in one sentence. The same source handoff works for any installed command that opts in, through Codex, Claude Code, and pi; no separate Library grant or agent-supplied document IDs.

1. Extend the public command contract with an optional conversation-source declaration and document-read permission requirement. Verify legacy packages still load.
2. Resolve sources from the *running, matching conversation task only*: captured Library snapshot plus text uploads. Reject missing/mismatched contexts; never reuse earlier-turn sources. Verify with focused tests.
3. Have the common broker inject a reserved, platform-owned source field after validating agent input, disclose source titles in confirmation, and keep source contents out of the confirmation/history card. Verify refusal, retry, and disabled-command behavior.
4. Update the shared tool guidance so each agent searches for an applicable installed command before doing a matching task; keep the adapters protocol-only. Verify all three register the same behavior.
5. Update the independent Weekly report package to opt in, accept a bare natural-language invocation with this turn's attachments, preserve exact Library citations, and label uploaded-file citations. Verify package tests and ZIP; do not silently install the package.
6. Run relevant tests/builds, review the diff, rebuild and reinstall Nooki, commit/push the existing feature branch, and update its open English PR.

## Follow-up: Codex active-turn history error (2026-09-24)

Goal: a newly started Codex turn remains observable to completion even when the app-server does not implement `thread/turns/list`; opening the conversation during execution must not show that protocol error.

1. Reproduce the active-turn failure with a fake app-server that rejects turn listing, and assert one prompt produces one completed turn.
2. Use the supported `thread/read` history contract directly for browsing/reconciliation; do not probe an unsupported endpoint or hide the error behind a fallback.
3. Subscribe to events before `turn/start`, then track the returned turn and completion event without immediately resuming and rereading the active turn. Keep receipt-based reconnect separate and never replay a prompt.
4. Run focused and full relevant tests, rebuild/reinstall the desktop app, and update the existing PR while preserving unrelated working-tree edits.

## Follow-up: agent-led capability discovery (2026-09-24)

Goal: Nooki exposes installed capability commands through one optional tool without steering every CLI conversation toward capability search. The user's request remains the agent's task; package and command descriptions appear only when the agent calls `search`.

1. Remove capability search and invocation instructions from the shared conversation prompt. Keep the separate Nooki document and workspace rules. Verify the actual Codex and native CLI launch payloads.
2. Keep the broker's existing on-demand `search -> describe -> invoke` contract. Make the tool descriptions concise and optional across Codex, Claude Code, and pi; do not inject a capability list into turns or add a second index.
3. Run focused adapter/broker tests and project checks, rebuild and reinstall Nooki, then commit/push the current feature branch and update its open English PR.
