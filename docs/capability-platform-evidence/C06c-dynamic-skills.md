# C06c: Dynamic-tool admission and inherited Skill context

- Date: 2026-11-27; follow-up to `bb7b00d`, on the existing feature branch and PR #38.
- **New/resumed/forked dynamic-tool declarations are refused by the candidate. Skills isolation is not established, including with the scoped filesystem profile. C06c remains open.**
- This is a disposable native qualification patch; no production adapter or public Agent API is added.

## Native dynamic-tool boundary

The pinned source restores dynamic tools from native history when the current session's tool list
is empty. Checking only the `thread/start` request would miss persisted resume and fork paths.
The candidate checks both `SessionConfiguration.dynamic_tools` and
`InitialHistory::get_dynamic_tools()` at the beginning of `Session::new`, before session startup.
Any nonempty declaration returns native `InvalidRequest` with
`NOOKI_PROTOTYPE_DYNAMIC_TOOLS_DENIED`. Existing MCP, hooks and dispatcher checks are retained.

[probe-capability-agent-native-dynamic-policy.mjs](../../scripts/probe-capability-agent-native-dynamic-policy.mjs)
first launches the previous candidate in a fresh profile, creates a persisted native thread with
one synthetic dynamic tool and completes a real native callback round trip. The local Responses
fixture emits a function call; app-server emits `item/tool/call`; the harness returns a fixed
synthetic text result; Codex sends that output back to the local fixture and completes the turn.
Callback arguments and native thread/turn/call identities are checked. The callback performs no
external action. The actual rollout is read after app-server stops and must contain the tool and
its result. No history or rollout path is injected into the subsequent resume request.

| Admission | Previous control-plane candidate | Dynamic candidate |
| --- | --- | --- |
| New thread with a dynamic declaration | Advertises tool; callback runs | Fixed refusal before any model request/callback |
| Resume seeded thread by its original ID | Restores tool; callback runs | Same refusal |
| Fork seeded thread by ID | New thread inherits tool; callback runs | Same refusal |
| Clean thread after refusal attempts | Completes normally | Completes normally |

Each old-build run completes eight turns, twelve fixture requests and four synthetic callbacks,
including preparation. Each new-build run completes five turns and six requests; its only callback
is the explicitly identified preparation step executed by the old binary. All three candidate
refusal cases have zero additional model requests and zero callbacks. This is not a claim of zero
preparation activity or of absent provisional thread-store records.

Core also exposes `CodexThread::replace_dynamic_tools`, which persists and replaces a running
catalog through `session/thread_settings.rs`. No app-server caller was found in this pinned source;
this native library entry point is not exercised or constrained by the new admission check. Do not
call the entire dynamic-tool lifecycle qualified from these three startup paths. Live replacement,
other tool contributors and permission mutation remain separate checks before native integration.

## Skills: rendering control is not an access boundary

The fixture writes a synthetic `home/.codex/skills/synthetic-unrelated/SKILL.md` containing distinct
metadata and body markers. The submitted ordinary text never contains those markers. Each Skill
case starts a fresh thread, so prior conversation history cannot explain their appearance. The
fixture records marker presence in the actual native model request, rather than an app-side config
view. It never logs a personal Skill or calls a real model.

Both old and new binaries produce these observations:

| Case | Metadata in native model input | Skill body in native model input |
| --- | --- | --- |
| Automatic catalog enabled | Yes | No |
| `skills.include_instructions=false`, ordinary text | No | No |
| Same setting, explicit native Skill input by name/path | Yes | Yes |

The same three outcomes occur in **both** tested permission modes:

```sh
node scripts/probe-capability-agent-native-dynamic-policy.mjs /path/to/candidate /path/to/preparation readonly
node scripts/probe-capability-agent-native-dynamic-policy.mjs /path/to/candidate /path/to/preparation scoped
```

`readonly` uses the ordinary native read-only sandbox. `scoped` selects `permissions: nooki-run`
with the [C06a](C06a.md) explicit read boundaries: minimal runtime reads, denied `/private`, `/Users`,
`/Volumes` and the audited runtime exclusions, plus specific input-read/output-write grants and
disabled tool network. The synthetic home Skill is outside both granted directories. Every
successful start/resume/fork response must acknowledge the named profile, exact output-only
writable root, excluded implicit temporary write roots and `approvalPolicy: never`.

This combines that permission projection with actual Skill context injection; it does not rerun
the separate OS sandbox read/write/socket controls or claim that their prior results changed.
Output-specific deny-glob fixtures are not part of this read-context experiment. The result shows
that the tested filesystem scope and catalog-rendering option do not, by themselves, exclude the
native Skill content from the model request. Ordinary Codex Skill invocation is intended behavior;
the unmet requirement is the dedicated capability session's approved-input boundary.

