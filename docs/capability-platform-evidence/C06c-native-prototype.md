# C06c: Native configuration materialization review

- Date: 2026-11-26; follow-up to `8fa7c79`, on the existing feature branch and PR #38.
- **C06c and the native prototype gate remain incomplete.** Codex remains the first adapter.
- No Nooki runtime/dependency change, native component adoption, real credentials or model calls.

## Confirmed source findings

Official Codex 0.170.0 source is pinned to
`29eb79e9866b3262a777fdf8195c1b9e63684c91`.

1. The optional builder validation callback is not a universal policy boundary.
   [`Config::rebuild_with_session_layers`](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/core/src/config/mod.rs#L2074)
   calls `load_config_with_layer_stack` directly, bypassing `ConfigBuilder::build_with_validation`.
   The app-server uses this path for session configuration refresh and retained sessions.
2. Materialization alone does not freeze all MCP registrations.
   [`to_mcp_config_with_loaded_plugins`](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/core/src/config/mod.rs#L1922)
   also registers plugin-provided and additional servers. A guard on `ConfigToml.mcp_servers`
   covers only configured servers, not the complete native MCP catalog.
3. Policy rejection must not become ordinary configuration recovery.
   [`load_startup_config`](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/app-server/src/config_manager.rs#L442)
   can recover with defaults in non-strict mode. The experiment fixes strict startup; complete
   qualification must prove no recovery path discards the policy.

These findings refine [ADR 0009](../adr/0009-codex-native-policy-extension.md). They do not prove
that a complete small native extension is feasible.

## Native regression result

A disposable probe used the installed official 0.170.0 CLI, a fresh synthetic home, strict startup,
read-only threads, `never` approval policy and a local Python MCP canary. No model turn was sent.

| Check | Observed result |
| --- | --- |
| Clean configuration positive control | Thread creation succeeded with the expected sandbox and approval policy. |
| Add an enabled MCP after `config/read`, then call `thread/start` | No policy rejection; the canary process started. |
| Call `mcpServerStatus/list` for the earlier clean thread after the addition | No policy rejection. Source confirms this request exercises direct session configuration rebuilding. |

The refusal assertions intentionally failed against the official CLI. This reproduces the missing
boundary; it is not a passing policy test. Receipt:
`/private/tmp/nooki-profile-9jzHOJ/prototype-probe.json`.
Log: `/tmp/nooki-c06c-native-prototype/red-probe.log`.

## Disposable build attempt and limits

The full pinned source was extracted under `/tmp/nooki-c06c-native-prototype/`.
An eight-line experimental guard was added only to that temporary source's common materialization
function, rejecting any enabled configured MCP with `NOOKI_PROTOTYPE_MCP_DENIED`.
The probe also specifies post-rejection recovery and strict bootstrap checks, but these checks
have **not** run against an experimental executable.

The native build did not reach compilation: it was stopped during dependency fetching. This is
neither a compiler failure nor evidence that the guard works. The official Git CLI setup progressed
further than the initial fetch attempt. The Codex V8 archive and Rust binding both passed the
official source-pinned manifest checks. Attempts to omit unused C++ submodules in the temporary
cache did not persist through Cargo's checkout preparation; no successful shortened build is
claimed. The build and its fetch children were stopped, and no experimental executable was installed.

Provenance, hashes, patch and probe remain in the temporary directory; its `receipt.json` records
`modelTurns: 0` and `productionPolicyCertified: false`. Source archive SHA-256:
`af62862cf5eb25b0ef0c45d2a964b1337a31b502c0627257d8339f582d431c60`.
Compiler available for the attempt: Rust 1.98.0; no global toolchain was installed or changed.
The final fetch log is `prototype-build-cache-metadata.log` in that directory.

Next qualification must first produce an identified executable, then pass the clean/disabled
positive controls, configured-MCP startup and direct-refresh denials, and rejection recovery.
Even those results would leave plugin MCP, Skills, hooks, managed/cloud policy, credentials,
permission mutation and model/tool execution unqualified. Formal native-component integration and
distribution remain subject to the pending ADR 0009 scope decision.

## Nooki delivery validation

Probe syntax validation, documentation links and `git diff --check` pass. Application regression
tests were not rerun for these documentation-only repository changes. Desktop build/install and
strict deep codesign verification pass; installed Nooki remains 0.12.0 with executable SHA-256
`9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-materialization-desktop-build.log` and
`/tmp/nooki-c06c-materialization-desktop-install.log`. Existing build advisories remain unchanged.
