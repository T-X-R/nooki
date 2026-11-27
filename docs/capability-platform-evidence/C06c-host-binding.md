# C06c1: Host-owned native run binding and identity reconciliation

Date: 2026-11-27. Follow-up to `2652ef2` on the existing feature branch and PR #38.
This implements the Host journal half of [ADR 0009's private binding](../adr/0009-codex-native-policy-extension.md).
It does not connect a Codex process, verify native provenance or close C06c.

## Changes and authority

The native policy resolver now returns both the resolved policy digest and the expected component
SHA-256/private protocol revision. Both are retained in the approved intent. The Host checks them
again at approval and the first submission claim; package proposals cannot provide either value.
The component revision is the private binding protocol revision, not the ordinary app-server version.
A future qualified adapter must verify actual executable bytes/protocol and resolve the complete
semantic policy before supplying these values. Synthetic resolver identities in tests are not such
verification.

The existing journal remains the only Host approval/submission owner. No second approval store is
introduced. Under the existing data/installation/restore fences, it reconstructs a private binding:

- Run ID, installation/restore scope, approval ID and durable client-message ID.
- Domain-separated digest of retained instructions, complete selected document snapshots, output
  schema and Agent identity. It includes source bodies, not only reference IDs or revisions.
- Approved semantic policy digest and component identity.

The binding is available only after a durable submission claim. Reading it never grants another
submission, and a matching envelope alone is not proof that native history belongs to the run.
The future dedicated adapter must compare verified native provenance with this authoritative
journal before resume. No SDK method, Tauri command or renderer endpoint exposes these operations.

After validating the actual native provenance, the adapter can record thread creation and then its
turn identity. Recording is atomic with the existing ledger. Exact response replay and late
thread-only responses preserve the known turn. Different thread/turn IDs conflict; a thread cannot
be associated with another run. The submission remains pending until a later qualified outcome
reconciler resolves it; storing IDs does not claim successful execution or termination.

Current installation authority remains required. Source revocation or a changed current policy
must not erase the identity of work already submitted: recording an observed prior outcome is not
permission to execute again. Disable/re-enable changes installation scope and refuses stale receipts.
Imported records retain native IDs for history but never regain execution authority, even if an
archive predicts the new restore scope. Pre-binding journals remain readable; approvals without a
component cannot be silently upgraded or dispatched. A new approval requires a new intent key.

## Verification

The initial regression failed on the unchanged implementation: a persisted approved intent lacked
the expected component identity. It passed after implementation (`/tmp/nooki-c06c-binding-red.log`).
The focused suites cover:

| Scope | Assertions |
| --- | --- |
| Approval | Native-owned component; component changes rejected at approval/claim; invalid protocol/hash rejected |
| Replay/restart | Binding reconstructed from disk; exact native reply replay; late thread-only response cannot erase turn; submission cannot be reclaimed |
| Correlation | Run, installation scope, approval, client-message, input, policy, component hash and protocol mismatches rejected without mutation |
| Native identity | Different thread/turn rejected; duplicate thread across runs rejected; malformed IDs rejected |
| Durability | Failed pending-file write leaves no association; authority and backup share the data fence; two fresh child processes associate exactly one competing receipt |
| Inputs | Instructions, retained source body, output schema and Agent identity affect the input digest |
| Lifecycle | Revoked source still permits recording prior submission; foreign/disabled/re-enabled installation is refused; forged restore scope cannot revive binding |
| Compatibility | Historical approval/pending records readable without binding; no automatic eligibility upgrade; backup validates native metadata and duplicate ownership |

The focused ledger suite has 23 top-level tests plus four child-process executions; the native
review suite has 14 tests. These are deterministic Host tests using synthetic component/native IDs.
They are not a native Codex restart, crash-injection, actual component-integrity or installed Agent
acceptance claim. No real model call was made.

## Next required step

Implement the native component half before dispatch: trusted launch admission before effects,
durable native provenance tied to this binding, crash-consistent creation/start reconciliation,
refusal of foreign/missing/restored provenance and fork/import, and legitimate same-run recovery.
Keep semantic grants distinct from process-specific trusted helper allowances. Merely passing this
JSON to a process or comparing its echoed digest does not satisfy the boundary. Complete managed/
remote/required-environment qualification, authentication continuity and distribution gates remain.
C06d/C06e and downstream work retain their dependencies.

## Regression and delivery

Final source passes `cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1`:
312 top-level native tests plus five child-process executions pass, with two existing real-Agent
tests ignored. The explicit competing-process tests still execute concurrently inside that run.
`npm test` passes 203 platform and 5 capability tests. Logs:
`/tmp/nooki-c06c-binding-native-final.log` and `/tmp/nooki-c06c-binding-js.log`.

Earlier attempts are not presented as passing. The sandboxed full run could not create existing
relay/worker sockets; the permitted run passed the new binding/review tests but failed the unchanged
`completed_task_chat_and_archive_preserve_goal_and_acceptance` test when acceptance saw an active
turn. An immutable copy of pre-change commit `2652ef2` passed that focused test and 20 repetitions
of its complete task-goal test binary; this did not reproduce the failure and does not establish
its cause. The final serial run passes it. One earlier parallel ledger run also failed an existing
conflict-category assertion without printing the actual error; an isolated rerun and subsequent
parallel/full-serial runs passed. That assertion now includes the error and input in diagnostics.
No unrelated task code/assertion was changed, and no product timing fix is claimed. Logs/receipts:
`/tmp/nooki-c06c-binding-native-all{,-permitted}.log`,
`/tmp/nooki-c06c-binding-{final,conflict}.log`, and
`/tmp/nooki-c06c-binding-baseline-2652ef2/goals-reproduction.json`.

The installed app patch version advances to 0.12.2 for this internal journal change. Public contract
0.12.0 and kit 0.11.0 remain unchanged; kit platform metadata matches the app. No experimental
Codex artifact is bundled, and no new Agent UI/API becomes available.

Desktop build (32.37s native release), reinstall and strict deep signature verification pass.
Installed Nooki 0.12.2 executable SHA-256:
`7f6e467d890f8a60bca0422fdf7f3c38ce41cf45a3760828864b6cfc2c49b104`.
Logs: `/tmp/nooki-c06c-binding-desktop-{build,install}.log`. Existing frontend large-chunk/plugin
advisories remain. All 130 local file links in the updated documents and `git diff --check` pass.
No new installed UI acceptance is claimed for this unexposed native-journal slice.
