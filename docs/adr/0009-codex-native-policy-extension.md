# ADR 0009: Codex-native policy extension

- Status: proposed; scope decision pending
- Date: 2026-11-26
- Parent decision: [ADR 0008 — retain Codex first](0008-capability-agent-adapter-selection.md)
- Requirement: [C06 implementation and acceptance](../capability-platform-implementation-tasks.md)

## Problem

The audited official CLI paths in Codex 0.170.0 and 0.172.0 start inherited synthetic MCP
processes despite the tested disable configurations. A configuration read followed by a thread
start does not freeze the effective configuration. Source audit and native controls are recorded
in ADR 0008 and its linked receipts. No complete production policy has been certified.

The owner retained Codex priority. Switching adapters, weakening the effect boundary or exposing
the ordinary conversation runner would not implement that decision. The remaining question is
whether Nooki may add a Codex-native policy integration beyond the current installed-CLI adapter.

## Proposed scope

Permit a version-pinned native integration based on the official Codex runtime, with one new
responsibility: bind the Host-approved execution policy before native startup and enforce it at
every configuration reload/resume. Prefer an upstream-supported interface when available. If a
separate controlled Codex executable is needed, qualify it as an additional native component;
do not replace the user's installed CLI or silently maintain a vendor fork.

Codex continues to own models, authentication, sessions, tools, approvals and cancellation. Nooki
continues to own the existing review/journal, installation authority and routing through its native
adapter. No new model HTTP client, credential store, Agent loop or scheduler is introduced.

### Native extension boundary

The prototype starts from the audited official `ConfigBuilder`/`ConfigManager` configuration path
and `run_main_with_transport_options` entry point. Public library loader overrides alone are
insufficient: user/project exclusions do not eliminate managed/cloud configuration. The extension
must inspect and constrain the final native effective configuration before constructing anything
that can launch a connector, hook, plugin, helper or tool. It must cover startup as well as later
configuration refreshes; validating only `thread/start` responses is too late.

The Host selects a fixed policy through a native-only launch interface. Package JSON and ordinary
app-server configuration writes cannot replace or disable it. The prototype must prove that this
policy survives every configuration-loading path; the source integration point is not presumed
adequate until tested.

The source review of pinned 0.170.0 found that `ConfigBuilder::build_with_validation` is not
a universal enforcement point: `Config::rebuild_with_session_layers` calls
`load_config_with_layer_stack` directly. The app-server uses that path for retained sessions,
configuration refresh and thread-scoped MCP status requests. Validation must cover the common
materialization path and every later effect-producing path, rather than rely on the optional
builder callback. Moreover, `to_mcp_config_with_loaded_plugins` registers plugin and additional
servers after materialization; checking only `ConfigToml.mcp_servers` cannot establish a complete
MCP policy. These are source findings, not proof that the proposed full extension is feasible.
Startup policy rejection must also remain fatal: native non-strict startup can recover from
configuration errors using defaults. The disposable MCP experiment therefore fixes strict startup;
production qualification must prove no recovery path discards an enforced policy.

The subsequent [hooks checkpoint](../capability-platform-evidence/C06c-hooks.md) confirms that
bootstrap `features.hooks=false` is also mutable: a thread override can re-enable a trusted
`SessionStart` hook, and replacing the entire features table while omitting hooks loses the
disable. The configured-MCP guard has the same behavior as the unmodified control. Ordinary
feature flags and read-only thread responses cannot serve as the native hook policy boundary.
The [fixed refusal follow-up](../capability-platform-evidence/C06c-hooks-guard.md) demonstrates
that a check after managed-feature resolution rejects the tested enable/reload paths and the
independent legacy `notify` command while preserving ordinary local turns. This narrows the
feasibility uncertainty, but does not qualify managed/plugin execution, non-strict recovery,
resume or a Host-bound production policy. The committed patch is a qualification fixture only.
The [startup-policy experiment](../capability-platform-evidence/C06c-startup-policy.md) subsequently
reproduces non-strict recovery of policy errors and malformed managed requirements. Typed fatal
refusals plus retaining the native managed-policy snapshot pass the 15 synthetic startup controls
and the existing local-turn regression. This qualifies the listed startup cases, not real MDM/cloud
refresh, managed hook execution or the complete Host-bound policy.
The [resume/plugin checkpoint](../capability-platform-evidence/C06c-resume-plugin.md) verifies scoped
persisted-thread resume refusals and recovery, but reproduces plugin MCP launch after an idle
thread is refreshed by plugin installation. Final catalog validation and typed-error propagation
through refresh/fallback paths are therefore required; initial configuration checks alone remain
insufficient. No complete gate-2 qualification is claimed.
The [thread-MCP follow-up](../capability-platform-evidence/C06c-thread-mcp.md) reuses the native
`McpServersDisabled` marker to exclude installed-plugin MCP from tested thread startup, refresh
and inventory paths without changing the publication API. Plugin installation itself remains
successful. Threadless inventory still starts that same canary, demonstrating that thread exclusion
is only one part of the effect boundary. Global discovery/OAuth and explicit handling of incompatible
managed requirements remain required; this experiment does not authorize a production component.
The [control-plane experiment](../capability-platform-evidence/C06c-control-plane.md) then places
a fixed native refusal before initialized-request queueing and event-stream reservation. It closes
the tested global inventory/resource and plugin-install discovery paths, with matched process,
HTTP and install-state controls, while retaining ordinary turns and scoped reload checks. Skills,
dynamic tools, internal effect callers, managed conflicts and Host policy binding remain open;
passing these request checks neither completes gate 2 nor changes the pending scope decision.
The [dynamic/Skills checkpoint](../capability-platform-evidence/C06c-dynamic-skills.md) qualifies
refusal of new and persisted dynamic-tool declarations on start/resume/fork, with real synthetic
native callback controls. It also shows Skill body injection outside the selected input/output
roots despite the named filesystem profile and disabled catalog rendering. Skills must be
constrained at their native read/injection boundary; display flags are insufficient. Live native
tool replacement remains unqualified. Managed MCP allowlists must be distinguished from separate
required-server behavior rather than treated as mandatory launch instructions.

