# C06c: Native hooks configuration boundary

- Date: 2026-11-27; follow-up to `e625724`, on the existing feature branch and PR #38.
- **The hooks isolation gap is reproduced. C06c and ADR 0009 gate 2 remain open.**
- No application runtime change, native component adoption, personal data or real model service.

Follow-up: the [fixed native refusal experiment](C06c-hooks-guard.md) passes scoped hook/notify
denials in a new temporary binary. The original matched results below remain valid for their
identified executables; complete hooks/production policy qualification remains open.

## Setup and validity controls

The probe is [probe-capability-agent-native-hooks-policy.mjs](../../scripts/probe-capability-agent-native-hooks-policy.mjs):

```sh
node scripts/probe-capability-agent-native-hooks-policy.mjs /absolute/path/to/codex-app-server true
node scripts/probe-capability-agent-native-hooks-policy.mjs /absolute/path/to/codex-app-server false
```

The last argument sets the app-server bootstrap `features.hooks` value. Each invocation uses a
fresh synthetic home, strict startup, and the same static local Responses fixture as the
[model checkpoint](C06c-model-fixture.md). The existing matched 0.170.0 binaries are reused:

| Executable | SHA-256 |
| --- | --- |
| Unmodified control | `bf0955ee1ea3248ffc6ab7acf2dd1c54747cd3fc1c48b60b547301372eb54f3f` |
| Configured-MCP guard | `5480e2397fb11b3661feb34a761c41bda1b4371a6a562d17e8f7e6d071e10016` |

The only hook is a synchronous `SessionStart` command in the synthetic home's `hooks.json`. It
reads its event payload and appends event/session identities to a marker inside the test profile,
outside the thread's input directory. It performs no network operation or application mutation.
Native thread responses must confirm the fixture provider, `mock-model`, `readOnly` sandbox and
`never` approval policy. Each measured turn must complete with the exact static assistant output,
one local request and matching thread/turn identities.

The probe uses the native hook trust flow: list the single untrusted hook, approve its exact
`currentHash` through `config/batchWrite` at `hooks.state`, then confirm `trusted`, unchanged hash
and enabled status. It does not use the dangerous trust bypass. A preparation thread explicitly
enables hooks so they can be listed even when bootstrap disables them; it runs no turn, and the
probe verifies that no marker exists after trust preparation.

The source explains why a thread-start-only absence check would be invalid:
[pending SessionStart execution](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/core/src/hook_runtime.rs)
occurs at turn start. The normal trust update follows the native
[hooks list tests](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/app-server/tests/suite/v2/hooks_list.rs).
Initial fixture attempts stopped before valid measurement because bootstrap-disabled `hooks/list`
returned no hooks; those failures are not interpreted as isolation evidence.

## Observed results

Both binaries produced the same results. Counts below are hook executions during one successfully
completed synthetic turn, checked against that turn's thread identity.

| Thread configuration | Bootstrap enabled | Bootstrap disabled |
| --- | --- | --- |
| Only unrelated dotted feature keys; inherit hooks | 1 | 0 |
| Explicit dotted `features.hooks=false` | 0 | 0 |
| Explicit dotted `features.hooks=true` | 1 | 1 |
| Replace the whole `features` table, omitting hooks | 1 | 1 |
| Explicitly disable again after positive controls | 0 | 0 |

Four final invocations completed five turns each: 20 synthetic turns total, no fixture request
errors and no real model calls. Positive hook execution is verified alongside both disabling and
re-enabling controls. The `passed` receipt field means the characterization assertions matched;
`hooksConfinementCertified` and `productionPolicyCertified` both remain false.

The distinction between dotted feature keys and a whole-table override matters. In this pinned
runtime, the latter loses the bootstrap hooks disable even though the request never explicitly
asks to enable hooks. The former preserves inheritance, but an explicit thread override still
re-enables execution. These ordinary configuration controls therefore do not constitute an
immutable Host policy. This is a capability-isolation requirement gap, not a claim that ordinary
Codex configuration overrides violate their intended semantics.

The configured-MCP guard has no hook enforcement. A read-only thread sandbox also does not by
itself suppress this trusted native hook. The evidence does not establish arbitrary filesystem
access, managed-hook behavior or every hook event: only the synthetic marker and SessionStart
path above were exercised.

## Receipts and next boundary

- Control, bootstrap enabled: `/private/tmp/nooki-profile-dwbvJa/hooks-probe.json`.
- Control, bootstrap disabled: `/private/tmp/nooki-profile-k5t9Mb/hooks-probe.json`.
- Guard, bootstrap enabled: `/private/tmp/nooki-profile-bAbBWE/hooks-probe.json`.
- Guard, bootstrap disabled: `/private/tmp/nooki-profile-cBwQ3j/hooks-probe.json`.
- Each profile retains native notifications, stderr and the synthetic marker.
- `/tmp/nooki-c06c-native-prototype/hooks-matched-result-20261127.json` records binary/probe hashes
  and all four receipts. Matching logs are `final-hooks-{baseline|guard}-{true|false}-20261127.log`
  in that directory. Temporary receipt files are local evidence, not durable distributed artifacts.

[ADR 0009 gate 2](../adr/0009-codex-native-policy-extension.md) needs a native enforcement boundary
that ordinary thread configuration and reload cannot replace. Further qualification must cover
managed/plugin hooks, other events, retained-session refresh/resume and failure/recovery paths;
the generic feature toggle must not be used as a policy receipt. No full-policy acceptance item
is closed here. Formal native integration/distribution still requires the pending scope decision.

## Delivery validation

Probe syntax, all four final native characterization runs, 107 local documentation links and
`git diff --check` pass. A process check found no remaining probe/native test process. Application
regression suites were not rerun for this test-tooling/documentation-only increment.

Desktop build/install and strict deep codesign verification pass. Installed Nooki remains 0.12.0
with executable SHA-256 `9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-hooks-desktop-build.log` and
`/tmp/nooki-c06c-hooks-desktop-install.log`. The installer handed off the existing task workers.
Existing build advisories and unrelated UI acceptance gaps remain unchanged.
