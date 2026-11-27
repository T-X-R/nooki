# C06c: Local Skill discovery and read authority

- Date: 2026-11-27; follow-up to `066a298`, on the existing feature branch and PR #38.
- **The tested local fresh-thread Skill paths now respect the selected read scope while retaining approved Skills. C06c remains open.**
- This is a disposable native qualification patch, not a production adapter or an approved native-component distribution.

## Cause and experimental change

The [previous checkpoint](C06c-dynamic-skills.md) demonstrated home Skill body injection outside
the named filesystem profile. Pinned native `HostSkillsService` discovered user/system/admin and
plugin Skills through an unrestricted local accessor. `SkillLoadOutcome::read_skill_text` used
current environment authority only for repository Skills; other scopes used unrestricted local
reads. Plugin discovery could also reuse metadata parsed before the selected permissions applied.
Changing catalog rendering alone cannot constrain these paths.

The candidate reuses the selected local environment accessor for configured Skill discovery and
uses the current matching filesystem accessor for body reads across all Skill scopes. It bypasses
preparsed plugin Skill metadata when constructing this snapshot, so that metadata must be loaded
through the current accessor. Existing cache keys include the permissions snapshot. The fixed
client-dispatch refusal now also covers the `skills/` namespace; the unscoped `skills/list` RPC
cannot provide an alternate inventory path. All previous native restrictions remain in the patch.

This deliberately limited experiment identifies a local environment using the existing
`implicit_repository_skills` flag set by `with_environment_id`. Missing local access produces an
empty snapshot. That coupling is not a proposed public policy interface, and empty remote snapshots
are not evidence of usable remote Skills. A formal integration must bind trusted Host policy
explicitly and preserve or reject required instructions consistently.

## Matched native controls

[probe-capability-agent-native-skills-policy.mjs](../../scripts/probe-capability-agent-native-skills-policy.mjs)
creates a fresh synthetic HOME, repository Skill, user Skill and symlink. It runs six native turns
in one app-server process, each in a fresh ephemeral thread. Two named filesystem profiles differ
only in whether the synthetic user Skill directory is explicitly readable. Both retain the C06a
input-read/output-write scope and disabled tool network. Native acknowledgements must match the
selected profile, exact output-only writable root, temporary-root exclusions and `never` approvals.
A static local Responses fixture captures marker presence in actual model input; no real model,
personal Skill, credential or executable Skill dependency is used.

| Case, in execution order | Previous dynamic candidate | Skills candidate |
| --- | --- | --- |
| Explicitly permitted user Skill, warming shared caches | Body present | Body present |
| Global `skills/list` after that warm-up | Accepted | Fixed native refusal, no model request |
| Restricted automatic catalog after wider cache | Foreign metadata present | Foreign metadata/body absent; approved metadata present |
| Restricted explicit user Skill input | Foreign metadata and body present | Both absent |
| Approved repository Skill input | Approved body present | Approved body present |
| Repository symlink pointing to unapproved user Skill | Foreign metadata/body absent | Both absent |
| Permitted user Skill after restricted cache use | Body present | Body present |

The old binary completes six turns but intentionally exits 1 on four failed assertions. The
candidate completes the same six turns and exits 0 with no mismatches. This validates both denial
and retained access, not merely an empty prompt. Cache coverage is across threads with distinct
permission profiles in one process, not live permission replacement in an existing thread.

## Identity, replay and regressions

| Item | SHA-256 |
| --- | --- |
| Previous dynamic candidate | `ad2c323c5c37494128032125b1a986e3b87c5d3b63e960cd0e12cd9c75454a5d` |
| Skills candidate | `5bbb2bf6d063938f0224b35e7fdd9a2b94947e0f9fa6dba5a5a22ec10d802f80` |
| New probe | `2604e52685591f72d7f91f9684606439d68ed7a8f9c66056b7fced3b7ff46256` |
| Complete native patch | `656f424131ff13889ca7f35711c96e6d6561ffe80661f24ee5e48e785d0222a0` |

[C06c-native-skills.patch](C06c-native-skills.patch) contains the complete six-file delta against
the pinned originals, including the earlier startup, session and control-plane checks. Exact
six-file replay passes with `patch -p1` or `git apply --unidiff-zero`. Source/archive identity,
normalized lockfile and toolchain are unchanged from the [startup checkpoint](C06c-startup-policy.md).
The cached development build took 1m 58s; existing unused-helper and linker advisories remain.
The binary stays under `/tmp/nooki-c06c-native-prototype/bins/skills-guard/`.

The same binary passes the 15-case startup regression, ordinary persisted resume, hooks/trust
preparation, connector control-plane and scoped dynamic-admission probes. Final matched tests
and regressions total **29 synthetic turns**, including old-build controls and preparation.
Fixture errors and real model calls are zero. Preliminary runs are excluded from this total.

| Run | Local receipt |
| --- | --- |
| Expected-failure Skill control | `/private/tmp/nooki-profile-7wuGlq/skills-policy-probe.json` |
| Skill candidate | `/private/tmp/nooki-profile-CySdaV/skills-policy-probe.json` |
| Startup | `/private/tmp/nooki-profile-I4GHO1/startup-probe.json` |
| Ordinary resume | `/private/tmp/nooki-profile-gBIMLd/resume-probe.json` |
| Hooks | `/private/tmp/nooki-profile-1ItdLw/hooks-guard-probe.json` |
| Control plane | `/private/tmp/nooki-profile-xBqcKb/control-plane-probe.json` |
| Scoped dynamic admission | `/private/tmp/nooki-profile-SjP8BF/dynamic-policy-probe.json` |

The aggregate `/tmp/nooki-c06c-native-prototype/skills-matched-result-20261127.json` records
receipt locations, counts and probe/patch identities. Native build and fixture logs are
`skills-*-20261127.log` in that directory.

## Remaining boundary

This checkpoint does not qualify required Skills, previously persisted Skill text during resume
or fork, live permission changes, remote environments, alternate internal inventory callers,
plugin Skill execution/dependency effects, or managed/cloud refresh. Plugin metadata cache bypass
is included in the code path, but a plugin Skill fixture has not yet exercised it. Some global
native discovery/watch helpers still use unrestricted access; denying client RPCs is not proof
that every internal caller is confined. The explicit path tests use discovered synthetic Skills,
not every possible path/alias or filesystem race.

Next qualify persisted context under a narrower grant and required-Skill conflicts, then remaining
contributors and live policy transitions. Complete Host policy binding, native dispatch/reconciliation
and installed real-Agent acceptance remain unfinished. The Codex-first order is unchanged;
[ADR 0009](../adr/0009-codex-native-policy-extension.md) integration/distribution approval remains pending.
No full-C06 acceptance box is closed by this local experiment.

## Delivery checks

Probe syntax, 163 local documentation links, exact six-file patch replay and diff checks pass.
Native fixture processes were confirmed stopped. Application regression suites were not rerun
for this qualification-tooling/documentation-only change. Desktop build (native release: 37.62s),
installation and strict deep codesign verification pass. Installed Nooki remains 0.12.0 with
executable SHA-256 `9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs are `/tmp/nooki-c06c-skills-desktop-build.log` and
`/tmp/nooki-c06c-skills-desktop-install.log`. The existing frontend chunk-size advisory remains.
No experimental Codex executable was installed into Nooki or the user's CLI.
