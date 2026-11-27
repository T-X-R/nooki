# C06c: Refuse connector control-plane effects before native dispatch

- Date: 2026-11-27; follow-up to `daa1195`, on the existing feature branch and PR #38.
- **The tested global inventory, resource and plugin-install effects are refused before dispatch. C06c remains open.**
- The candidate is a disposable qualification binary, not an integrated or distributed Nooki component.

## Boundary

The [thread-marker experiment](C06c-thread-mcp.md) excluded installed-plugin MCP from thread
execution but left global inventory able to start the same connector. The next source inspection
also found that `McpServerEventStreamStart` prepares a subscription in
`dispatch_initialized_client_request`, before the later operation handler. A handler-only check
would therefore be too late for that preparation path.

The candidate adds a fixed check in the native initialized-request dispatcher, before tracking,
admission, event-stream reservation and request queueing. It refuses these parsed native method
families with JSON-RPC code `-32600` and message `NOOKI_PROTOTYPE_CONTROL_PLANE_DENIED`:

- `mcpServer/`, including OAuth, resources, direct tools and event subscriptions;
- `plugin/`, `marketplace/` and `app/` connector administration;
- `mcpServerStatus/list` when no thread ID is supplied.

The method name comes from native `ClientRequest::method_name`, not a package-supplied classifier.
Thread-scoped inventory remains available through the marker-constrained projection. Explicit
`config/mcpServer/reload` remains available and is tested below. The earlier fixed config/hooks
refusals and common-session `McpServersDisabled` insertion remain in place. This deliberately
restricted qualification executable does not define the ordinary Nooki chat protocol or authorize
changing the user's installed Codex CLI. The whole native process policy remains unqualified.

## Matched effects and normal execution

[probe-capability-agent-native-control-plane.mjs](../../scripts/probe-capability-agent-native-control-plane.mjs)
creates a fresh synthetic profile, a local marketplace, a stdio MCP and an HTTP MCP whose endpoint
is a local fixture returning 404 discovery responses. It first uses the previous thread-marker
binary to install only the stdio plugin through native `plugin/install`, then stops that process.
The candidate is launched against that same seeded profile, so the inherited connector actually
exists. Preparation itself starts no connector and sends no model request.

```sh
node scripts/probe-capability-agent-native-control-plane.mjs /path/to/candidate /path/to/thread-marker-control
```

Both tested executables complete an initial native turn and a later turn in the same thread using
the static loopback Responses fixture. Thread-scoped inventory returns an empty catalog. Explicit
native MCP reload completes without a connector launch, discovery request or extra model request.

| Operation | Previous thread-marker build | New dispatcher candidate |
| --- | --- | --- |
| Global inventory | Returns the plugin and starts stdio MCP | Fixed policy refusal; no launch |
| Global resource read | Starts another MCP and reads a synthetic resource | Fixed refusal; no launch |
| Install local HTTP plugin | Installs it and makes 8 loopback discovery GETs | Fixed refusal; no HTTP request |
| Plugin configuration/cache after install attempt | Config changes; new manifest exists | Config unchanged; manifest absent |
| OAuth login, direct tool call, event start/stop and plugin read | Ordinary handler results/errors, not policy refusal | Same fixed refusal before dispatch |

The prior build fails all eight expected-refusal checks and both aggregate effect/state checks;
the new build passes. The candidate's final totals are zero stdio starts, zero discovery requests,
and exactly two explicitly requested model turns. Both builds return the expected synthetic
assistant text with matching native turn/thread identities. No credentials or real model service
are involved.

The test waits 250 ms after each control operation and one second after the final normal turn.
Receipts distinguish per-request effects from final totals. The global inventory and resource
controls prove executable canaries; the HTTP install proves that discovery works in the fixture.
The OAuth case uses the stdio server and the event case is not a hosted app: those checks prove
early fixed refusal, not a successful OAuth flow or live event subscription. The namespace rule
also covers marketplace/app methods by source inspection; those families are not individually
runtime-qualified here. No complete authentication, websocket-transport or production confinement
claim follows from these stdio app-server controls.

