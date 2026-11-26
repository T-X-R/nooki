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

## Implementation gates if authorized

1. **Disposable native prototype:** implement the smallest pre-start policy hook against pinned
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
existing bundle-size/plugin-timing advisories remain. No native extension implementation or
production policy qualification is claimed.
