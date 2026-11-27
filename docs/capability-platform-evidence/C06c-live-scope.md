# C06c: Immutable scope during a loaded native session

- Date: 2026-11-27; follow-up to `0ba7488`, on the existing feature branch and PR #38.
- **Five tested live scope changes are now refused before model dispatch, while unchanged scope and continuation after refusal remain usable. Cold resume/fork binding is still open; C06c is not complete.**
- The change exists only in a disposable native qualification binary. No modified Codex component is integrated or distributed with Nooki.

## Native enforcement point

The [history checkpoint](C06c-skill-history.md) showed that permission changes do not remove text
already admitted to a native conversation. Its live case can be constrained without modifying
history: validate the proposed scope before committing session settings.

The candidate adds a fixed check at the end of `SessionConfiguration::apply`, after native settings
normalization and before returning the proposed configuration. It compares the concrete permission
snapshot (including profile identity and declared roots), runtime workspace roots, fallback cwd,
selected environment values, approval policy/reviewer and Windows sandbox level. Any difference
returns native `ConstraintError::InvalidValue` containing `NOOKI_PROTOTYPE_SCOPE_IMMUTABLE`.
This compares resolved values, not just a profile name.

`Session::update_settings` applies that validation before assigning shared session configuration,
updating environment defaults or marking MCP inputs dirty. Existing validation and managed
restrictions still run; no caller-supplied bypass or ordinary configuration switch disables the
fixed check. The tested app-server calls return `-32600` with the fixed marker.

This is a permission/environment scope check, not the complete approved-run policy. It does not
bind the native thread to C06b's approval, input snapshot or submission identity, and does not freeze
every instruction, model or effect contributor. Neither the comparison nor these local controls
prove that every preparatory remote/environment operation occurs after this guard.

## Matched controls and retained state

[probe-capability-agent-native-live-scope.mjs](../../scripts/probe-capability-agent-native-live-scope.mjs)
uses synthetic local profiles and a static loopback Responses fixture. Every scenario creates a
distinct persisted native thread, completes a permitted Skill seed turn, explicitly reselects the
unchanged profile and completes another turn. It then attempts one change:

| Attempt | Previous Skills candidate | Live-scope candidate |
| --- | --- | --- |
| Narrow permissions in `turn/start` | Applied; model request sent | Fixed refusal; zero additional model requests |
| Narrow permissions in `thread/settings/update` | Applied; subsequent turn uses narrower scope | Fixed refusal; zero additional model requests |
| Expand permissions in `thread/settings/update` | Applied; subsequent turn uses wider scope | Fixed refusal; zero additional model requests |
| Change cwd inside the synthetic input workspace | Applied; model request sent | Fixed refusal; zero additional model requests |
| Edit a named profile's synthetic filesystem grants and select the same name | Changed grants applied under the same ID | Fixed refusal; zero additional model requests |

The last case changes only the probe's temporary config file. It demonstrates that comparing names
would miss a real scope change. The harness reads each native `turn_context` by exact turn ID and
checks selected profile, cwd, approval policy, network restriction and grants. It additionally
compares the complete native permission profile, active profile, cwd, approval policy and reviewer
against the seed snapshot. Unchanged selection must match exactly. Each accepted old-build attempt
must actually differ; a no-op cannot count as a reproduced gap.

After each attempt, the harness sends an ordinary continuation with **no permission or cwd reset**.
For the candidate, its complete captured scope must still match the original. Previously approved
Skill body markers must also remain in model input. This proves that refusal neither partially
commits the proposed scope nor drops the task's approved instructions. The same-name file change
remains on disk during this continuation; the test does not restore it until afterward. This is a
local explicit-profile update test, not proof about managed-policy refresh or revocation.

The old binary completes 20 turns and deliberately exits 1 on five failed refusal assertions.
The candidate completes 15 turns and refuses five requests with zero additional model calls,
exiting 0 with no mismatches. All retained-state comparisons pass.

## Identity and regression

