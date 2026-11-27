# C06c: Persisted resume and plugin MCP boundaries

- Date: 2026-11-27; follow-up to `a3e2bc0`, on the existing feature branch and PR #38.
- **Scoped persisted-resume checks pass. Plugin MCP still escapes the current configured-server guard. C06c remains open.**
- No native source/runtime change or modified Codex installation in this checkpoint.

## Executables and fixture

Both probes reuse identified 0.170.0 builds from the [startup-policy checkpoint](C06c-startup-policy.md):

| Executable | SHA-256 |
| --- | --- |
| Unmodified control | `bf0955ee1ea3248ffc6ab7acf2dd1c54747cd3fc1c48b60b547301372eb54f3f` |
| Startup-policy candidate | `d62f754a79898f68c19d1e486c24b40f234861487444eef9c551e2df5d86e934` |

Every invocation creates an isolated synthetic profile. Native Codex transport calls a loopback-only
static Responses fixture, with no credentials or real model service. A synthetic stdio MCP writes
a marker inside its profile and implements only initialization and an empty tool list. Successful
turns must emit the exact static assistant response with matching native thread/turn identities.

## Persisted resume

[probe-capability-agent-native-resume-policy.mjs](../../scripts/probe-capability-agent-native-resume-policy.mjs)
creates a non-ephemeral native thread and completes an original turn. It stops app-server and checks
that the actual native rollout file contains the original input and output. Each subsequent case
starts a fresh app-server process; `thread/resume` uses the original thread ID, not injected history
or a fabricated rollout. The local response fixture remains alive across those process restarts.

```sh
node scripts/probe-capability-agent-native-resume-policy.mjs /path/to/codex-app-server
```

| Resume case | Unmodified control | Startup-policy candidate |
| --- | --- | --- |
| MCP server supplied in resume overrides | Accepts; canary starts and another local turn completes | Typed MCP refusal; no extra request or canary |
| File gains MCP after `config/read` | Accepts; canary starts and another local turn completes | Same refusal before dispatch |
| Resume override enables hooks | Accepts and completes a local turn | Typed hooks refusal before dispatch |
| Clean recovery after those attempts | Same thread resumes and completes a turn | Same thread resumes and completes a turn |

The hook case qualifies refusal of an enabled setting; it does not execute a trusted resume-event
hook. MCP observations wait one second per case, with successful canary controls. The candidate
also checks final canary absence. Successful recovery returns the original rollout path and native
thread ID, preserves the fixture provider/read-only/never settings, and appends the new turn to the
same file while retaining the original. Resume itself must issue no model request, and the total
request count must equal the explicitly completed turns.

The unmodified control completes five turns and exits 1 at the expected refusal assertion. The
candidate completes two turns and exits 0. This is native persistence/restart evidence; it does not
certify the Host journal's lost-reply reconciliation, cancellation, concurrent events or exactly-once
submission, nor every retained-session/managed-refresh path.

## Plugin MCP characterization

[probe-capability-agent-native-plugin-policy.mjs](../../scripts/probe-capability-agent-native-plugin-policy.mjs)
creates a local synthetic marketplace and plugin with a single `.mcp.json` canary. Installation uses
native `plugin/install` in that test profile. It neither installs a Nooki capability package nor
touches the user's Codex configuration. The package has no OAuth service, account or real connector.

```sh
node scripts/probe-capability-agent-native-plugin-policy.mjs /path/to/codex-app-server true loaded
node scripts/probe-capability-agent-native-plugin-policy.mjs /path/to/codex-app-server false loaded
node scripts/probe-capability-agent-native-plugin-policy.mjs /path/to/codex-app-server true fresh
```

Both binaries produce the same observations:

| Native plugin feature / state before installation | Canary after install, before another thread/turn | Canary after subsequent thread and turn |
| --- | --- | --- |
| Enabled; an idle thread is already loaded | Present | Present |
| Disabled; an idle thread is already loaded | Absent | Absent |
| Enabled; no thread has been created | Absent | Present |

The post-install observation waits one second; the final observation waits five seconds. With an
idle loaded thread, no new turn request is needed to reproduce the process launch after installation.
The fresh case distinguishes that refresh path from installation with no thread. Merely inspecting
new-thread creation would miss the earlier loaded-thread effect. Feature disable is a positive
comparison control, not an immutable policy claim or a test of revoking a running connection.

All six characterization invocations exit 0: `passed` means their expected observations match,
including the reproduced gap. `pluginConfinementCertified` and `productionPolicyCertified` remain
false. Each binary completes five fixture turns across its three cases; together with resume,
the final checkpoint contains 17 synthetic turns, with no fixture errors or real model calls.

## Native boundary to implement next

The pinned source's [configuration-to-MCP conversion](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/core/src/config/mod.rs)
adds installed/plugin registrations after the `ConfigToml.mcp_servers` check. The
[runtime MCP projection](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/core/src/mcp.rs)
can add selected-plugin registrations, extension contributions and compatibility servers later still.
The [plugin installer](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/app-server/src/request_processors/plugins.rs)
reloads loaded threads and invalidates MCP runtimes after installation; it also contains an old-config
fallback when post-install configuration loading fails. These source paths explain why another
check of only the initial configuration would not establish complete enforcement.

The next native experiment must validate the resolved MCP catalog before connection creation and
refresh, propagate typed policy refusals through plugin-triggered reloads, and prove they cannot
fall back to stale accepted configuration. Tests must include the already-loaded-thread case above,
clean/disabled controls and recovery. Selected-plugin/extension/OAuth paths require their own runtime
evidence; the source observations do not certify them. Formal integration/distribution remains
subject to the pending [ADR 0009 scope decision](../adr/0009-codex-native-policy-extension.md).

## Receipts and delivery

- Resume control: `/private/tmp/nooki-profile-TJIvuv/resume-probe.json`.
- Resume candidate: `/private/tmp/nooki-profile-gzCwMf/resume-probe.json`.
- Plugin control, enabled/loaded: `/private/tmp/nooki-profile-MPF2Tl/plugin-probe.json`.
- Plugin control, disabled/loaded: `/private/tmp/nooki-profile-92MB29/plugin-probe.json`.
- Plugin control, enabled/fresh: `/private/tmp/nooki-profile-YoSz81/plugin-probe.json`.
- Plugin candidate, enabled/loaded: `/private/tmp/nooki-profile-FXFgta/plugin-probe.json`.
- Plugin candidate, disabled/loaded: `/private/tmp/nooki-profile-idN5Ba/plugin-probe.json`.
- Plugin candidate, enabled/fresh: `/private/tmp/nooki-profile-HfzzTz/plugin-probe.json`.
- `/tmp/nooki-c06c-native-prototype/resume-plugin-matched-result-20261127.json` records all receipts,
  probe hashes and executable identities. Corresponding logs are `final-resume-*-20261127.log`
  and `final-plugin-*-20261127.log` in that directory.

Final native observations, probe syntax, 120 local documentation links and `git diff --check` pass.
No probe, app-server or synthetic canary processes remained. Application regression suites were
not rerun for test-tooling/documentation-only changes; no complete policy or production dispatch
is claimed.

Desktop build/install and strict deep codesign verification pass. Installed Nooki remains 0.12.0
with executable SHA-256 `9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-resume-plugin-desktop-build.log` and
`/tmp/nooki-c06c-resume-plugin-desktop-install.log`. Existing task workers were handed off by the
installer. Existing build advisories and unrelated UI acceptance gaps remain unchanged.
