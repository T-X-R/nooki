# C06c: Native credential-link checkpoint

- Date: 2026-11-26; based on `b8fca86`, existing branch and PR #38.
- **C06c remains incomplete.** This proves one candidate authentication mechanism, not a usable
  production execution policy. App/platform/contract 0.12.0 and kit 0.11.0 remain unchanged.
- Only synthetic fixture files are used. No personal credentials are inspected, copied, linked,
  logged out or changed; no real model turn, new credential store or application runtime is added.

## Verified behavior

```sh
node scripts/probe-capability-agent-auth-link.mjs /absolute/path/to/codex
```

The probe requires macOS and `codex-cli 0.170.0`. A fresh `desktop-profile.mjs` environment contains
two separate Codex homes, each configured for the native file store. Native `login --with-api-key`
stores an intentionally fake key in the original home. The isolated home links `auth.json` to that
synthetic original. The probe verifies that:

1. Native login status reads the linked file.
2. A second native login through the isolated home updates the original file and retains the link.
3. Native atomic replacement retains private `0600` permissions.
4. The commit lock is created beside the original file, with no isolated-home lock file.
5. Native logout of this **synthetic API-key fixture** removes the isolated link and retains the
   original file; the original home still reports a configured key.
6. Making the original read-only causes native login to fail. Its content, `0400` permissions and
   the link remain unchanged.
7. After removing the original fixture file, a fresh native login-status command reports not logged
   in. No copied fallback credential file appears.

Final receipt: `/private/tmp/nooki-profile-DyTz8V/auth-link-probe.json`.
Log: `/tmp/nooki-c06c-auth-link-probe-final.log`. All seven controls pass. The receipt records zero
model turns, no real credentials and `productionPolicyCertified: false`. The initial five-control
receipt remains at `/private/tmp/nooki-profile-7NE15E/auth-link-probe.json`.
The first run of the read-only control failed in the test wrapper because callback-style `execFile`
does not attach captured stderr to its error object. The wrapper now retains that output; the final
control requires both exit code 1 and the native read-only refusal, without weakening the assertion.

## Native source and remaining boundary

The official source is pinned to `rust-v0.170.0`, commit
`29eb79e9866b3262a777fdf8195c1b9e63684c91`:

- [File replacement](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/login/src/auth/storage_file.rs)
  resolves credential symlinks and rejects read-only/hard-linked replacements.
- [Credential commit locking](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/login/src/auth/storage_commit.rs)
  resolves the same target before selecting its sidecar lock. Lock-file placement is observed here;
  concurrent OAuth refresh and compare-and-save behavior are not tested by this probe.
- [Native auth manager](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/login/src/auth/manager.rs)
  invokes token revocation in `logout_with_revoke`. Therefore the synthetic API-key logout result
  does **not** authorize native logout as cleanup for a shared OAuth login. An eventual isolated
  runtime must remove only its own resources without revoking the user's original login.
- [Configuration loader](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/config/src/loader/mod.rs)
  still loads system, managed/cloud and project layers in addition to the selected Codex home.
  A new home alone does not prove that unrelated connectors or tools cannot be inherited.
- [Release CLI entry point](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/cli/src/main.rs)
  passes default loader overrides to the app-server. The separate test-user-config environment
  hook in the [app-server library](https://github.com/openai/codex/blob/29eb79e9866b3262a777fdf8195c1b9e63684c91/codex-rs/app-server/src/lib.rs)
  is compiled only with debug assertions; it is not a supported release isolation interface.

An additional zero-credential native probe supplied `environments: []` with an enabled synthetic
MCP server. The server still started; disabling environment access is not a replacement for connector
startup isolation. This counterexample is now included in `probe-capability-agent-config.mjs`.
All six configuration controls pass in `/tmp/nooki-c06c-config-environment-final.log`, with receipt
`/private/tmp/nooki-profile-IKOztv/config-probe.json`. The original five-control checkpoint keeps
its historical receipt. These assertions reproduce limitations; they do not certify confinement.

The candidate file link avoids Nooki handling credential contents, but production integration must
still establish complete immutable configuration/tool authority while retaining managed restrictions.
Keyring-backed login, real OAuth refresh, active-process logout observation, authenticated requests,
source/configuration lifecycle races and package-facing dispatch are not certified. No capability
gets access to login commands or credential paths. C06c stays open, as do C06d/C06e and C05c's separate
archive-installation approval.

## Delivery verification

Probe syntax and diff checks pass. Application sources and dependencies are unchanged; C06b2's
application regression counts remain historical evidence, not new runs for this checkpoint.
`npm run desktop:build`, `npm run desktop:install` and strict deep codesign verification pass.
Installed `/Applications/Nooki.app` remains 0.12.0 with unchanged executable SHA-256
`9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-auth-link-desktop-build.log` and
`/tmp/nooki-c06c-auth-link-desktop-install.log`. Process inspection found no remaining probe
app-server/canary; the installer handed off the existing normal and test-profile task workers.
Existing bundle-size/plugin-timing advisories remain. No interactive package acceptance is claimed.
