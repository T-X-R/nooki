# C06c: Native startup refusal and synthetic managed requirements

- Date: 2026-11-27; follow-up to `10115e0` on the existing feature branch and PR #38.
- **All 15 scoped startup checks and the existing local-turn regression pass in the new temporary candidate. C06c remains open.**
- No modified Codex runtime is installed or integrated into Nooki.

Follow-up: [persisted resume and plugin MCP](C06c-resume-plugin.md) adds scoped recovery evidence
for this binary and reproduces an outstanding plugin-refresh escape. The startup checks below
retain their original scope and do not establish complete native-policy enforcement.

## Reproduced gaps and native change

The preceding [hooks/notify candidate](C06c-hooks-guard.md) rejects strict startup correctly, but
non-strict startup can turn its MCP/notify policy errors into default configuration and accept
`initialize`. The control deliberately keeps `features.hooks=false` in CLI overrides: otherwise the
fallback's default-enabled hooks could cause another rejection and conceal this recovery behavior.
The same control accepts initialization when a synthetic managed `requirements.toml` is malformed;
subsequent `configRequirements/read` then fails. These observations establish loss of fatal startup
semantics, not execution of rejected commands or model turns.

The new [experimental patch](C06c-native-startup-policy.patch) retains the prior MCP/hooks/notify
checks and makes two changes to official 0.170.0 source (`29eb79e9866b3262a777fdf8195c1b9e63684c91`):

1. Configuration materialization returns a typed `NookiPrototypePolicyRejection`. The native
   `ConfigManager::load_startup_config` treats this type as fatal in both startup modes, without
   classifying errors by their text or disabling ordinary user-configuration repair.
2. Default-configuration repair obtains the native application-policy snapshot, uses its managed
   cloud bundle and validates the same snapshot after loading. It no longer drops managed
   requirements when local policy loading fails or substitutes an empty cloud bundle.

The second change follows the existing native non-project configuration-loading path. Synthetic
local requirements are tested below; real cloud refresh, MDM transport and account behavior are not
certified by this source change. An intermediate typed-error-only build fixed MCP/notify fallback
but still accepted malformed managed requirements, isolating the need for the second change.

## Verification and controls

The [startup probe](../../scripts/probe-capability-agent-native-startup-policy.mjs) creates a fresh
profile for every case, pins the version, hashes the executable and records initialization versus
natural exit. It runs no thread or model turn:

```sh
node scripts/probe-capability-agent-native-startup-policy.mjs /path/to/codex-app-server
```

Managed cases use the official debug-only `CODEX_APP_SERVER_MANAGED_CONFIG_PATH` fixture entry.
It supplies a synthetic sibling `requirements.toml` and isolated loader paths while disabling real
host MDM inputs for this test. The probe does not set `ignore_managed_requirements`, modify `/etc`
or change Mac policy. This fixture mechanism is not an approved production loader configuration.
The enabled/disabled cases use canonical `codex_hooks` requirements; the successful disable case
also verifies the native `configRequirements/read` response contains that false requirement.

| Cases | Count | Final candidate |
| --- | --- | --- |
| Clean strict / non-strict configuration | 2 | Initialization succeeds |
| Malformed user config, non-strict / strict | 2 | Repair initialization succeeds / startup exits 1 |
| Enabled MCP, non-strict / strict | 2 | Both exit 1 with typed MCP refusal |
| Legacy notify, non-strict / strict | 2 | Both exit 1 with typed hooks refusal |
| CLI-enabled hooks, non-strict / strict | 2 | Both exit 1 with typed hooks refusal |
| Managed hooks disable against CLI enable | 1 | Initializes; native requirements response confirms disable |
| Same managed disable with malformed user config | 1 | User repair remains available while the managed disable is retained |
| Managed hooks enable against CLI disable | 1 | Exits 1 with hooks refusal; managed requirement is not weakened |
| Malformed managed requirements, non-strict / strict | 2 | Both exit 1 with the requirements parse error |

All refusals are natural exit code 1 with no signal; there are no observation timeouts. The old
candidate fails exactly the MCP/non-strict, notify/non-strict and malformed-managed/non-strict
readiness expectations. Both variants are evaluated by the same final probe. Readiness alone is
not taken as model-dispatch or command-execution evidence.

In the combined managed-disable/user-repair case, the requirements RPC still reports the malformed
user file. Retention is supported by the native load path and successful initialization despite a
CLI hook enable (which would otherwise trigger the fixed refusal); this is not a successful
post-start requirements-read or model-turn check for that broken configuration.

The unchanged [hooks guard probe](../../scripts/probe-capability-agent-native-hooks-guard.mjs) also
passes against the new binary. Its unmodified control performs five native trust/preparation turns;
the new candidate completes three clean/recovery turns and retains hook/notify/MCP refusals plus
strict startup denials. All eight turns use the static local Responses fixture, with no real model.

## Artifact identity and receipts

| Artifact | SHA-256 |
| --- | --- |
| Previous hooks/notify control | `9c7752fe3112e9854f540646089707bfce9c999e36342e228542fc828b7e37ef` |
| New startup-policy candidate | `d62f754a79898f68c19d1e486c24b40f234861487444eef9c551e2df5d86e934` |
| Complete experimental patch | `75c0f2d34201c03700d40faf669b6b9b692f85af01ed1b215d8fcf973090181d` |

The complete patch uses zero-context hunks (`patch -p1 < /path/to/patch`, or `git apply
--unidiff-zero`). Reapplication to the pinned originals reproduces both temporary source files
exactly. The final `--locked` build uses the prior toolchain, dependencies and verified workspace-only
lock normalization, retaining the known linker unwind-table warning. Neither native binary nor
source is added to Nooki's build; the patch is a qualification fixture.

- Old-control receipt: `/private/tmp/nooki-profile-muOEre/startup-probe.json`.
- New-candidate receipt: `/private/tmp/nooki-profile-ardVSc/startup-probe.json`.
- Local-turn regression: `/private/tmp/nooki-profile-bey9Pz/hooks-guard-probe.json`.
- Under `/tmp/nooki-c06c-native-prototype/`: `startup-policy-matched-result-20261127.json`,
  `startup-policy-build-identity-20261127.json`, `startup-managed-policy-build-20261127.log`,
  `final-startup-{control|candidate}-20261127.log` and `final-startup-hooks-regression-20261127.log`.
- Retained candidate: `bins/startup-policy-guard/codex-app-server` in that temporary directory.

## Remaining boundary and delivery

`productionPolicyCertified` remains false. Managed hook execution, plugin MCP, Skills, retained-session
resume, real managed/cloud refresh, credentials/helpers, permission mutation, other effect-producing
tools and Host policy/receipt binding remain unqualified. The fixture tests do not establish real
MDM enforcement or global network isolation. Formal integration/distribution still requires the
pending [ADR 0009 scope decision](../adr/0009-codex-native-policy-extension.md).

Final startup and local-turn probes, syntax, exact patch replay, 119 local documentation links and
`git diff --check` pass. No probe/native test processes remained after verification. Application
regression suites were not rerun for qualification tooling/documentation only.

Desktop build/install and strict deep codesign verification pass. Installed Nooki remains 0.12.0
with executable SHA-256 `9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-startup-desktop-build.log` and
`/tmp/nooki-c06c-startup-desktop-install.log`. Existing task workers were handed off by the installer.
Existing build advisories and unrelated UI acceptance gaps remain unchanged.