Source inspection explains why another rendering flag would be insufficient: the app-server
installs a host Skill provider; `requires_host_skill_discovery()` remains true for that provider;
core turn construction collects explicit mentions and loads their prompts independently of the
automatic catalog's display option. It also contains Skill MCP-dependency preparation before
prompt injection. That dependency effect is not executed by this text-only fixture and remains
unqualified. `passed` in this probe refers to dynamic admission; `skillsConfinementCertified` and
`productionPolicyCertified` remain false.

The next native step must constrain the Skill discovery/read/injection path and explicit Skill
selection against approved scope, including required Skills and persisted context. It must retain
the intended approved task instructions rather than treat an empty prompt as successful execution.

## Constraint terminology

The inspected pinned MCP requirement maps are allowlist filters:
`filter_mcp_servers_by_requirements` and `filter_plugin_mcp_servers_by_requirements` disable
nonmatching servers. An allowlisted entry is not evidence that the runtime must launch that
connector. `McpServerConfig.required` is a separate startup-readiness setting. Future checks must
distinguish preserving managed restrictions from handling required-server conflicts; do not invent
a mandatory-launch requirement from an allowlist. Required Skills likewise have their own native
validation. None of these additional cases is certified by this checkpoint.

## Identity and regression

| Binary | SHA-256 |
| --- | --- |
| Previous control-plane candidate / preparation | `569f016f7253ecd013239f60c943058aad7b5e419e908beff85083e09925d1a8` |
| Dynamic admission candidate | `ad2c323c5c37494128032125b1a986e3b87c5d3b63e960cd0e12cd9c75454a5d` |

The complete four-file source delta is [C06c-native-dynamic.patch](C06c-native-dynamic.patch),
SHA-256 `0e346ebdf3629314481c69eaac45c219dd7f9536f2ebb6dec2987e992069eb1a`.
Exact replay against the pinned originals passes with `patch -p1` or `git apply --unidiff-zero`.
The [startup checkpoint](C06c-startup-policy.md) supplies the unchanged source/archive pin,
normalized lockfile, toolchain and dependency inputs. The cached native build completed in
1m 57s. Existing unused-helper and development-linker advisories remain; no unrelated cleanup or
release-size claim is included. The binary stays under
`/tmp/nooki-c06c-native-prototype/bins/dynamic-guard/`.

The candidate also passes the 15-case startup probe, two-turn ordinary persisted-resume probe,
eight-turn hooks/trust-preparation regression and two-turn connector control-plane regression.
The final set totals **38 synthetic turns**, including preparation and expected-failure controls;
fixture errors and real model calls are zero. Earlier preliminary runs are excluded from that total.

| Run | Receipt |
| --- | --- |
| Read-only failure control | `/private/tmp/nooki-profile-uJvXzG/dynamic-policy-probe.json` |
| Read-only candidate | `/private/tmp/nooki-profile-hYYVbb/dynamic-policy-probe.json` |
| Scoped failure control | `/private/tmp/nooki-profile-h2UsGK/dynamic-policy-probe.json` |
| Scoped candidate | `/private/tmp/nooki-profile-xbh8se/dynamic-policy-probe.json` |
| Startup regression | `/private/tmp/nooki-profile-mMOznt/startup-probe.json` |
| Ordinary resume regression | `/private/tmp/nooki-profile-l2ynXB/resume-probe.json` |
| Hooks regression | `/private/tmp/nooki-profile-YvjBYz/hooks-guard-probe.json` |
| Control-plane regression | `/private/tmp/nooki-profile-tNd173/control-plane-probe.json` |

`/tmp/nooki-c06c-native-prototype/dynamic-matched-result-20261127.json` records all final receipts
and executable/probe/patch identities. Logs are `dynamic-*-20261127.log` in that directory.
Formal [native-component integration/distribution](../adr/0009-codex-native-policy-extension.md)
remains pending. Complete Host policy binding, reconciliation and installed real-Agent acceptance
remain unfinished; the Codex-first order and full C06 acceptance bar are unchanged.

## Delivery checks

Probe syntax, 156 local documentation links, exact native patch replay and `git diff --check` pass.
Native experiment processes were confirmed stopped. Application regression suites were not rerun
for qualification-tooling/documentation-only changes. Desktop build/install and strict deep
codesign verification pass. Installed Nooki remains 0.12.0 with executable SHA-256
`9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-dynamic-desktop-build.log` and
`/tmp/nooki-c06c-dynamic-desktop-install.log`. Existing task workers were handed off by the installer.
No experimental Codex binary was installed into Nooki or the user's CLI.
