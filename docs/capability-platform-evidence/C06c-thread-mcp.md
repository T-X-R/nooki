# C06c: Native thread MCP exclusion and global inventory gap

- Date: 2026-11-27; follow-up to `ce57d28`, on the existing feature branch and PR #38.
- **The tested thread paths exclude plugin MCP. Threadless inventory still starts it. C06c remains open.**
- Only a disposable Codex qualification binary changes; no Nooki runtime integration or distribution approval is implied.

## Native boundary and executable identity

The pinned 0.170.0 source already provides `McpServersDisabled`. Core's MCP projection checks this
thread initialization marker before gathering plugin, selected-root or extension contributions,
returns an empty catalog and disables Apps. The selected-environment projection also checks the
marker before remote MCP discovery. These are source properties, not runtime certification of all
those contribution types.

This candidate adds the marker unconditionally at the beginning of native `Session::new`, before
the initialization data is copied into the session's MCP services. Ordinary request configuration
cannot remove that insertion. The experiment reuses the existing native exclusion mechanism;
it does not widen the asynchronous MCP publication API or convert successful plugin installation
into a policy error. It retains the prior configured-MCP/hooks/startup refusal checks.

| Build | SHA-256 |
| --- | --- |
| Previous startup-policy candidate, failure control | `d62f754a79898f68c19d1e486c24b40f234861487444eef9c551e2df5d86e934` |
| Thread-MCP candidate | `499f293b6eee9acf520886dd0a927c6e45f5d7f0dd45c199b359f83c5ec5264a` |

The complete three-file source delta is [C06c-native-thread-mcp.patch](C06c-native-thread-mcp.patch),
SHA-256 `309045567daa173a86337540834638beba7bedacd50b31398c4173e8ac862cb1`.
Apply it to the same pinned source as the [startup checkpoint](C06c-startup-policy.md), using
`patch -p1` or `git apply --unidiff-zero`. Exact replay against all three original files was checked.
The source/archive pin, normalized lockfile, toolchain and dependency inputs remain those of that
checkpoint. The cached native build completed in 1m 42s; the existing oversized `__eh_frame`
development-linker advisory remains. This is not a production artifact or release-size measurement.

## Installed-plugin and refresh checks

The [plugin probe](../../scripts/probe-capability-agent-native-plugin-policy.mjs) retains its default
`observe` characterization mode and adds an explicit `exclude` mode:

```sh
node scripts/probe-capability-agent-native-plugin-policy.mjs /path/to/codex-app-server true loaded exclude
node scripts/probe-capability-agent-native-plugin-policy.mjs /path/to/codex-app-server true fresh exclude
node scripts/probe-capability-agent-native-plugin-policy.mjs /path/to/codex-app-server false loaded exclude
```

Each invocation uses a new synthetic profile, a local marketplace/plugin, an executable stdio
canary and native Codex transport to the existing static loopback Responses fixture. No personal
configuration, credentials, real model service or Nooki capability installation is involved.

| Case | Previous candidate, enabled/loaded | Thread-MCP candidate |
| --- | --- | --- |
| Install while a clean thread is idle | Canary starts | No canary |
| Continue that same thread after refresh | Completes, but canary is present | Completes without canary |
| Start another thread with installed plugin | Completes, but canary is present | Completes without canary |
| Query MCP inventory with that thread ID | Returns `canary` | Empty inventory; no canary |

The old build fails the five explicit exclusion assertions, while still completing three synthetic
turns. The candidate passes enabled/loaded, enabled/fresh and disabled/loaded cases, completing
three, one and three turns respectively. Installation remains successful; this proves exclusion
for those thread paths, not rejection of the plugin itself. The post-install observation waits one
second and the new-thread observation waits five seconds. Continued native turn completion and the
old-build canary are positive controls against an inert or failed session.

## A separate global path remains open

Only after the scoped assertions pass, the probe calls `mcpServerStatus/list` **without** a thread
ID. In both enabled candidate cases this returns `canary` and starts the synthetic process. The
disabled-plugin comparison returns an empty list and does not start it. Inventory issues no model
request. Global observations are recorded separately; `passed` and
`scopedThreadMcpExclusionVerified` do not certify process-wide confinement.

The native `mcp_processor.rs` implementation explains the difference: a thread-scoped request uses
the thread's runtime projection, while the global request uses `McpManager::runtime_config` without
thread initialization data, then performs status discovery. This demonstrates an actual effect
outside the marker's scope, rather than merely a non-empty configuration response.

Source review also finds plugin-install OAuth discovery outside the thread projection. It is not
exercised by this stdio fixture. Selected-root, extension, Apps, remote-environment and OAuth effects,
managed requirements that mandate a connector, stale-config fallback, and credential helpers still
need qualification. Incompatible managed requirements must be explicitly refused; an empty catalog
alone must not be treated as proof that they were preserved. No generic refresh-error propagation,
running-connection revocation or complete policy claim follows from this experiment.

The next native step is to enforce the fixed policy on threadless discovery/control-plane effects
as well as thread materialization. Restricting which RPCs the Host normally sends is insufficient
evidence by itself. The [ADR 0009 integration/distribution decision](../adr/0009-codex-native-policy-extension.md)
remains pending; its acceptance bar and Codex-first order are unchanged.

## Regression and receipts

The new candidate also passes all 15 startup cases, the two-turn persisted resume/refusal/recovery
probe, and the hooks/notify regression with three candidate turns plus five native trust-preparation
control turns. The final recorded set totals **20 synthetic turns**, including the three-turn
expected-failure plugin control; fixture errors and real model calls are zero.

| Run | Receipt |
| --- | --- |
| Expected-failure control | `/private/tmp/nooki-profile-wCkq4m/plugin-probe.json` |
| Candidate enabled/loaded | `/private/tmp/nooki-profile-V3RnsC/plugin-probe.json` |
| Candidate enabled/fresh | `/private/tmp/nooki-profile-sAPpNz/plugin-probe.json` |
| Candidate disabled/loaded | `/private/tmp/nooki-profile-mUhsYX/plugin-probe.json` |
| Startup regression | `/private/tmp/nooki-profile-2qwaer/startup-probe.json` |
| Persisted resume regression | `/private/tmp/nooki-profile-onTDeT/resume-probe.json` |
| Hooks regression | `/private/tmp/nooki-profile-m5Jpez/hooks-guard-probe.json` |

`/tmp/nooki-c06c-native-prototype/thread-mcp-matched-result-20261127.json` records these results,
probe/patch hashes and binary identities. Logs are `thread-mcp-*-20261127.log` in that directory.
Preliminary red runs are excluded from the final-set total. The native executable remains under
`/tmp/nooki-c06c-native-prototype/bins/thread-mcp-guard/`, not in Nooki or the installed user CLI.

Probe syntax, 142 local documentation links, patch replay and `git diff --check` pass. Native probe,
app-server and canary processes were confirmed stopped. Application regression suites were not
rerun for qualification-tooling/documentation-only changes. Desktop build/install and strict deep
codesign verification pass; installed Nooki remains 0.12.0 with executable SHA-256
`9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-thread-mcp-desktop-build.log` and
`/tmp/nooki-c06c-thread-mcp-desktop-install.log`. Existing task workers were handed off by the installer.
