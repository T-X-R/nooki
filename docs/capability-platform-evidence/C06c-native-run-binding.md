# C06c2 checkpoint: Native run admission and cold recovery

Date: 2026-11-27. Follow-up to `2543056`, on the existing feature branch and PR #38.

**The disposable component passes the tested binding/refusal and cold-recovery cases. C06c2 and
C06c remain open: this is not the Nooki launcher integration or a complete approved-input/policy
boundary.** No experimental executable is bundled or installed into Nooki or the ordinary Codex CLI.

## Native changes

The [complete experimental patch](C06c-native-run-binding.patch) retains the earlier fixed policy
restrictions. The dedicated app-server additionally requires a private launch envelope through
inherited descriptor 3 before configuration/auth/plugin startup. The envelope contains the existing
[Host binding](C06c-host-binding.md) and an explicit fresh/recovery mode. It validates protocol and
executable-file SHA-256 and holds an exclusive native owner lock for the process lifetime.
The launcher in this experiment is the synthetic probe, not the actual Host journal adapter.
Native arg0 helper preparation still precedes this entry point; this is not a claim that every
filesystem effect occurs after admission.

A private native receipt retains the binding, thread identity, semantic-scope hash and one-time
submission claim. Creation and updates use an exclusive pending file, file synchronization, rename
and directory synchronization. Reads refuse missing recovery state, corrupt/nonregular state,
symlink paths and mismatched binding. A fresh launch cannot overwrite an existing receipt. This
receipt is runtime provenance, not another approval store; its presence alone is never Host approval.
The tested boundary assumes native-owned state and launch descriptors. It does not protect against
an attacker who can replace the native state, executable or trusted launch envelope.

Before native session construction proceeds, the component binds the thread and a normalized
snapshot of permissions, workspace/cwd, approval policy/reviewer, model/provider, instructions and
shell-environment policy. Semantic permissions are captured after managed deny restrictions and
before adding the current native arg0 helper allowance. Memory-tool readable roots remain in the
semantic snapshot. No old path is removed by name or prefix. This snapshot is deliberately not
presented as the complete production policy: other feature/environment/effect contributors still
need qualification, and it is not yet checked against the Host's resolved policy materialization.

The private request surface permits only bound creation/resume/read/unsubscribe/start/interrupt.
Forks, explicit rollout/history imports, other thread identities and alternate methods are refused
before queueing. A turn requires the retained client-message ID and a durable one-time claim.
An uncertain or rejected post-claim operation cannot be resubmitted. This prevents replay in the
tested path, but does not yet reconcile a native turn ID or classify every uncertain outcome.

A discovered durability gap required an additional native fix: `ThreadPreparation` only flushes
an existing local writer and does not materialize a fresh rollout. The component now awaits
`PersistContext::Standard` and flushes before publishing `SessionConfigured`. A reported new
thread can therefore be recovered before its first turn. A crash between provenance creation and
rollout materialization still fails closed; atomic cross-store crash recovery is not claimed.

## Process verification

[The probe](../../scripts/probe-capability-agent-native-run-binding.mjs) runs separate native
processes with synthetic isolated homes and a static localhost Responses service. It does not
perform inference, use personal credentials, or call a real model.

| Scenario | Previous live-scope component | Bound-run candidate |
| --- | --- | --- |
| Missing binding / wrong component | Initializes | Native startup refusal |
| Concurrent native owner / second thread | Accepted | Native owner/admission refusal |
| Foreign thread read | Generic not-loaded error | Explicit binding refusal |
| Missing client-message ID / duplicate turn, live and after restart | Four total synthetic turns, including these submissions | All three refused; no additional model request |
| Changed run, approval, input digest, policy digest, client message, installation generation or restore scope | Initializes | Provenance mismatch refusal |
| Fresh launch over existing receipt | Initializes | Refused |
| Missing/corrupt recovery receipt | No native receipt exists, so these mutations cannot be matched | Both refused on candidate-created state |
| Fork / explicit rollout import / supplied history | Accepted | Refused |
| Cold resume with wider filesystem scope | Returns workspace-write scope | Refused before model dispatch |
| Same-run cold resume after a completed turn | Succeeds | Succeeds; original thread/path/input retained |
| Native transient helper path changes | Observed | Observed; unchanged semantic scope still resumes |
| Restart immediately after thread creation, before first turn | No rollout found | Same thread/path resumes and completes its first synthetic turn |