| Item | SHA-256 |
| --- | --- |
| Previous Skills candidate | `5bbb2bf6d063938f0224b35e7fdd9a2b94947e0f9fa6dba5a5a22ec10d802f80` |
| Live-scope candidate | `e947b8aac85b9b343d172be55facd4420a88662ac1140075f1397e5aceff93f1` |
| Probe | `8ebb7fb27e3485e0cf9ed4abfade94b8db1333ce0a28aaaa36ed8d50e5afe4c4` |
| Complete native patch | `fd9cfacbee8fb087824e017279e55e3611bdc48247b0beac70b3ad9169b02ed0` |

[C06c-native-live-scope.patch](C06c-native-live-scope.patch) is the complete six-file runtime delta,
including earlier restrictions. Exact replay against the pinned originals passes with `patch -p1`
or `git apply --unidiff-zero`. The native build completed in 1m 32s; source/archive, normalized lock,
compiler and dependency inputs remain those recorded in the [startup checkpoint](C06c-startup-policy.md).
Existing unused-helper and debug-linker advisories remain. The binary is kept at
`/tmp/nooki-c06c-native-prototype/bins/live-scope-guard/codex-app-server`.

The candidate passes all 15 startup cases and the existing ordinary persisted-resume, hooks,
connector control-plane, scoped dynamic-admission and fresh Skill authority probes. The final set
comprises **58 completed synthetic turns**, including old-build controls and preparation. Fixture
errors and real model calls are zero. Preliminary runs are excluded from that total.

| Run | Local receipt |
| --- | --- |
| Expected-failure live-scope control | `/private/tmp/nooki-profile-9bWQBK/live-scope-probe.json` |
| Live-scope candidate | `/private/tmp/nooki-profile-Lp7wTl/live-scope-probe.json` |
| Startup | `/private/tmp/nooki-profile-K4PGOL/startup-probe.json` |
| Ordinary resume | `/private/tmp/nooki-profile-15pa3i/resume-probe.json` |
| Hooks | `/private/tmp/nooki-profile-0WzcVj/hooks-guard-probe.json` |
| Control plane | `/private/tmp/nooki-profile-j6V3cs/control-plane-probe.json` |
| Scoped dynamic admission | `/private/tmp/nooki-profile-q1j3lY/dynamic-policy-probe.json` |
| Fresh Skill authority | `/private/tmp/nooki-profile-CR8VEN/skills-policy-probe.json` |

`/tmp/nooki-c06c-native-prototype/live-scope-result-20261127.json` records the final receipts,
counts and patch/probe identities. Build and fixture logs are `live-scope-*-20261127.log` in that
directory. Earlier native required-environment tests are not claimed rerun on this candidate:
they attach/deselect environments after thread creation, which conflicts with a fixed initial
scope. Preserving required-source validation with all approved environments selected at creation
needs separate qualification; the native requirement validator itself is unchanged.

## Remaining work

Cold resume/fork constructs a new session and still needs durable binding to the original approved
run. No persistence field or cross-process permission seal is added here. A raw saved effective
profile contains process-specific helper-directory grants; comparing it naively would reject valid
restarts. Profile names alone are also insufficient. A native binding must distinguish trusted
runtime allowances from the approved semantic scope, and fail on missing or untrusted provenance
without breaking same-run reconciliation. The ordinary resume regression is not evidence that
changed-scope cold history is refused.

Initial Host policy binding, remote environments, approval/OS-specific transitions, managed/cloud
refresh, other effect contributors and installed real-Agent acceptance remain unfinished. The
Codex-first order and pending [native integration/distribution decision](../adr/0009-codex-native-policy-extension.md)
are unchanged. No full C06 acceptance item is closed by this experiment.

## Delivery checks

Probe syntax, 177 local documentation links, exact six-file patch replay and diff checks pass.
Native fixture processes were confirmed stopped. Application regression suites were not rerun
for this qualification-tooling/documentation-only change. Desktop build (native release: 30.57s),
installation and strict deep codesign verification pass. Installed Nooki remains 0.12.0 with
executable SHA-256 `9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-live-scope-desktop-build.log` and
`/tmp/nooki-c06c-live-scope-desktop-install.log`. The existing frontend chunk-size advisory remains.
No experimental Codex executable was installed into Nooki or the user's CLI.
