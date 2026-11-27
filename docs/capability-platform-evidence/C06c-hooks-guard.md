# C06c: Disposable native hooks and notify refusal

- Date: 2026-11-27; follow-up to `733d5cd` on the existing feature branch and PR #38.
- **The scoped native refusal checks pass; complete policy qualification and C06c remain open.**
- No Nooki runtime/dependency change or installation of a modified Codex component.

## Native change and reproducibility

The [configuration characterization](C06c-hooks.md) established that ordinary feature flags are
mutable. This experiment adds a fixed refusal after native managed-feature resolution in
`Config::load_config_with_layer_stack`. It rejects an enabled `Feature::CodexHooks` or an executable
legacy `notify` command. It preserves managed resolution rather than overriding its result, and
ordinary configuration cannot switch off the compiled check. No Host policy receipt or public
launch interface is implemented by this fixed experiment.

The committed [experimental patch](C06c-native-mcp-hooks.patch) applies to official source
`29eb79e9866b3262a777fdf8195c1b9e63684c91` (0.170.0). It contains the previous eight-line configured-MCP
guard and twelve additional lines for hooks/notify. Reapplying it to the saved original reproduces
the temporary source exactly. Build settings and the verified workspace-only lock normalization
match [the prior native builds](C06c-native-prototype.md); external dependency pins remain unchanged.
The final `--locked` build passes, retaining the known linker unwind-table warning. The patch is a
qualification fixture, not a product dependency, supported distribution or adopted native component.

An intermediate build rejected hooks but still executed legacy `notify` with hooks disabled.
Native [hook registration](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/hooks/src/registry.rs)
and [notify execution](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/hooks/src/legacy_notify.rs)
confirm these are independent mechanisms. The final check covers both; the notify criterion
matches the native nonempty executable check.

| Artifact | SHA-256 |
| --- | --- |
| Unmodified trust/execution control | `bf0955ee1ea3248ffc6ab7acf2dd1c54747cd3fc1c48b60b547301372eb54f3f` |
| Previous MCP-only control | `5480e2397fb11b3661feb34a761c41bda1b4371a6a562d17e8f7e6d071e10016` |
| Final MCP/hooks/notify candidate | `9c7752fe3112e9854f540646089707bfce9c999e36342e228542fc828b7e37ef` |
| Committed experimental patch | `652ea425a0ec7444ce58fc22a0673be32127258ab1c04a24b8a5855a3b4bd574` |

## Matched native verification

Run [probe-capability-agent-native-hooks-guard.mjs](../../scripts/probe-capability-agent-native-hooks-guard.mjs):

```sh
node scripts/probe-capability-agent-native-hooks-guard.mjs /path/to/candidate /path/to/unmodified-control
```

Each invocation first runs the existing five-turn characterization against the unmodified control
in a fresh synthetic profile. This uses the normal native trust/hash approval flow and actually
executes the unique `SessionStart` hook twice. The candidate then reuses the same hook path, contents
and persisted trust state. It changes the fixture's ephemeral loopback URL and starts with hooks
disabled in the config file. No dangerous trust bypass, personal credential or real model is used.

| Check | MCP-only control | Final candidate |
| --- | --- | --- |
| Disabled configuration; ordinary turn | Completes | Completes |
| Thread explicitly enables hooks | Hook and local-model turn execute | Refused before either |
| Whole feature table with hooks disabled in the file | Completes without hook execution | Same positive control passes |
| Whole feature table after file enables hooks | Hook and local-model turn execute | Refused before either |
| Retained thread's `mcpServerStatus/list` after file change | Refresh accepted | Refused at configuration rebuild |
| New thread after file change | Hook and local-model turn execute | Refused before either |
| Legacy notify while hooks remain disabled | Local-model turn and notify command execute | Refused before either |
| Enabled configured MCP | Existing MCP guard refuses | Same refusal retained |
| Disable again and retry | Completes | Completes |
| Strict bootstrap with hooks enabled / with legacy notify | Not reached after expected assertion failure | Both exit 1, no signal, explicit policy error |

All five hook/notify request refusals report `NOOKI_PROTOTYPE_HOOKS_DENIED`, zero additional fixture
requests and zero new hook/notify markers. Native thread/turn identities and exact synthetic output
are checked for successful turns. The probe waits five seconds after recovery and verifies marker
state again, then checks both strict-startup denials. The MCP regression verifies refusal and no
model request; its command is `/usr/bin/true`, so this case makes no new MCP-process marker claim.

The two final invocations use 20 synthetic turns total: five preparation turns each, seven candidate
turns for the MCP-only failure control and three for the final guard. Both report no fixture errors.
The failure control exits 1 at the expected hook-refusal assertion; the final candidate exits 0.

Whole-table behavior depends on the source layer: the preceding checkpoint showed loss of a CLI
disable, while this checkpoint proves inheritance of a file disable and refusal once the effective
file setting enables hooks. Table replacement alone is not treated as proof of execution.

## Evidence and remaining scope

- MCP-only failure control: `/private/tmp/nooki-profile-a4WxfZ/hooks-guard-probe.json`.
- Final candidate: `/private/tmp/nooki-profile-pEpY8H/hooks-guard-probe.json`.
- Each profile retains its unmodified preparation receipt, native notifications, stderr and markers.
- Under `/tmp/nooki-c06c-native-prototype/`: `hooks-guard-matched-result-20261127.json`,
  `mcp-hooks-build-identity-20261127.json`, `mcp-hooks-notify-build-20261127.log`, and
  `final-hooks-guard-{control|candidate}-20261127.log` record final identities and results.
- The candidate is retained at `bins/mcp-hooks-guard/codex-app-server` in that temporary directory.

`hooksConfinementCertified` and `productionPolicyCertified` remain false. This evidence covers the
listed user-hook/notify paths under strict startup, not managed/plugin hooks, other hook events,
retained-session resume, non-strict recovery, cloud refresh, Skills, credential helpers, OAuth or
all effect-producing tools. Placement after managed resolution is a source fact, not managed-policy
runtime acceptance. The Host-approved policy binding and native receipt remain to be implemented.
Formal integration/distribution still requires the pending [ADR 0009 scope decision](../adr/0009-codex-native-policy-extension.md).

## Delivery validation

Both final probe outcomes, probe syntax, exact patch reapplication, 115 local documentation links
and `git diff --check` pass. A process check found no remaining probe/native test processes.
Application regression suites were not rerun for qualification tooling/documentation only.

Desktop build/install and strict deep codesign verification pass. Installed Nooki remains 0.12.0
with executable SHA-256 `9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-hooks-guard-desktop-build.log` and
`/tmp/nooki-c06c-hooks-guard-desktop-install.log`. The installer handed off existing task workers;
existing build advisories and unrelated UI acceptance gaps remain unchanged.
