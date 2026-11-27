# C06c: Native local-model feasibility checkpoint

- Date: 2026-11-27; follow-up to `5b7491b`, on the existing feature branch and PR #38.
- **The disposable configured-MCP/local-model feasibility checkpoint passes. C06c remains open.**
- No Nooki runtime/dependency change, native component adoption, real account or real model service.

## Scope and setup

This completes the local-model fixture part of [ADR 0009's first gate](../adr/0009-codex-native-policy-extension.md).
It uses the already identified guard and unmodified control from the
[matched native build](C06c-native-prototype.md). Neither native binary was rebuilt or installed for
this checkpoint. Full native policy qualification is still the next gate.

The probe is [probe-capability-agent-native-model-policy.mjs](../../scripts/probe-capability-agent-native-model-policy.mjs):

```sh
node scripts/probe-capability-agent-native-model-policy.mjs /absolute/path/to/codex-app-server
```

It pins `codex-app-server 0.170.0`, hashes the actual executable and creates an isolated synthetic
home. A test HTTP server binds only to `127.0.0.1` on an ephemeral port and returns fixed Responses
SSE events; it performs no inference. Provider configuration follows the official
[mock Responses configuration](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/app-server/tests/common/config.rs),
and event shapes follow the official
[response helpers](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/core/tests/common/responses.rs#L818).

Codex owns request serialization, model transport and native thread/turn events. The fixture server
is test infrastructure, not a model client added to Nooki. OpenAI authentication and WebSockets are
disabled for this custom provider; no credential is supplied. The server rejects authorization
headers without logging their contents, unexpected paths, wrong models and non-synthetic inputs.
The native thread response must identify the fixture provider, `mock-model`, read-only sandbox and
`never` approval policy. Turns must produce the exact synthetic assistant text and a successful
`turn/completed` event with the matching native thread and turn identities.

## Matched results

| Check | Unmodified control | Guard executable |
| --- | --- | --- |
| Clean configuration | One native turn completed through the local response server | Same positive control passed |
| Add an enabled MCP after `config/read` | Thread accepted; MCP marker created; a further local-model turn completed | Thread creation refused with `NOOKI_PROTOTYPE_MCP_DENIED`; no additional model request and no MCP marker |
| Disable the rejected MCP and retry | Not reached after the expected refusal assertion failure | New native turn completed through the same local response server |

The unmodified control deliberately proceeds to a synthetic turn when it accepts the disallowed
configuration. This provides a positive dispatch control; a zero request count caused merely by
never attempting dispatch is not treated as evidence of confinement. The guard supplies no thread
for that disallowed run. The canary observation is bounded to five seconds, followed by recovery
and another absence check. The existing guard app-server remains alive throughout.

Each variant completed two synthetic turns, but in different conditions: clean plus disallowed-MCP
configuration for the control, clean plus disabled-MCP recovery for the guard. The control exits 1
at the expected refusal assertion; the guard exits 0. Both fixtures report no request errors and
use no real model service. This tests native transport and lifecycle with fixed responses, not model
quality, billing or real-provider behavior.

| Artifact | SHA-256 |
| --- | --- |
| Guard | `5480e2397fb11b3661feb34a761c41bda1b4371a6a562d17e8f7e6d071e10016` |
| Unmodified control | `bf0955ee1ea3248ffc6ab7acf2dd1c54747cd3fc1c48b60b547301372eb54f3f` |

Receipts and logs:

- Control: `/private/tmp/nooki-profile-aH0xmM/model-probe.json`.
- Guard: `/private/tmp/nooki-profile-sQfJRx/model-probe.json`.
- Each profile retains synthetic native notifications and stderr for diagnosis.
- Logs under `/tmp/nooki-c06c-native-prototype/`: `final-model-baseline-20261127.log` and
  `final-model-guard-20261127.log`.
- `model-matched-result-20261127.json` in that directory records both final receipts and the probe
  hash. A post-run process check found no remaining fixture or native probe process.

## Remaining boundary

`productionPolicyCertified` remains false. This is a configured-MCP prototype with an intentionally
fixed guard, not the complete Host-approved policy implementation. Plugin MCP, Skills, hooks,
managed/cloud refresh, retained-session resume, non-strict recovery, credential helpers, OAuth,
permission mutation and effect-producing tools remain unqualified. HTTP fixture success does not
certify global network isolation, the WebSocket path or live-provider execution.

Host review/journal integration, dispatch reconciliation, cancellation, interaction routing and
public Agent acceptance still belong to C06c–C06e. Formal native-component integration and
distribution remain subject to the pending ADR 0009 scope decision. No package-facing API or
production dispatch is enabled by this checkpoint.

## Delivery validation

Probe syntax, local documentation links and `git diff --check` pass. The final repository probe
reproduces the expected unmodified-control failure and the guarded success above. Application
regression suites were not rerun because only test tooling and documentation changed.

Desktop build/install and strict deep codesign verification pass. Installed Nooki remains 0.12.0
with executable SHA-256 `9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-model-fixture-desktop-build.log` and
`/tmp/nooki-c06c-model-fixture-desktop-install.log`. Existing build advisories and unrelated UI
acceptance gaps remain unchanged.
