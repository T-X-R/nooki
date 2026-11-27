# C06c: Skill history and permission changes

- Date: 2026-11-27; follow-up to `2367f4b`, on the existing feature branch and PR #38.
- **New Skill reads obey the tested scope, but native history retains previously admitted text after permissions change. Rebinding that history to a different capability-run scope is not qualified. C06c remains open.**
- No runtime or application behavior changes are introduced by this checkpoint.

## Native history controls

[probe-capability-agent-native-skill-history.mjs](../../scripts/probe-capability-agent-native-skill-history.mjs)
uses the existing Skills candidate and two named permission profiles. The wider profile explicitly
permits a synthetic home Skill; the narrower profile permits only the input workspace plus minimal
runtime reads. Both retain output-only writes, disabled tool network and `never` approvals.

Each history scenario seeds a distinct persisted native thread with an explicitly permitted Skill
body. The harness then removes only that temporary Skill file and checks `ENOENT` before continuing.
Resume/fork additionally stop and restart app-server and verify that the native rollout contains
the body. RPCs identify the native thread by ID; no synthetic history or rollout path is injected.
Subsequent user text does not contain the body marker or select the Skill again.

| Case | Observed body in actual native model input |
| --- | --- |
| Fresh narrow thread, explicit unapproved user Skill | Absent |
| Fresh narrow thread, approved repository Skill | Approved body present; user body absent |
| Four separate wider-profile seed turns | User body present, as permitted |
| Restart and resume with the original wider profile, source removed | User body retained |
| Restart and resume with the narrower profile, source removed | User body retained |
| Restart and fork with the narrower profile, source removed | User body retained |
| Same loaded thread, `turn/start.permissions` narrowed, source removed | User body retained |

All ten turns complete. Each persisted `turn_context` is checked against its exact turn ID:
selected profile, `never` approvals, restricted network, input read/output write grants and the
presence or absence of the explicit user-Skill read grant. Resume preserves the original native
thread ID/path; fork returns a different thread ID. Thus the three narrowed cases are not explained
by an ignored permission request, an accidental fresh thread or a fresh read of the deleted source.
The same-grant control confirms that ordinary continuation retains authorized context.

The probe intentionally exits 1 and records `passed: false` for the three scope assertions.
That is a reproducible unmet capability-run boundary, not a passing isolation test. The static
loopback Responses fixture completes all ten turns with zero fixture errors and zero real model
calls. Preliminary runs are excluded from the reported count.

## Interpretation and implementation consequence

Native Codex conversation history intentionally survives permission changes. A filesystem grant
constrains future reads; it does not erase already admitted messages. In the pinned source,
`Session::record_initial_history` invokes `apply_rollout_reconstruction` for resume/fork, while
turn construction clones retained history into the sampling request. The local Skill accessor
change from the [previous checkpoint](C06c-skills-policy.md) cannot retroactively remove that text.
This is not a claim of a fresh out-of-scope filesystem read or a general defect in normal Codex
conversation continuation.

The existing C06b journal already retains immutable approved intent, captured sources, policy
digest, approval and submission identity. Its controller rejects a changed policy before first
submission and requires reconciliation for a pending submission. The missing C06c native binding
must preserve that contract:

- Reconnect observes the original run and its original approved context. A changed filesystem
  profile does not authorize adopting its transcript as a different approved run.
- Bind the actual native thread/turn/submission to the complete original policy and approved input
  snapshot. Changed or unavailable policy must fail before a new turn; unknown submission outcomes
  still reconcile without silently creating another thread or resubmitting.
- A newly approved intent with different scope must start with only its own approved input, without
  importing the old transcript. Missing or untrusted history provenance is not a valid policy receipt.

These requirements refine the existing immutable-run design; they do not authorize a new history
store or replacement Agent loop. Do not patch this by removing a known Skill marker or individual
prompt block: prior model replies, tool output and compaction may carry derived content. Likewise,
denying every resume would break the accepted same-run reconciliation requirement. Exact native
policy binding and transition refusal remain implementation work, pending the native integration
scope decision in [ADR 0009](../adr/0009-codex-native-policy-extension.md).

## Required-Skill source boundary

Pinned `ScopedSkillsConfig.required` is attached to individual environments (and its type also
describes plugin scope). It is not a general field of the local `SkillsConfig`. The local environment
is constructed with default requirements; `local` is a reserved environment ID. Adding a guessed
`skills.required` property to the local config would not test an enforced requirement.

