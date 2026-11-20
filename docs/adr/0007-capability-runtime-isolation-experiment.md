# ADR 0007: Capability runtime isolation experiment

- Status: proposed; topology selection pending P02b
- Date: 2026-11-20
- Design authority: [Capability platform, runtime policy](../capability-platform-design.md#8-runtime-policy-and-limits)
- Evidence: [P02a desktop experiment](../capability-platform-evidence/P02a.md)
  and [P02b1 native controls](../capability-platform-evidence/P02b1.md),
  extended by [P02b2a channels and playback](../capability-platform-evidence/P02b2a.md)
  and [P02b2b1 pre-creation controls](../capability-platform-evidence/P02b2b1.md)
  plus [P02b2b2a same-window integration](../capability-platform-evidence/P02b2b2a.md)
  and [P02c bounded operation admission](../capability-platform-evidence/P02c.md)
  plus [P02d1 retained byte budgets](../capability-platform-evidence/P02d1.md)
  and [P02d2 shared and live resource budgets](../capability-platform-evidence/P02d2.md)

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
existing trusted-only loader unchanged while P02b completes the supported-topology and budget decision. Do not expose new
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

P02b2b1 closes the reproduced preconnect route on the tested engine by applying native restrictions
before creating the WebView: an empty allowed-network-host set, disabled network subresources,
disabled peer connections and disabled DNS prefetch. The supplied configuration explicitly owns a
new nonpersistent store; Wry's separate incognito option does not override a supplied configuration.
Getter checks must pass before package navigation; unavailable controls leave the view blank.
Restricted shell/A/B recorded no HTTP, UDP or preconnect traffic, including B with CSP deliberately
omitted as a native-only negative control. The permissive control recorded thirteen HTTP routes,
eight UDP packets and one preconnect. Local assets, IPC, independent storage, advancing playback,
pause/release and independent destruction still worked. This is scoped desktop evidence, not a
complete egress audit or a production topology decision. P02b2b2 remains required.

P02b2b2a verifies shell/A/B as child webviews of one native host window. Native caller identity
remains the individual view; a core title-change grant scoped to the shell view succeeds for shell
and is refused for A/B in that same window. The network, storage and pending-channel probes retain
their scoped results. A's audio advances while its view is hidden; after an intentional loop,
closing A removes its WebContent process while the host and B remain usable. This is a feasible
fixed-pane integration experiment, not production layout or full resource-budget acceptance.

P02c adds native operation admission in the disposable probe: 64 KiB per request, four operations
per caller, six globally and 256 KiB of admitted payloads globally, with immediate capacity refusal.
Two real same-window callers reach both aggregate peaks; accepted responses are exact, errors
return capacity, subsequent calls succeed and the host remains usable. These are prototype quotas.
Tauri has already allocated/decoded the payload when admission runs; this does not bound transport
memory or sustained flooding. Explicit future-abort release has a unit test, but view removal is
not yet wired to native-operation cancellation. Fairness is unproven. P02d/P02e retain the remaining
resource policies and topology decision; this slice does not clear P02 or K0.

P02d1 measures candidate file-content limits using real ZIP decompression and a fresh single-writer
disk store: 32 MiB compressed / 64 MiB expanded / 16 MiB per archive entry / 256 entries; private
values of 256 KiB within 16 MiB and 256 keys; 64 MiB binary items written in 64 KiB chunks within a
128 MiB retained-plus-staged store. Exact boundaries, denial, byte readback and ordinary rollback
pass. Replacement accounting includes the old value until commit. These are experimental logical
content limits, not filesystem-allocation or process-memory bounds. P02d2 still owns aggregate
reservations across stores, queues, runs and live service resources; production persistence,
authorization and crash recovery remain assigned to R01–R03/R07/R11.

P02d2 completes the scoped budget experiment with shared retained/staged file reservations, bounded
event payloads that remain charged after delivery, and real async task/native stream ownership.
Private stores share 64 MiB; binary stores share 256 MiB; both cap object/store/writer counts.
Events cap at 16 KiB each, 64/256 KiB per owner and 128/512 KiB globally. Runs cap at two per owner /
four globally; services at one / two. Real contention, failure and stop checks pass, including native
stream EOF and an unaffected peer's echo. Counts are tied to actual owned data/handles, but this is
not a durable production manager, agent cancellation guarantee or total-memory bound. P02e must
resolve the pre-admission transport boundary and supported runtime policy before K0. File chunks
also need encoding/envelope-aware sizing before mapping them onto the public IPC contract.

The extended fixture demonstrated actual silent-audio playback advancing while its window lost
focus, followed by pause and empty media state. It did not prove audible output, arbitrary codec
support, seamless looping/seek, service lifetime across page destruction, or native descriptor cleanup.

## Alternatives under evaluation

| Arrangement | Evidence or constraint | Current disposition |
|---|---|---|
| Existing shared renderer | Package code shares shell authority, DOM and execution environment | Remains explicitly trusted-only; cannot satisfy target containment |
| Sandboxed iframe in shell | May separate DOM/origin, but iframe sandboxing alone does not prove independent CPU termination, native caller identity or egress denial | Not selected; no desktop containment claim without probes |
| Separate nonpersistent WKWebViews + native broker checks + CSP | P02a proved process separation/stop and storage boundaries on macOS 15.6.1; UDP escape and broad app-command defaults were reproduced | Insufficient as tested |
| Separate views with native engine controls and native command restrictions | P02b2b1 closes measured preconnect; P02b2b2a preserves scoped boundaries and independent stop inside one host window | Candidate only; resource budgets and SPI/platform support remain decision gates |
| Bundled sandboxed helper process | Can offer an additional OS-level boundary, but media, UI embedding, inherited IPC and WebKit network-process behavior need validation | Alternative if view-level enforcement cannot meet the design; not arbitrary package-supplied native execution |
| Restricted JS worker/runtime with host-rendered UI | Worker termination is useful, but unrestricted React/DOM pages would need a different UI protocol and permissions model | Additional complexity; not a drop-in substitute for the accepted package experience |

## Decisions still required

- Preserve P02b2b1's native enforcement and repeat its HTTP, frame, worker, form, navigation and
  connection controls in the integrated arrangement. DNS-prefetch's native getter is false on this engine;
  the localhost element is not a DNS packet test. Prefetch had no positive control traffic, and
  service-worker registration is unsupported for the custom scheme even in the permissive view.
  Keep these distinctions visible rather than labeling unavailable paths as policy passes.
  WebTransport and WebSocketStream are unavailable in every tested view, including the permissive
  control; their containment is unverified. Revalidate new engine features before adding support.
- Deny package calls to all application/core/plugin commands except the narrow broker. Native caller
  identity must come from the receiving runtime, never a supplied package ID.
  P02b1's application dispatcher does not intercept core/plugin commands. Those use Tauri ACLs;
  P02b2a now covers pending channel fetch across views; recheck queue lifetime/generation behavior
  in the production transport and audit remaining internal exceptions before claiming complete
  native denial in R02. No production application or third-party plugins run in the probe.
- Carry P02b2b2a's same-window results into production integration: scope native identity and grants
  by webview, not its containing window. Tauri child views require the opt-in unstable feature;
  production resize, modal/focus/IME behavior and service lifetime across page destruction remain
  implementation work. Private process IDs remain diagnostic, never the termination mechanism.
- Reconcile P02d's measured byte/object/task limits with the full runtime in P02e and retain their
  production owners and recovery obligations. P02c supplies measured operation admission, but its
  64 KiB payload check excludes the IPC envelope
  and runs after deserialization. Neither that guard nor the finite load fixture establishes a
  pre-admission allocation bound, sustained-flood containment or fair scheduling.
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
