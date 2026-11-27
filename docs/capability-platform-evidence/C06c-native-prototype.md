# C06c: Native configuration materialization review and MCP experiment

- Initial review: 2026-11-26; native build and matched controls: 2026-11-27, following `64ef1f0`.
- **Configured-MCP controls pass; C06c and the complete prototype gate remain incomplete.**
  Codex remains the first adapter, on the existing feature branch and PR #38.
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

## Initial build attempt (2026-11-26)

The full pinned source was extracted under `/tmp/nooki-c06c-native-prototype/`.
An eight-line experimental guard was added only to that temporary source's common materialization
function, rejecting any enabled configured MCP with `NOOKI_PROTOTYPE_MCP_DENIED`.
At this initial checkpoint, the recovery and strict-bootstrap checks had not run against an
experimental executable. The successful follow-up below supersedes that build-pending state.

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

## Native build and matched controls (2026-11-27)

The existing download was resumed until it terminated with a concrete `--locked` error. Offline
comparison identified only release workspace-version normalization: 174 local packages changed
from 0.0.0 to 0.170.0, with every external dependency and checksum unchanged. The official
[release workflow](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/.github/workflows/rust-release.yml#L610)
documents the same tag/lockfile mismatch and runs `cargo update --workspace`. After applying only
that verified normalization, `cargo build -p codex-app-server --bin codex-app-server --locked`
succeeded using Rust 1.98.0, four build jobs, no debug information and no incremental compilation.
The official checksum-verified V8 archive and binding were used; native sources were fully fetched.

The guard build took 5m 17s after normalization, excluding the earlier Git dependency downloads.
The resulting unoptimized development executable is 715,764,880 bytes. This is not a release-size
estimate or a production packaging decision. A linker warning reported an oversized unwind table
and possible exception-handling performance impact; it did not prevent either build from completing.

An unmodified-source control was then built with the same toolchain, normalized lockfile, V8
artifacts and settings. It took 1m 57s with the populated cache. The guard executable was preserved
before rebuilding, and the temporary guard source was restored afterward.

| Artifact | SHA-256 |
| --- | --- |
| Guard, `bins/guard/codex-app-server` | `5480e2397fb11b3661feb34a761c41bda1b4371a6a562d17e8f7e6d071e10016` |
| Unmodified control, `bins/baseline/codex-app-server` | `bf0955ee1ea3248ffc6ab7acf2dd1c54747cd3fc1c48b60b547301372eb54f3f` |

Both artifacts are under `/tmp/nooki-c06c-native-prototype/` and report
`codex-app-server 0.170.0`; the hashes distinguish the experiment from its control. Neither was
installed into Nooki or substituted for the user's CLI. Original and normalized lockfile hashes,
the complete version-only comparison, and source integrity checks are retained in
`lock-diagnosis.json` and `source-integrity-20261127.json` in that directory.

The reusable probe is [probe-capability-agent-native-mcp-policy.mjs](../../scripts/probe-capability-agent-native-mcp-policy.mjs):

```sh
node scripts/probe-capability-agent-native-mcp-policy.mjs /absolute/path/to/codex-app-server prototype
```

`prototype` selects the standalone invocation shape, including for the unmodified control;
`official` selects the installed CLI's `app-server` subcommand. The probe pins the expected 0.170.0
version, records the selected launcher file's hash, and creates an isolated synthetic home. It is a
negative regression against the unmodified control, so an assertion failure there is expected.

| Check | Unmodified control | Guard executable |
| --- | --- | --- |
| Clean configuration | Read-only thread with `never` approval created | Same positive control passed |
| Add enabled MCP after `config/read` | No refusal; canary process started | `NOOKI_PROTOTYPE_MCP_DENIED`; no marker during five seconds |
| Thread-scoped MCP status/config rebuild | No refusal | Same policy error from direct session rebuilding |
| Disable the rejected MCP and retry | Not reached after the expected failing assertion | New read-only thread created; existing app-server remained alive |
| Strict process startup with enabled MCP | Not reached after the expected failing assertion | Exit code 1, no signal, explicit policy error, no canary marker |

The matched control failed the refusal assertion; the guard passed all five checks. Both used zero
model turns and no personal credentials. Receipts:

- Control: `/private/tmp/nooki-profile-GFZ9RV/prototype-probe.json`.
- Guard: `/private/tmp/nooki-profile-aBpyHU/prototype-probe.json`.
- Logs under `/tmp/nooki-c06c-native-prototype/`: `prototype-build-normalized-20261127.log`,
  `baseline-build-normalized-20261127.log`, `final-baseline-probe-20261127.log` and
  `final-guard-probe-20261127.log`.

`matched-result-20261127.json` also records the final probe and patch hashes, both receipts and
the lockfile comparison. A process check after both runs found no remaining build or probe process.

This establishes only the tested configured-MCP path. Plugin MCP, Skills, hooks, managed/cloud
refresh, retained-session resume, credentials, permission mutation, non-strict recovery and
model/tool execution remain unqualified. The first ADR gate's local-model fixture is also still
outstanding. `productionPolicyCertified` remains false; no C06c acceptance item is marked complete.
Formal native-component integration and distribution remain subject to the pending ADR 0009 scope
decision.

## Nooki delivery validation

The 2026-11-26 checkpoint passed probe syntax validation, documentation links and `git diff --check`.
Application regression tests were not rerun for that documentation-only change. Desktop build/install and
strict deep codesign verification pass; installed Nooki remains 0.12.0 with executable SHA-256
`9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-materialization-desktop-build.log` and
`/tmp/nooki-c06c-materialization-desktop-install.log`. Existing build advisories remain unchanged.

For the 2026-11-27 probe/evidence follow-up, syntax validation, local documentation links and
`git diff --check` pass. The final matched native runs reproduce the control failure and guard
success above. Nooki desktop build/install and strict deep codesign verification also pass;
the installed version and executable hash remain unchanged. Logs:
`/tmp/nooki-c06c-native-mcp-policy-desktop-build.log` and
`/tmp/nooki-c06c-native-mcp-policy-desktop-install.log`. Application regression suites were not
rerun because no Nooki application source or dependency changed. Existing app build advisories and
unrelated UI acceptance gaps are not reclassified by this native probe.
