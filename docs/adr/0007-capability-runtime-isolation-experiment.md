# ADR 0007: Capability runtime isolation experiment

- Status: proposed; topology selection pending P02b
- Date: 2026-11-20
- Design authority: [Capability platform, runtime policy](../capability-platform-design.md#8-runtime-policy-and-limits)
- Evidence: [P02a desktop experiment](../capability-platform-evidence/P02a.md)
  and [P02b1 native controls](../capability-platform-evidence/P02b1.md),
  extended by [P02b2a channels and playback](../capability-platform-evidence/P02b2a.md)

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

P02b1 closes the two reproduced routes in the disposable macOS probe: a native application-command
allowlist rejects package calls before their handlers, and a native WebKit preference disables peer
connections before package navigation. The restricted receivers recorded no TCP/UDP attempts while
the permissive control recorded four TCP connections and eight UDP packets. This is evidence for a
candidate, not a complete egress or production-support claim. P02b2 must finish the decision.

P02b2a finds a second concrete egress failure: `link rel=preconnect` opens a TCP connection from
each restricted view despite CSP and disabled peer connections. The dedicated receiver identifies
these connections separately from HTTP requests. Therefore **CSP plus the peer-connection switch
is still insufficient**. Other tested HTTP routes were denied with working positive controls.
The pinned Tauri internal channel fetch also refused three foreign views while the shell's known
message was still pending, then delivered the exact message to its owner. This specific exception
has native scope evidence; it is not a statement that every framework-internal operation is audited.

The extended fixture demonstrated actual silent-audio playback advancing while its window lost
focus, followed by pause and empty media state. It did not prove audible output, arbitrary codec
support, seamless looping/seek, service lifetime across page destruction, or native descriptor cleanup.

## Alternatives under evaluation

| Arrangement | Evidence or constraint | Current disposition |
|---|---|---|
| Existing shared renderer | Package code shares shell authority, DOM and execution environment | Remains explicitly trusted-only; cannot satisfy target containment |
| Sandboxed iframe in shell | May separate DOM/origin, but iframe sandboxing alone does not prove independent CPU termination, native caller identity or egress denial | Not selected; no desktop containment claim without probes |
| Separate nonpersistent WKWebViews + native broker checks + CSP | P02a proved process separation/stop and storage boundaries on macOS 15.6.1; UDP escape and broad app-command defaults were reproduced | Insufficient as tested |
| Separate views with native engine controls and native command restrictions | P02b1 closes WebRTC/application-command routes; P02b2a demonstrates scoped internal channel fetch and playback, but preconnect still escapes | Current settings rejected; test pre-creation network restrictions, then embedding, budgets and SPI/platform support before selecting the topology |
| Bundled sandboxed helper process | Can offer an additional OS-level boundary, but media, UI embedding, inherited IPC and WebKit network-process behavior need validation | Alternative if view-level enforcement cannot meet the design; not arbitrary package-supplied native execution |
| Restricted JS worker/runtime with host-rendered UI | Worker termination is useful, but unrestricted React/DOM pages would need a different UI protocol and permissions model | Additional complexity; not a drop-in substitute for the accepted package experience |

## Decisions still required

- Close P02b2a's preconnect escape at a native enforcement point and repeat its HTTP, frame, worker,
  form, navigation and connection controls. DNS-prefetch's native getter is false on this engine;
  the localhost element is not a DNS packet test. Prefetch had no positive control traffic, and
  service-worker registration is unsupported for the custom scheme even in the permissive view.
  Keep these distinctions visible rather than labeling unavailable paths as policy passes.
- Deny package calls to all application/core/plugin commands except the narrow broker. Native caller
  identity must come from the receiving runtime, never a supplied package ID.
  P02b1's application dispatcher does not intercept core/plugin commands. Those use Tauri ACLs;
  P02b2a now covers pending channel fetch across views; recheck queue lifetime/generation behavior
  in the production transport and audit remaining internal exceptions before claiming complete
  native denial in R02. No production application or third-party plugins run in the probe.
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

WebKit declares `_setPeerConnectionEnabled:` in its private preferences header. The P02b1 experiment
checks selector availability, writes the setting and checks it before loading any package page.
Its absent-selector control stays blank. This does not make the SPI a stable public contract or
establish support on another OS release. P02b2 must decide whether to support a narrowly tested
fail-closed engine path or require another topology; no silent CSP-only fallback is acceptable.
[WebKit private preferences](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKPreferencesPrivate.h)

## Consequences

P02 and K0 stay pending. C01–C09 do not begin until a feasible path is established. The executable,
fixtures, raw synthetic events and rejection reasons remain available for regression and comparison.
Any eventual topology decision must replace this provisional decision with measured evidence and
preserve the original toolbox invariants.