The actual `validate_required_skills` call runs before model sampling and examines the prepared
catalog: an enabled entry must have the required name and the required environment as its main
prompt or enabled source. Missing extension state also fails validation. The pinned core suite
contains five synthetic environment cases: available, missing, disabled, wrong environment and
failed environment. The negative cases assert no model request and recovery after deselection.
Those provider-backed tests are distinct from app-server local Skill discovery, source reads,
plugin dependency execution and a future Host-required instruction binding.
The fixture explicitly sets `include_instructions: false`; an available entry proves the native
availability gate, not automatic inclusion or execution of its Skill body. Host-required task
instructions still need their own verified delivery and provenance.

### Executed native requirement controls

All five pinned core cases pass with the current experimental native source. Their original
assertions are unchanged: the available source permits one fixture request; each negative case
blocks inference with the source-specific error, then permits a request after deselection. These
are provider-backed core tests, not five app-server or installed Agent acceptance cases.

The [four-line fixture adaptation](C06c-required-skills-fixture.patch) writes `features.hooks=false`
to each test's own temporary home before configuration loading. The existing fixed hooks policy
otherwise rejects the fixture's default configuration before Skill validation. No production guard
or Skill assertion is removed. Exact patch replay against the pinned test source passes.

The first invocation printed five skip notices because it inherited the native harness's network
skip flag; its apparent success is not counted. The next invocation reached the fixed hooks refusal.
After adapting fixture setup, the debug test binary aborted with a thread stack overflow. The final
execution removes only the harness skip flag and sets a 16 MiB test stack, with serial execution:

```sh
env -u CODEX_SANDBOX_NETWORK_DISABLED RUST_MIN_STACK=16777216 \
  /tmp/nooki-c06c-native-prototype/target/debug/deps/all-15b32d3adff49310 \
  required_environment_skill_gates_inference --nocapture --test-threads=1
```

Final result: **5 passed, 0 failed, 0 ignored, no skip notices**, 0.91s. The test executable was built
with `cargo test -p codex-core --test all required_environment_skill_gates_inference --locked -- --nocapture`
and the same compiler/cache/V8 inputs as the previous native checkpoint. Initial test dependency
build took 3m 18s; the fixture-only rebuild took 1m 01s. The existing debug-linker advisory remains.
The normalized Cargo.lock SHA is unchanged:
`11ed3c419dcb08d7d3921f20eb4980c7a0620234c1f7ed79a2d3ca3b98f39a3e`.

- Final native test log: `/tmp/nooki-c06c-native-prototype/required-skills-stack-20261127.log`.
- Earlier skip/setup/stack-failure logs: `required-skills-20261127.log`,
  `required-skills-executed-20261127.log`, `required-skills-final-20261127.log` in the same directory.
- Test executable SHA-256: `f62a523eed6bbea55b6e7f16157edc5512bfde2f50fcf09ee58fae1ee8de9377`.
- Fixture patch SHA-256: `cb21ff4c14d1482249f83a779a7d4b4e5f2c7d40c732278dc1c1ae9f56549de4`.
- Pinned original test SHA-256: `5ab601ca8942e33fd6cf6262076a85479b68e6de71fd6b0bb78e1e12c306104a`.

## Reproduction identity

- Candidate: `/tmp/nooki-c06c-native-prototype/bins/skills-guard/codex-app-server`, version 0.170.0.
- Candidate SHA-256: `5bbb2bf6d063938f0224b35e7fdd9a2b94947e0f9fa6dba5a5a22ec10d802f80`.
- Probe SHA-256: `3034a74c0aa0f64443b879b815136c32f0d7014a8f6007036f3e96f97a78bf6a`.
- Receipt: `/private/tmp/nooki-profile-UzHaIK/skill-history-probe.json`.
- Log: `/tmp/nooki-c06c-native-prototype/skill-history-final-20261127.log`.
- Native source/build inputs and complete six-file patch remain those of [C06c-skills-policy](C06c-skills-policy.md).

## Delivery checks

The aggregate `/tmp/nooki-c06c-native-prototype/skill-history-result-20261127.json` separates the
three failing history-scope assertions from the five passing native requirement cases. Probe
syntax, 170 local documentation links, fixture patch replay and diff checks pass. No broader
application or prior native regression suite is claimed rerun for this diagnostic/tooling change.
Desktop rebuild (native release: 36.61s), installation and strict deep signature verification pass.
Installed Nooki remains 0.12.0, executable SHA-256
`9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-history-desktop-build.log` and
`/tmp/nooki-c06c-history-desktop-install.log`. No experimental Codex binary was installed.