## Reproduction and regression

| Binary | SHA-256 |
| --- | --- |
| Previous thread-marker build / preparation | `499f293b6eee9acf520886dd0a927c6e45f5d7f0dd45c199b359f83c5ec5264a` |
| Dispatcher candidate | `569f016f7253ecd013239f60c943058aad7b5e419e908beff85083e09925d1a8` |

The complete four-file native delta is [C06c-native-control-plane.patch](C06c-native-control-plane.patch),
SHA-256 `86e8cbb83ea6cac65519eeee6b2c9d70f5809a977f32b11a856bee8a73adcd1e`.
It replays exactly against the pinned originals using `patch -p1` or `git apply --unidiff-zero`.
Use the [startup checkpoint's](C06c-startup-policy.md) source/archive pin, normalized lockfile and
toolchain/dependency inputs. The cached native build completed in 26.35 seconds; the existing
development-linker `__eh_frame` advisory remains. The binary stays under
`/tmp/nooki-c06c-native-prototype/bins/control-plane-guard/`.

The candidate passes the existing 15-case startup probe, two-turn persisted-resume/refusal/recovery
probe, and hooks/notify/configured-MCP regression with five preparation plus three candidate turns.
Thread-scoped configuration reload still exercises those refusal paths; the new global denial does
not replace their expected config errors. The final set totals **14 synthetic turns**, including
the two-turn expected-failure control. Preliminary runs are excluded from that total.

| Run | Receipt |
| --- | --- |
| Expected-failure control | `/private/tmp/nooki-profile-k1eMyu/control-plane-probe.json` |
| Dispatcher candidate | `/private/tmp/nooki-profile-NrwlId/control-plane-probe.json` |
| Startup regression | `/private/tmp/nooki-profile-tdp1P8/startup-probe.json` |
| Persisted-resume regression | `/private/tmp/nooki-profile-8a86cb/resume-probe.json` |
| Hooks regression | `/private/tmp/nooki-profile-4hPZRe/hooks-guard-probe.json` |

`/tmp/nooki-c06c-native-prototype/control-plane-matched-result-20261127.json` records the receipts,
binary and probe/patch identities. Logs are `control-plane-*-20261127.log` in that directory.
Fixture errors and real model calls are zero.

## Remaining acceptance

The observed global inventory/resource and install-triggered discovery gaps now have matched
native refusal evidence. This does not certify every internal discovery caller, selected-root/
extension/remote-environment effect, managed requirement or credential helper. In particular,
excluding a connector is not evidence that an incompatible mandatory connector requirement was
explicitly refused. Skills discovery/context and dynamic tool/permission mutation remain separate
native boundaries to qualify before Host adapter dispatch can be exposed.

No Host policy receipt, adapter reconciliation or public `host.agents` API is added here. The
[ADR 0009 integration/distribution scope](../adr/0009-codex-native-policy-extension.md) remains
pending. Keep the Codex-first order and the complete C06 acceptance bar unchanged.

## Delivery checks

Probe syntax, 149 local documentation links, exact patch replay and `git diff --check` pass.
Native app-server and synthetic canary processes were confirmed stopped. Application regression
suites were not rerun for qualification-tooling/documentation-only changes. Desktop build/install
and strict deep codesign verification pass. Installed Nooki remains 0.12.0 with executable SHA-256
`9ff4839694024f84c86cf3652f24cfe35bdab2f0511ebdb5fc325c6a7eae3a91`.
Logs: `/tmp/nooki-c06c-control-plane-desktop-build.log` and
`/tmp/nooki-c06c-control-plane-desktop-install.log`. The installer handed off existing task workers;
the temporary Codex candidate is not packaged. Existing build advisories remain unchanged.
