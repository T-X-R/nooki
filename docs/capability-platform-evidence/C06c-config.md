# C06c: Native connector configuration checkpoint

- Date: 2026-11-26; based on `394f75b`, existing feature branch and PR #38.
- **C06c remains incomplete.** This checkpoint reproduces limitations of candidate configurations;
  passing the probe means those observations were reproduced, not that confinement passed.
- App/platform/contract 0.12.0 and kit 0.11.0 remain unchanged. No application runtime code,
  Agent API, credentials, personal configuration or installed capability package is changed.

## Native observations

Run on macOS with the audited installed CLI:

```sh
node scripts/probe-capability-agent-config.mjs /absolute/path/to/codex
```

The script requires `codex-cli 0.170.0`. It uses `desktop-profile.mjs` to create a fresh synthetic
home and child-only environment. Each scenario starts a separate native app-server with strict
configuration parsing. A synthetic Python MCP process writes its own marker before responding to
initialization. The fixture uses no real connector, login material or model turn. App-server threads
acknowledge `readOnly` sandbox and `never` approval policy; apps, plugins and hooks are disabled for
these tests, dynamic tools and selected capability roots are empty.

| Candidate configuration | Actual process startup | Conclusion |
| --- | --- | --- |
| `mcp_servers: {}` overlay | Existing canary started | An empty table does not erase inherited servers. |
| Explicit `enabled: false` for the existing server | No marker during five seconds; app-server remained alive | A named disable works for this fixed fixture. |
| Read config, disable known server, add another server to the synthetic config before `thread/start` | Newly added canary started; known server stayed disabled | Enumeration before dispatch leaves a reload gap. |
| `orchestrator.mcp.enabled=false` in thread configuration, with an existing and newly added server | Both canaries started | This setting does not prevent these connector processes from starting. |
| The same setting at app-server bootstrap through `-c`, and again in thread configuration | Existing canary started | Moving this setting to process startup does not close the observed gap. |

The marker is outside the read-only input workspace. Its creation demonstrates why a thread's
sandbox acknowledgement cannot alone certify all startup effects. The negative observation is
bounded to five seconds and the specific fixture. This test does not establish remote HTTP connector,
tool-call, Skills, hook, authenticated-model or later configuration-refresh behavior.

Final receipt: `/private/tmp/nooki-profile-pHRXO2/config-probe.json`.
Log: `/tmp/nooki-c06c-config-probe-final.log`. The receipt explicitly records
`modelTurns: 0` and `productionPolicyCertified: false`. All five reproduction assertions passed.
An earlier negative assertion that the orchestrator setting prevented startup failed, providing
the counterexample; the final script asserts the observed limitation explicitly instead of treating
that setting as an accepted isolation policy. The initial three-scenario result is retained at
`/private/tmp/nooki-profile-R1SisF/config-probe.json`.
An exact process inspection after the final run found no remaining probe app-server or MCP canary.

## Source review and implementation consequence

The official source was pinned to Codex tag `rust-v0.170.0`, commit
`29eb79e9866b3262a777fdf8195c1b9e63684c91`:

- [Configuration merge](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/config/src/merge.rs)
  recursively merges table keys, explaining the retained server entries.
- [App-server configuration manager](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/app-server/src/config_manager.rs)
  rebuilds configuration through `ConfigBuilder` with request overrides. The native reload fixture
  demonstrates that a prior `config/read` does not freeze the later thread's inputs.
- [Native loader overrides](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/config/src/state.rs)
  include user/project configuration controls internally. Their presence is not evidence of a
  supported external CLI switch. No such usable switch has been verified in this checkpoint.

Do not wire C06b's trusted policy resolver to a digest of these overlays and call that a verified
production policy. A post-start comparison is too late to prevent a connector already starting.
C06a remains valid for its tested subprocess filesystem/network boundary; it did not prove complete
app-server bootstrap isolation.

The next C06c step is to establish a supported configuration boundary that retains Codex-owned
authentication and managed restrictions, then test startup and refresh effects before connecting
submission/reconciliation. It must also constrain Skills, hooks, instructions and other tools.
No copying of credentials, alternate credential store, new model client or relaxation of the
approved effect scope is introduced by this checkpoint. Authenticated execution and public Agent
acceptance remain outstanding; the separate C05c archive-installation approval is still pending.

## Delivery verification

Probe syntax validation and `git diff --check` pass. The application source and dependencies are
unchanged, so the previously recorded C06b2 application test counts are not presented as new runs.
`npm run desktop:build`, `npm run desktop:install` and strict deep codesign verification pass.
Installed `/Applications/Nooki.app` remains 0.12.0; executable SHA-256 is unchanged:
`9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-config-desktop-build.log` and
`/tmp/nooki-c06c-config-desktop-install.log`. The installer handed off the existing normal/test
task workers; no unrelated Agent worker was terminated. Existing bundle-size/plugin-timing
advisories remain. No new interactive UI or authenticated Agent acceptance is claimed.
