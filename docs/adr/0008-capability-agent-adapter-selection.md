# ADR 0008: First supported capability Agent adapter

- Status: proposed; owner decision required before changing the Codex-first implementation order
- Date: 2026-11-26
- Design authority: [Agent delegation boundary](../capability-platform-design.md#8-runtime-policy-and-limits)
- Implementation authority: [C06 implementation checklist](../capability-platform-implementation-tasks.md)

## Context

The agreed C06 deliverable is one observable run path through an existing installed Agent, with
bounded inputs/effects, native authentication, durable identity, Host-owned interaction and no new
model client or credential store. Its current C06c implementation slice explicitly selects Codex.
C06a verified native filesystem/network policy; C06b delivered durable intent and native review.
Neither establishes complete app-server startup authority.

The [configuration checkpoint](../capability-platform-evidence/C06c-config.md) and
[credential-link checkpoint](../capability-platform-evidence/C06c-auth-link.md) demonstrate a gap:
empty MCP maps preserve inherited servers, an enumeration/reload race admits a new server, and
the orchestrator disable setting and empty environment list still allow synthetic connector
processes to start. A separate home can reuse native file authentication, but it does not remove
system, managed/cloud and project configuration layers.

This is an interface limitation in the audited integration paths, not a failed model task or a
reason to reinterpret the accepted isolation requirement. The public Agent API remains unavailable.

## Latest-release control

On 2026-11-26, the official releases API identifies
[0.172.0](https://github.com/openai/codex/releases/tag/rust-v0.172.0), published 2026-11-24,
as the latest stable release. Its source commit is `3d86e43b075adeba2193ec5c22ac92f55afd82e6`.
The arm64 macOS archive was downloaded only to `/tmp/nooki-c06c-codex-0.172.0`; its SHA-256 matches
the official asset digest:
`bd121f8abd6b28b3fc476da04a348e25a83e89eda19d39107f68f8e966053092`.
The installed CLI remains 0.170.0.

All six configuration controls produced the same outcomes with the official 0.172.0 binary and fresh
synthetic homes. The committed probe was copied to the temporary directory with only its import path
and exact version assertion/receipt changed. No production version gate was relaxed.

- Log: `/tmp/nooki-c06c-codex-0.172.0/probe.log`.
- Receipt: `/private/tmp/nooki-profile-unn7UE/config-probe.json`.
- Zero model turns and no credentials; `productionPolicyCertified` remains false.
- Extracted executable SHA-256: `f30a99714dc984876864239ef60563949b1e21421a7c9180422f51fd39186bc6`.
- This is configuration-counterexample coverage only, not certification of 0.172.0's sandbox,
  authentication, session protocol or production adapter.

The pinned [release CLI](https://github.com/openai/codex/blob/3d86e43b075adeba2193ec5c22ac92f55afd82e6/codex-rs/cli/src/main.rs)
still passes default loader overrides to the app-server. Internal user/project loader controls and
debug-only test configuration hooks do not provide a supported external release isolation interface.
The release's lazy optional stdio startup is not a startup deny-all or an authority boundary.

## Options

### A. Keep Codex as the first supported capability Agent

Keep C06c's current adapter selection and accepted effect boundaries. Resume dispatch implementation
when a supported native interface can enforce the complete policy before process/tool startup and
across reload/resume. Any proposal to distribute a modified Codex runtime or a new native execution
component requires a separate design decision; it is not silently added to Nooki's thin adapter.

This retains the planned first adapter, but current evidence does not provide a safe implementation
path through the audited installed/released CLI interfaces. C06c and its dependent delivery remain
blocked; additional partial probes alone cannot close the gate.

### B. Qualify another existing adapter first — recommended for continued delivery

First audit the already integrated Claude Code and pi adapters against the **same** complete C06
criteria. Their installed help exposes explicit customization/tool controls: Claude includes safe
mode, strict MCP configuration, tool selection and skill disabling; pi includes extension, skill
and tool disabling. Help text is a candidate interface, not proof of enforcement.

Before changing run dispatch or making an adapter selectable:

1. Prove native startup/reload context and effect controls with positive/negative synthetic fixtures,
   preserving managed requirements and the Agent's existing authentication owner.
2. Verify approved inputs/output paths, structured results, Host questions/approvals, native session
   identity, restart reconciliation and cancellation. No prompt-only substitute is accepted.
3. Connect only the verified adapter to the C06b ledger and review controller; retain native
   authentication/session ownership and the generic public Host contract planned in C06d.
4. Complete the independent archive and explicitly authorized real-Agent acceptance in C06e.

If no existing adapter passes, return to the decision without lowering acceptance or inventing a
new Agent runtime. If one passes, update C06c to that first supported adapter and retain Codex as
explicitly unsupported for capability-owned runs until its own policy is qualified. Ordinary native
Codex chat and task-board behavior remain outside this change.

This option changes the Codex-first implementation order, so it is proposed rather than adopted.
It preserves C06's original one-adapter deliverable and Nooki's existing Agent ownership boundary.

## Independent acceptance and dependency impact

C05c is otherwise ready for installed handoff acceptance, but the concrete Handoff Reader/Peer
archives still await their separate installation authorization. The earlier Delivery package grant
does not include the new `conversations.handoff` permission. Its prepared artifacts and acceptance
sequence remain available in [C05c](../capability-platform-evidence/C05c.md).

C06d/C06e and C07 depend on completed native execution; C08/C09 depend on that chain. R01 begins
after C09, and the remaining R/T/K delivery follows those dependencies. Do not mark dependent tasks
complete or start an unused alternate execution framework to conceal these gates.

## Decision and verification status

No option is adopted yet. No application runtime code or dependency is changed by this proposal.
The owner is asked to choose the first-adapter direction; C05c's existing installation question
remains separate. Current receipts and task statuses continue to govern completion.

Documentation diff checks, desktop build/install and strict deep codesign verification pass.
Installed Nooki remains 0.12.0 with unchanged executable SHA-256
`9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-adapter-decision-desktop-build.log` and
`/tmp/nooki-c06c-adapter-decision-desktop-install.log`. Probe processes exited; the installer handed
off existing normal/test task workers. Application regression tests were not rerun for this
documentation-only change. Earlier C06b2 results retain their original scope. Existing build-size
and plugin-timing advisories remain.