The final candidate exits 0: **22 explicit refusals, two completed synthetic turns, no mismatches
and no fixture errors**. The matched previous component deliberately exits 1 with 22 unmet
expectations, four completed synthetic turns and no fixture errors. The old foreign-thread read
already fails generically; it is not represented as an old cross-thread disclosure. The old
missing/corrupt receipt cases are skipped and its absent provenance is recorded separately.
Only the candidate's successful ordinary recovery and first-turn completion establish usability.

| Artifact | Identity / local receipt |
| --- | --- |
| Candidate | `410451f96663c283a34df8d0027e0fc102219d2dc36f966dc3b1dc8e213012a6` |
| Previous live-scope control | `e947b8aac85b9b343d172be55facd4420a88662ac1140075f1397e5aceff93f1` |
| Probe SHA-256 | `52c8224adeb8babf7355b7f724a2a413e798520297ee743d7fd4c57ca69f7002` |
| Complete patch SHA-256 | `94c5920cee4becb6ee26f08488cc2ca3db48f138399bbf37eb766495a7527c5c` |
| Candidate receipt | `/private/tmp/nooki-profile-qsd342/native-binding-probe.json` |
| Matched control receipt | `/private/tmp/nooki-profile-MySnpI/native-binding-probe.json` |

The complete eleven-file zero-context patch replays exactly (`patch -p1` or
`git apply --unidiff-zero`) against pinned official commit
`29eb79e9866b3262a777fdf8195c1b9e63684c91` with its previously verified workspace-version lockfile
normalization applied first (normalized lock SHA-256
`11ed3c419dcb08d7d3921f20eb4980c7a0620234c1f7ed79a2d3ca3b98f39a3e`). The new lock delta adds the
already-cached workspace SHA-256 dependency to `codex-core`; no new external package is introduced.
The binary remains a macOS-only qualification artifact reporting app-server 0.170.0.

Build uses Rust 1.98.0, the previously checksum-verified V8 inputs, `--locked`, dev debug info off,
incremental off, four build jobs and `--config 'profile.dev.package.sha2.opt-level=3'`.
The added hash optimization differs from the previous control's build settings; no matched
performance comparison is claimed. An initial unoptimized executable hash took 19.169 seconds
and exceeded the probe's 15-second initialization timeout. Sampling located SHA-256 compression;
with the explicit dependency optimization, four final successful initializations take 1.288–1.343
seconds. Initial timeouts are not policy evidence. The final native build takes 1m 30s and retains
the existing unused-helper/linker advisories.

Logs and the aggregate identity receipt are under `/tmp/nooki-c06c-native-prototype/`:
`binding-build-standard.log`, `binding-green-standard.log`, `binding-red-matched.log`,
`binding-patch-identity.json` and `binding-matched-result-20261127.json`.
The failed preparation-only attempt remains in `binding-green-durable.log` and
`/private/tmp/nooki-profile-JthAnU/native-binding-probe.json`; it is not counted as passing.

## Remaining acceptance

- Connect the trusted launch/recovery path to the actual Host journal, verified component owner
  and native identity reconciliation. The synthetic descriptor is not end-to-end authorization.
- Validate exact retained input materialization, output schema and actual first-turn payload
  against the Host input digest. Current digest equality checks do not validate submitted text.
- Resolve complete native semantic policy and verify it against the approved policy before effects;
  qualify managed/remote/required environments and all startup/refresh contributors.
- Reconcile lost creation/start replies and native turn IDs, and inject failures around the
  provenance/rollout/Host-journal boundaries. Process restart is not power-loss or write-fault proof.
- Qualify native authentication, approvals/questions/cancellation, verified component distribution
  and update/rollback. Hashing the executable file is not mapped-image attestation or an update lock.

The earlier unbound startup/hooks/Skills probes were not rerun against this component: mandatory
launch binding changes their setup, and one-turn admission changes their interaction contract.
Their historical results do not automatically certify this new artifact. Adapt them to the bound
launch path before integration. No public Agent API, installed Agent acceptance, or complete C06
acceptance item is closed by this checkpoint.

## Delivery checks

Probe syntax, all 134 local file links in the changed documents, exact eleven-file patch replay
and diff checks pass. Native fixture processes were confirmed stopped. Application regression
suites were not repeated for this probe/documentation-only change; the previous Host-binding full
regression remains separately recorded. Desktop build (native release: 30.08s), reinstall with
normal task-worker handoff, and strict deep signature verification pass. Installed Nooki remains
0.12.2; executable SHA-256 is unchanged:
`7f6e467d890f8a60bca0422fdf7f3c38ce41cf45a3760828864b6cfc2c49b104`.
Logs: `/tmp/nooki-c06c-native-binding-desktop-{build,install}.log`.
The existing frontend chunk-size advisory remains. No new UI or real-Agent acceptance is claimed.
