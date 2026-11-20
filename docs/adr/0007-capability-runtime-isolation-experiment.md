# ADR 0007: Capability runtime isolation experiment

- Status: proposed; topology selection pending P02b
- Date: 2026-11-20
- Design authority: [Capability platform, runtime policy](../capability-platform-design.md#8-runtime-policy-and-limits)
- Evidence: [P02a desktop experiment](../capability-platform-evidence/P02a.md)

## Context

The toolbox requires independently removable package execution, unavailable shell/private data,
authenticated Host calls, unapproved-egress prevention and a usable shell when package code loops.
Choosing a transport before measuring these properties risks freezing an unenforceable contract.

P02a used the installed Tauri/WKWebView engine and four isolated nonpersistent views. It demonstrated
separate storage, controllable termination, scoped command checks and basic asset/media support.
It also demonstrated two gaps: app commands without their own check were reachable from package
views, and WebRTC sent UDP despite restrictive CSP. Neither gap may be relabeled an accepted risk
to clear K0 or the later containment gates.

## Current decision

Do **not** adopt separate Tauri webviews plus CSP alone as the production security boundary. Keep the
existing trusted-only loader unchanged while P02b resolves the two failures. Do not expose new
production transport-dependent APIs based on the experiment. This ADR records a rejected baseline,
not approval of a replacement runtime.

## Alternatives under evaluation

| Arrangement | Evidence or constraint | Current disposition |
|---|---|---|
| Existing shared renderer | Package code shares shell authority, DOM and execution environment | Remains explicitly trusted-only; cannot satisfy target containment |
| Sandboxed iframe in shell | May separate DOM/origin, but iframe sandboxing alone does not prove independent CPU termination, native caller identity or egress denial | Not selected; no desktop containment claim without probes |
| Separate nonpersistent WKWebViews + native broker checks + CSP | P02a proved process separation/stop and storage boundaries on macOS 15.6.1; UDP escape and broad app-command defaults were reproduced | Insufficient as tested |
| Separate views with native engine-level network restrictions and complete native command denial | Could preserve DOM-based package UI while closing the reproduced routes | Next experiment; must fail closed where the engine cannot enforce policy, and must account for API availability/support |
| Bundled sandboxed helper process | Can offer an additional OS-level boundary, but media, UI embedding, inherited IPC and WebKit network-process behavior need validation | Alternative if view-level enforcement cannot meet the design; not arbitrary package-supplied native execution |
| Restricted JS worker/runtime with host-rendered UI | Worker termination is useful, but unrestricted React/DOM pages would need a different UI protocol and permissions model | Additional complexity; not a drop-in substitute for the accepted package experience |

## Decisions still required

- Test a native egress boundary against the reproduced WebRTC path and additional HTTP, navigation,
  frame/worker, DNS-prefetch and connection routes; retain permissive positive controls.
- Deny package calls to all application/core/plugin commands except the narrow broker. Native caller
  identity must come from the receiving runtime, never a supplied package ID.
- Prove embedding or navigation arrangements, real media playback/cleanup, and forced stop without
  relying on private diagnostic process IDs as the production termination mechanism.
- Measure message/transfer, storage, concurrency and queue limits. The initial 64 KiB payload check
  excludes the IPC envelope, runs after deserialization and is not a memory-allocation bound. The twelve IPC samples and process
  RSS observations are insufficient for the full resource-budget decision.
- State the actual supported OS/engine matrix and explicit fail-closed behavior elsewhere. A macOS
  experiment does not establish Windows/Linux parity.

## Source constraints

Tauri documents that application commands registered through `invoke_handler` are available to all
views by default unless command permissions are configured; plugin/core capability restrictions do
not automatically close that path. [Tauri capabilities](https://v2.tauri.app/security/capabilities/)

Tauri's macOS incognito option uses a nonpersistent data store. Its navigation callback and custom
protocol handlers provide hooks, not a blanket guarantee that every network API is intercepted.
The experiment uses the pinned 2.12.5 implementation. [WebviewWindowBuilder](https://docs.rs/tauri/2.12.5/tauri/webview/struct.WebviewWindowBuilder.html)

WebKit's own MiniBrowser uses `_webProcessIdentifier` for diagnostics. P02a follows that diagnostic
use only; application correctness must not depend on it.
[WebKit MiniBrowser source](https://github.com/WebKit/WebKit/blob/main/Tools/MiniBrowser/mac/WK2BrowserWindowController.m)

## Consequences

P02 and K0 stay pending. C01–C09 do not begin until a feasible path is established. The executable,
fixtures, raw synthetic events and rejection reasons remain available for regression and comparison.
Any eventual topology decision must replace this provisional decision with measured evidence and
preserve the original toolbox invariants.