The policy must:

- bind the approved input/output scope to native filesystem/network permissions;
- exclude unrelated MCP servers, Skills, hooks, dynamic tools and other effect-producing features;
- preserve native managed requirements, refusing incompatible requirements explicitly;
- retain Codex-owned authentication while preventing credentials or configuration contents from
  entering the capability SDK, review payloads or Nooki operational logs;
- reject an unsupported runtime/protocol/policy revision before model or tool startup;
- remain fixed across thread start, resume, permission updates and background configuration reload;
- provide a native policy receipt tied to the actual component/configuration and run identity for
  the existing C06b approval/submission checks.

Authority cannot be established from a caller-supplied digest or feature name. Credential helpers,
managed hooks and provider-specific startup behavior need explicit treatment; preserving native
authentication does not automatically certify those execution paths. Incompatible configurations
must remain visibly unavailable rather than fall back to ordinary conversation execution.

### Nooki integration

Reuse the existing Codex transport in a dedicated capability-run session owner. Connect verified
policy receipts to `capability_agent_review.rs` and `capability_agent_runs.rs`; keep their native
lifecycle fences, immutable inputs, durable submission identity and unknown-outcome behavior.
The package-facing API remains absent until policy, dispatch/reconciliation and Host interactions
pass together. C06d/C06e retain their original exported-kit and installed acceptance obligations.

Any additional native artifact must have an explicit source/version pin, reproducible build and
integrity check, supported-platform matrix, distribution/license review and failure behavior. Its
size and build/update cost must be measured before production adoption. The audited official
0.172.0 arm64 executable is about 305 MB uncompressed; that is context for the potential cost,
not a size prediction for the proposed component. Nooki's current installed app is not replaced
with a modified Codex artifact by this proposal.

## Implementation gates

Disposable synthetic qualification may refine this proposal without adopting a product component.
Formal integration and distribution remain subject to the pending scope decision. The initial
[source review and experiment](../capability-platform-evidence/C06c-native-prototype.md) found
additional loading paths. The 2026-11-27 follow-up built a configured-MCP guard and an unmodified
control with matched settings: the control reproduced startup, while the guard passed the tested
startup/refresh refusals and recovery controls. The subsequent
[local-model fixture](../capability-platform-evidence/C06c-model-fixture.md) also passes: clean and
recovery turns complete through Codex's native transport, while the rejected configuration starts
neither the MCP canary nor another model request. This satisfies the first gate's narrow feasibility
checkpoint; it does not qualify the complete startup policy in gate 2.

1. **Disposable native prototype — configured-MCP/local-model feasibility verified 2026-11-27:**
   implement the smallest pre-start policy hook against pinned
   official source. Use only synthetic configuration and a local model fixture. Prove ordinary
   control cases work before interpreting denials. No personal credentials or real model calls.
2. **Complete native policy qualification:** test configuration additions between read/start,
   managed/cloud refresh, resume, hook/plugin/Skill startup, denied source access, protected output
   paths and policy mutation. Unknown paths or conflicting managed requirements must refuse work.
   Confirm native authentication ownership separately; do not infer OAuth behavior from fake keys.
3. **Existing adapter integration:** bind the qualified policy to the C06b review and journal,
   implement native identity/reconciliation/cancellation, then expose C06d's Host interaction/SDK.
4. **Delivery acceptance:** finish C06e's independent archive and explicitly authorized real-Agent
   run, update the compatibility evidence, and validate the installed Nooki artifact.

Each gate must produce authoritative evidence. The first gate may discover that a safe small
extension is infeasible; that outcome does not authorize a larger replacement Agent runtime.

## Alternative: retain only official installed CLI integration

Keep the current implementation boundary and wait for a supported Codex interface that passes the
same native startup controls. Existing C06a/C06b work remains retained, with model dispatch unavailable.
This avoids a new native artifact and its update burden, but the audited interfaces currently do
not supply the required boundary. Additional partial probes cannot substitute for that interface.

## Pending decision

The owner is asked whether to allow the proposed native-policy integration scope or to retain only
the existing official installed-CLI integration. This question concerns distribution/maintenance
scope, not the already settled Codex priority. No extension, native artifact or application runtime
change is adopted by this document. C05c installation authorization remains an independent path to
resume handoff acceptance.

## Proposal delivery validation

Local documentation links and `git diff --check` pass. Desktop build/install and strict deep
codesign verification pass; installed Nooki remains 0.12.0 with unchanged executable SHA-256
`9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-native-extension-desktop-build.log` and
`/tmp/nooki-c06c-native-extension-desktop-install.log`. Existing task workers were handed off by the
installer. Application regression tests were not rerun for this documentation-only change;
existing bundle-size/plugin-timing advisories remain. No production native extension integration or
production policy qualification is claimed.
