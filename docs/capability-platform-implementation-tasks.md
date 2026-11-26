# Capability platform task checklist

Execution rules, verification codes and code-owner map: [implementation plan](capability-platform-implementation-plan.md).
Behavior and M1–M8 acceptance definitions: [approved design](capability-platform-design.md).

Implementation is underway. Checked entries require linked evidence; writing a plan does not
complete a task. Default order is top to bottom; explicit dependencies and intervening checkpoints
must pass. S/M are target slice sizes, not duration estimates. File lists identify the initial
footprint; apply the plan's splitting rule if inspection reveals more work. Each public change also
updates the canonical contract, exported kit/Skill and its receipt as part of the same delivery.

## Preparation: reproducible inputs and early feasibility

### [x] P00 — Establish baseline fixtures and an isolated desktop profile

**State:** complete on 2026-11-20; `codex/capability-platform-design`, [PR #38](https://github.com/T-X-R/nooki/pull/38), pending human merge.
Split into P00a and P00b below because isolation spans native and webview storage plus agent configuration.
Evidence: [P00 verification receipt](capability-platform-evidence/P00.md). The discovered WebKit
store-sharing defect was repaired and reverified with two fresh profiles, restart, uninstall/reinstall,
retained documents, independent counters and isolated Skill installation. Synthetic cleanup completed.

**Depends on:** None. **Size:** M.
**Deliver:** A repeatable test-profile launch procedure and a recorded baseline inventory of package,
board/Goals, agent, grant and data owners. Use synthetic data, not the user's ordinary Library.
**Acceptance:** Legacy ZIP import/restart/uninstall has a reproducible fixture; profile writes do not
reach ordinary app or agent configuration; current tests and any pre-existing failures are recorded.
**Likely files:** New profile helper under `scripts/`, `src-tauri/src/lib.rs` only if profile routing
needs support, profile-isolation test, baseline receipt, fixture manifest.
**Verification:** V-P, V-K, existing relevant V-B/V-A, V-N profile separation. Report real-agent setup
separately; never copy credentials into the fixture.

### [x] P00a — Establish an isolated desktop launch environment

**Depends on:** None. **Size:** M.
**State:** complete; automated and repaired native isolation/restart checks passed. See [P00 evidence](capability-platform-evidence/P00.md).
**Deliver:** A launcher that creates an empty profile, launches with isolated agent configuration,
and configures native data/log paths and a separate persistent webview store before startup.
**Acceptance:** Normal startup is unchanged; malformed profiles fail closed; profiles survive restart
without sharing native state or browser storage; no ordinary credentials/settings are copied.
**Likely files:** Profile launcher/test, native profile module/test, lib startup and pet webview wiring.
**Verification:** Launcher tests, native configuration tests, V-APP and V-N profile separation.

### [x] P00b — Record baseline owners and the real archive lifecycle

**Depends on:** P00a. **Size:** S.
**State:** complete; baseline inventory, fixture, lifecycle and cleanup evidence recorded in [P00](capability-platform-evidence/P00.md).
**Deliver:** Synthetic legacy archive fixture, owner inventory and reproducible desktop procedure.
**Acceptance:** Import/restart/uninstall preserves expected output inside the isolated profile;
focused baseline results and limitations are recorded; no mock is presented as native evidence.
**Likely files:** Fixture manifest/entry, baseline receipt and verification instructions.
**Verification:** V-P/V-K/V-B/V-A and V-N using the archive in two isolated desktop profiles.

### [x] P01 — Export the minimal public contract and development harness

**State:** complete on 2026-11-20; same branch and PR #38, pending human merge.
Evidence: [P01 verification receipt](capability-platform-evidence/P01.md). Kit 0.2.0 has a deterministic
storage/environment preview Host, explicit desktop-only errors and supported entrypoint types; the
exported ZIP scaffold passed independent dependency installation, tests, check/pack and browser checks.
Future board/chat/agent service definitions ship with C01–C08, not as successful stubs.

**Depends on:** P00. **Size:** M.
**Deliver:** Canonical definitions for the first workflow and a kit that exposes only implemented
operations, with a deterministic test Host. Reuse the existing generator and starter.
**Acceptance:** An outside-checkout project checks and packs with the exported kit; unsupported methods
are unavailable rather than successful stubs; simulated data/services are visibly labeled.
**Likely files:** `packages/capability-contract/src/index.ts`, `scripts/build-capability-kit.mjs`, starter
preview Host, starter check script, `tests/developer-kit.test.ts`.
**Verification:** V-K and independent scaffold/check/pack; document exact Host/API version in receipt.

### [x] P02 — Prove the runtime isolation approach before committing to transport

**State:** verified on 2026-11-20; [combined evidence, budget and support decision](capability-platform-evidence/P02.md),
[ADR 0007](adr/0007-capability-runtime-isolation-experiment.md), same branch and PR #38, pending human merge.
Scoped macOS feasibility is accepted; production integration and native requalification remain R02/R03/K4.
The [latest resumed native check](capability-platform-evidence/P02-resume.md) passes channel ownership,
both receive boundaries, removal during pressure, hidden playback/release and infinite-loop removal.
It preserves the prototype/production distinction and does not advance later gates.
The [latest continuation attempt](capability-platform-evidence/P02-attempt.md) could not acquire
native desktop control and ended at the probe watchdog. It adds no interactive pass and does not
change the earlier feasibility result.

**Depends on:** P00, P01. **Size:** M, bounded experiment.
**Deliver:** A disposable desktop probe and runtime ADR comparing viable isolation arrangements;
select a supported approach or record why none meets the design. Do not replace the loader yet.
**Acceptance:** Probe shell/DOM/storage/native-bridge access, spoofed caller, unapproved egress and
infinite-loop termination; measure asset/media/IPC constraints and initial budgets; record actual OS
coverage and remaining integration risks rather than claim production isolation.
**Likely files:** New isolated probe, hostile fixture, media fixture, probe test, runtime ADR.
**Verification:** V-N on the actual desktop engine; retain reproducible probe steps and results.

### [x] P02a — Measure separate-webview boundaries with a disposable desktop probe

**State:** verified on 2026-11-20; [native receipt](capability-platform-evidence/P02a.md).
The experiment passed execution/measurement acceptance, but the candidate failed UDP containment.
The baseline failure remains retained; subsequent repairs and final acceptance are linked from P02.
Same branch and PR #38, pending human merge.

**Depends on:** P00, P01. **Size:** M, bounded experiment.
**Deliver:** Standalone probe executable, hostile/static/media fixtures and local-only network receiver.
**Acceptance:** Real engine reports native caller binding, DOM/storage separation, denied native/egress
attempts and host/peer responsiveness while one fixture is unresponsive; failures stay visible.
**Likely files:** Native probe example and configuration, fixture HTML/script, focused probe tests.
**Verification:** Focused tests plus the real desktop probe, isolated data paths and synthetic inputs.

### [x] P02b — Decide topology and budgets from measured constraints

**State:** verified on 2026-11-20; [combined evidence, budget and support decision](capability-platform-evidence/P02.md),
[ADR 0007](adr/0007-capability-runtime-isolation-experiment.md), same branch and PR #38, pending human merge.
Scoped macOS feasibility is accepted; production integration and native requalification remain R02/R03/K4.

**Depends on:** P02a. **Size:** S.
**Deliver:** Runtime ADR comparing viable alternatives and evidence receipt with initial limits.
**Acceptance:** Identify a feasible approach or concrete unmet invariants; include media/assets/IPC,
termination and network results, tested OS scope, remaining production-integration risks and next step.
**Likely files:** Runtime ADR, P02 receipt, probe refinements only where needed to resolve findings.
**Verification:** V-N repeatable probes; K0 stays pending if any design invariant lacks a feasible path.

### [x] P02b1 — Reprobe native command denial and engine-level egress controls

**State:** verified on 2026-11-20; [native receipt](capability-platform-evidence/P02b1.md),
same branch and PR #38, pending human merge. The reproduced app-command and WebRTC routes are
closed in this probe; subsequent SPI/channel/budget work is reconciled in the final P02 receipt.

**Depends on:** P02a. **Size:** M, bounded experiment.
**Deliver:** Restrict package application commands at native dispatch and configure the engine before
package navigation; retain an unrestricted synthetic control and receiver positive controls.
**Acceptance:** Previously reachable app commands fail for package callers while allowed RPC works;
WebRTC receiver evidence shows whether the engine control closes UDP; unsupported native controls
prevent package loading. Record private-API and remaining network-coverage limitations explicitly.
**Likely files:** Native probe, probe policy/test, hostile fixture, evidence receipt and runtime ADR.
**Verification:** Focused policy tests and V-N on the actual desktop engine, preserving failed traces.

### [x] P02b2 — Resolve the remaining runtime arrangement and resource budgets

**State:** verified on 2026-11-20; [combined evidence, budget and support decision](capability-platform-evidence/P02.md),
[ADR 0007](adr/0007-capability-runtime-isolation-experiment.md), same branch and PR #38, pending human merge.
Scoped macOS feasibility is accepted; production integration and native requalification remain R02/R03/K4.

**Depends on:** P02b1. **Size:** M, split further if needed.
**Deliver:** Measured embedding/navigation, playback/cleanup, extended network probes and limits;
an evidence-backed topology decision with support/failure policy.
**Acceptance:** All P02 invariants have a feasible path, or each unresolved invariant is recorded with
the next experiment; private API availability alone is not a supported-platform guarantee.
**Likely files:** Probe fixtures/adapters, focused tests, P02 receipt and runtime ADR.
**Verification:** V-N including actual playback and forced termination; K0 remains pending on failure.

### [x] P02b2a — Measure additional browser channels and actual media lifecycle

**State:** measurements verified on 2026-11-20; [receipt and raw events](capability-platform-evidence/P02b2a.md),
same branch and PR #38, pending human merge. Preconnect escaped the settings measured here;
P02b2b1 closes that reproduced route while retaining this failed baseline. Playback/pause and
pending-channel scope have real desktop evidence.

**Depends on:** P02b1. **Size:** M, bounded experiment.
**Deliver:** Receiver-attributed frame/worker/form/navigation/preconnect probes and user-gesture
audio playback/pause/release controls; inspect framework-internal IPC scope and DNS-prefetch policy.
**Acceptance:** Distinguish positive controls, denied attempts and unavailable coverage; playback
advances and pause/release are observable; any newly discovered escape remains a failed invariant.
**Likely files:** Native probe, existing fixture HTML/script, extended fixture script and native tests.
**Verification:** V-N with synthetic local receivers and audio, plus focused probe tests; record exact
scope rather than claiming all network APIs from a small sample.

### [x] P02b2b — Select the supported arrangement and bounded operating limits

**State:** verified on 2026-11-20; [combined evidence, budget and support decision](capability-platform-evidence/P02.md),
[ADR 0007](adr/0007-capability-runtime-isolation-experiment.md), same branch and PR #38, pending human merge.
Scoped macOS feasibility is accepted; production integration and native requalification remain R02/R03/K4.

**Depends on:** P02b2a. **Size:** M, split experiments further only if necessary.
**Deliver:** Resolve remaining measured escapes, validate page integration and representative resource
limits, and update the runtime ADR with the selected topology and fail-closed compatibility policy.
**Acceptance:** A feasible path covers every P02 invariant, with measured limits for resource types,
explicit SPI/platform trade-offs and production-integration work assigned to R01–R03.
**Likely files:** Probe adapters/fixtures, limit tests, P02 receipt and runtime ADR.
**Verification:** V-N and representative boundary/failure loads; no unlimited defaults or unsupported
platform claims. P02 and K0 stay pending until their complete acceptance is evidenced.

### [x] P02b2b1 — Close preconnect before WebView creation

**State:** verified on 2026-11-20; [receipt and raw events](capability-platform-evidence/P02b2b1.md),
same branch and PR #38, pending human merge. Pre-creation controls close measured preconnect/HTTP/UDP
routes with and without CSP; local resources, playback, IPC and independent stop remain functional.
Private SPI support, integrated-page behavior and full resource budgets remain P02b2b2 work.

**Depends on:** P02b2a. **Size:** M, bounded experiment.
**Deliver:** Explicit per-view native configuration with isolated stores and checked network controls;
repeat the previously failing receiver probes and media/IPC/storage checks.
**Acceptance:** The restricted view has no observed preconnect escape with a working permissive
control; unavailable controls refuse package loading; record behavior with and without CSP separately.
**Likely files:** Probe native configuration module, probe executable/fixture, Cargo test dependencies
and lockfile. These dependencies are already transitive and stay outside the production dependency set.
**Verification:** Focused tests and V-N, preserving P02b2a's failed evidence; update the ADR without
claiming untested engine compatibility or a completed runtime decision.

### [x] P02b2b2 — Validate integration and resource bounds, then decide topology

**State:** verified on 2026-11-20; [combined evidence, budget and support decision](capability-platform-evidence/P02.md),
[ADR 0007](adr/0007-capability-runtime-isolation-experiment.md), same branch and PR #38, pending human merge.
Scoped macOS feasibility is accepted; production integration and native requalification remain R02/R03/K4.

**Depends on:** P02b2b1. **Size:** M, split further if actual footprint requires it.
**Deliver:** Integrated-page experiment, measured bounded resource policies and final P02 decision.
**Acceptance:** Host management remains usable with hostile package code; all required resource types
have bounded initial limits and error behavior; support and SPI failure policies match real evidence.
**Likely files:** Probe integration adapter, resource-limit fixture/tests, P02 receipt and runtime ADR.
**Verification:** V-N plus representative boundary loads; reconcile every P02 invariant before K0.

### [x] P02b2b2a — Verify isolated child views inside one host window

**State:** verified on 2026-11-20 after desktop-tool access recovered;
[receipt and raw events](capability-platform-evidence/P02b2b2a.md), same branch and PR #38,
pending human merge. Native view identity and view-scoped permissions hold inside one window;
network controls, hidden playback and independent child termination pass their measured cases.
The failed title-command positive control was corrected and rerun; its trace remains retained.
The later resource/support decision is recorded in the final P02 receipt.
Current-source revalidation after the user reported unlocking also passes: see the
[2026-11-20 unlocked-desktop receipt](capability-platform-evidence/P02-unlocked.md).
It repeats channel ownership, hidden playback/release, loop removal, receive limits and removal
during finite pressure; the first run's incomplete receive result is retained, and a separate run
provides both complete package results. Production integration remains pending.
The [subsequent same-window recheck](capability-platform-evidence/P02-recheck.md) retains two more
native runs: 124/124 peer calls around pressure removal, zero reserved receive resources afterward,
and separate uncapped evidence for hidden playback, both media releases and infinite-loop removal.
The pressure trace reaches its 256-event cap; conclusions are restricted to retained samples.
The [resumed verification](capability-platform-evidence/P02-resume.md) adds fresh 256/45-event runs:
removal 21,232 ms into pressure, 112/112 retained peer successes, zero post-removal reservations,
and uncapped hidden-media/release/loop-removal evidence. Eleven probe tests and the committed-source
desktop rebuild/reinstall pass. Unfinished C02b changes are excluded; later gates remain pending.
The [continued native acceptance](capability-platform-evidence/P02-continued.md) adds two fresh
256/45-event runs on the unchanged probe: removal 9,140 ms into pressure, 132/132 retained peer
successes, zero post-removal reservations, hidden playback/release and independent loop removal.
Eleven probe tests and the `ca1a57e` desktop rebuild/reinstall pass; unfinished C03a changes are
preserved and excluded from that build. The collector cap and production acceptance limits remain.

**Depends on:** P02b2b1. **Size:** M, bounded experiment.
**Deliver:** Opt-in embedded probe using native Webview caller identity, view-scoped core permissions,
host-controlled page switching and independent child removal. Preserve the separate-window control.
**Acceptance:** A/B share the host window but cannot use its command grants or storage; network
controls and pending-channel ownership still hold; hidden-page playback and hostile-child termination
leave host management and the other page usable. Record actual API/platform limitations.
**Likely files:** Probe executable, fixture HTML/script, probe configuration/policy, opt-in Cargo feature.
**Verification:** Focused policy tests, both probe builds, V-N including a positive shell permission
control, page switching, playback, network receiver controls and child process exit.

### [x] P02b2b2b — Measure resource bounds and record the supported topology

**State:** verified on 2026-11-20; [combined evidence, budget and support decision](capability-platform-evidence/P02.md),
[ADR 0007](adr/0007-capability-runtime-isolation-experiment.md), same branch and PR #38, pending human merge.
Scoped macOS feasibility is accepted; production integration and native requalification remain R02/R03/K4.

**Depends on:** P02b2b2a. **Size:** M; split only if the actual scope requires it.
**Deliver:** Representative boundary-load fixtures, initial limits for required resource classes,
and a supported-engine/failure policy with explicit production integration work.
**Acceptance:** Reconcile all P02 invariants with evidence; do not equate message size with memory
containment or a successful private selector with broad engine support. No unlimited defaults.
**Likely files:** Probe budget fixture/tests, P02 receipt, runtime ADR and compatibility decisions.
**Verification:** Boundary/failure loads and desktop responsiveness; complete P02/K0 only if every
parent acceptance item has a feasible and documented path.

### [x] P02c — Measure bounded IPC admission under concurrent load

**State:** verified on 2026-11-20; [receipt and raw events](capability-platform-evidence/P02c.md),
same branch and PR #38, pending human merge. Two same-window callers reach six operations and
256 KiB admitted payloads; excess work is refused, checksums and post-failure recovery pass,
and final capacity is zero. Explicit future-abort release is unit-tested, not inferred from view
closure. This admission slice alone does not bound pre-dispatch allocation or prove fairness;
P02e2/P02e3 and the final P02 receipt record the receive boundary and decision.

**Depends on:** P02b2b2a. **Size:** M, bounded experiment.
**Deliver:** Native caller-scoped admission with per-request, per-caller and aggregate in-flight
limits, immediate overload rejection, and a synthetic concurrent desktop fixture.
**Acceptance:** Boundary-sized work succeeds; oversized/over-capacity work fails without entering
the measured operation; permits release on success/error/cancellation; peers and host management
stay responsive during load. Record transport allocation limits separately from admitted work.
**Likely files:** Probe admission module/tests, native load command, load fixture, probe controls.
**Verification:** Deterministic saturation/release tests and V-N with two callers and real IPC.

### [x] P02d — Measure retained-resource budgets with representative fixtures

**State:** verified on 2026-11-20 through P02d1 and P02d2; [combined budget table and evidence](capability-platform-evidence/P02d2.md).
The scoped native experiments cover archive/byte storage, shared disk reservations, queued/delivered
events and live task/service ownership. Production adapters and durable recovery remain assigned to
their owners. The final P02 receipt reconciles transport allocation and scoped runtime support.

**Depends on:** P02c. **Size:** M; split only if actual scope requires it.
**Deliver:** Boundary-load evidence and proposed limits for archive expansion, private storage,
binary transfer, queued events, concurrent runs and live service handles, with explicit owning
production tasks. Use actual bounded data and ownership cleanup rather than counters alone.
**Acceptance:** Rejection preserves previous state; released/cancelled work returns capacity;
representative assets fit; every resource has a bounded policy and an implementation/verification owner.
**Likely files:** Resource-load fixture, probe resource owner/tests, budget evidence table.
**Verification:** Boundary and failure cases with measured data sizes; distinguish prototype
enforcement from services to be delivered in C01–T08.

### [x] P02d1 — Measure archive expansion and staged byte storage

**State:** verified on 2026-11-20; [receipt and measurements](capability-platform-evidence/P02d1.md),
same branch and PR #38, pending human merge. Real ZIP/file boundaries, byte readback, replacement
preservation and ordinary staging cleanup pass. This single-writer experiment does not establish
profile-wide reservations, crash recovery or production transfer semantics. P02d2 adds shared
reservations; the final P02 decision retains the production recovery/transfer obligations.

**Depends on:** P02c. **Size:** M.
**Deliver:** Disposable native archive reader and disk-backed private-data/transfer fixtures with
bounded entries, bytes and chunks. Record values, representative asset sizes and production owners.
**Acceptance:** Exact boundaries pass, overflow fails, failed replacement preserves old bytes,
incomplete/cancelled staging publishes nothing, and removal returns usable capacity. No whole-file
IPC or process-memory bound is inferred from a streamed file experiment.
**Verification:** Real ZIP decompression and temporary-file writes/readback, corruption/failure cases,
native tests and reproducible machine-readable measurements.

### [x] P02d2 — Measure retained execution and event ownership

**State:** verified on 2026-11-20; [receipt and raw measurements](capability-platform-evidence/P02d2.md),
same branch and PR #38, pending human merge. Shared file reservations, cross-thread contention,
charged delivered payloads, async stop and real native-service EOF/peer operation pass. Eight tests
pass; no production runtime/configuration change. The receipt records durability, authentication,
transport-memory and noncooperative-provider limits for P02e and implementation owners.

**Depends on:** P02d1. **Size:** M.
**Deliver:** Bounded real event payloads, concurrent task ownership and live service handles with
per-package/global accounting, stop cleanup and proposed limits assigned to production tasks.
Reconcile profile-wide retained-data/staging limits across the independent stores measured in P02d1;
a bound on one fixture store does not cap an arbitrary number of package stores.
**Acceptance:** Overload leaves existing work intact; cancellation/stop reclaims actual resources;
event delivery is bounded with explicit overflow semantics. Reconcile all P02d resource classes.
**Verification:** Native concurrent boundary/failure fixtures; actual data/handle ownership, not
successful counters alone. Repeat relevant desktop checks when changing the runtime integration.

### [x] P02e — Reconcile runtime evidence and decide supported topology

**State:** verified on 2026-11-20; [combined evidence, budget and support decision](capability-platform-evidence/P02.md),
[ADR 0007](adr/0007-capability-runtime-isolation-experiment.md), same branch and PR #38, pending human merge.
Scoped macOS feasibility is accepted; production integration and native requalification remain R02/R03/K4.

**Depends on:** P02c, P02d. **Size:** S.
**Deliver:** Final P02 receipt, supported OS/engine and fail-closed policy, updated runtime ADR,
and explicit production integration/compatibility requirements.
**Acceptance:** Every parent invariant has evidence and a feasible path; no hard memory-containment
claim from a payload check, no platform parity inferred, and no silent fallback to a weaker boundary.
**Likely files:** Runtime ADR, P02 receipt, checklist and support/budget decisions.
**Verification:** Audit P02 and K0 against all receipts; retain unresolved invariants as pending.

### [x] P02e1 — Audit transport allocation and reproduce pre-admission requests

**State:** verified on 2026-11-20; [audit and native evidence](capability-platform-evidence/P02e1.md).
Two same-window callers deliver 1 MiB to decoded application dispatch and to the resource-protocol
handler before command denial/HTTP 403. This is a reproduced receive-boundary gap, not an OOM test
or a runtime acceptance pass. Subsequent receive repairs and the final P02 decision preserve this failed baseline.

**Depends on:** P02c, P02d. **Deliver:** Pinned receive-path audit, finite native reproduction and
requirement/evidence matrix. **Acceptance:** Distinguish operation admission from prior framework
allocation; preserve the failed boundary and identify the next owning enforcement layer.
**Verification:** Native command/asset negative requests with recorded byte counts and final denial,
responsive host status, focused probe tests and exact engine scope.

### [x] P02e2 — Bound receiving paths before selecting the production transport

**State:** scoped experiment verified on 2026-11-20; [receipt and 110 native events](capability-platform-evidence/P02e2.md).
Pre-registered native handlers bound package IPC/resource copies before decode, with the native
post-message fallback removed. Both callers reject oversized requests, cancel safely and recover;
normal media and independent child removal pass. No dependency fork or method swizzling. This is
not a hard WebKit/native memory bound or a production transport approval; P02e3 and the final P02
receipt separately record the stop-under-pressure case and scoped feasibility selection.

**Depends on:** P02e1. **Size:** M; split if the chosen source-level change requires it.
**Deliver:** A disposable receive-boundary experiment covering native post-message and all exposed
custom protocols, or an alternative arrangement that closes their bypasses. Prefer the smallest
auditable integration; do not introduce runtime method swizzling or silently weaken isolation.
**Acceptance:** Size/rate/queue policy applies before Nooki-controlled unbounded copy or decoding;
include asset methods, URLs/headers, streamed bodies, malformed data and cancellation. Account
separately for WebKit/native allocations already made before callbacks. If that still violates the
host-availability invariant, retain the failure and evaluate a stronger arrangement.
**Verification:** Small valid calls/assets still work; oversized/overload routes fail at the intended
boundary on the desktop with source-backed instrumentation; native identity and independent stop
remain valid. Preserve P02e1's baseline. No hard RSS bound inferred from a length check.

### [x] P02e3 — Record the complete feasibility and support decision

**State:** verified on 2026-11-20; [combined evidence, budget and support decision](capability-platform-evidence/P02.md),
[ADR 0007](adr/0007-capability-runtime-isolation-experiment.md), same branch and PR #38, pending human merge.
Scoped macOS feasibility is accepted; production integration and native requalification remain R02/R03/K4.

**Depends on:** P02e2. **Size:** S.
**Deliver:** Final P02 receipt and runtime ADR, including encoding-aware wire/chunk budgets,
tested-engine support, unavailable-control behavior and production owners for each boundary.
**Acceptance:** Every P02 invariant has evidence and a feasible path. Keep K0 closed when the
receive-boundary or another required property is unresolved; unsupported engines fail closed for
the new runtime without making ordinary retained user data inaccessible.
**Verification:** Reconcile the complete P02 evidence matrix and current source before checking
P02e, its parents or K0. Production gates still require the actual application implementations.

### [x] P02e3a — Stop a sender during finite receive rejection pressure

**State:** verified on 2026-11-20; [native receipt and 190 events](capability-platform-evidence/P02e3a.md).
The shell removes A during rising refusals; B succeeds before/after removal; reservations return to zero.

**Depends on:** P02e2. **Size:** S.
**Deliver:** A finite bounded-concurrency sender, sampled refusal diagnostics with total counters,
and a peer doing valid operations while the shell independently removes the sender.
**Acceptance:** Refusal counts rise during the workload; shell disable works while pressure is active;
peer operations continue/recover and receive reservations return to zero. No OOM or hard RSS claim.
**Verification:** Native same-window run, explicit maximum duration/request count, normal quit,
focused probe tests and retained events. Correct P02e2's diagnostic-vector wording: record already
caps at 256 events; pressure sampling prevents low-value refusals exhausting that evidence capacity.

### [x] P02e3b — Select the scoped feasibility path and compose its limits

**State:** verified on 2026-11-20; [combined evidence, budget and support decision](capability-platform-evidence/P02.md),
[ADR 0007](adr/0007-capability-runtime-isolation-experiment.md), same branch and PR #38, pending human merge.
Scoped macOS feasibility is accepted; production integration and native requalification remain R02/R03/K4.

**Depends on:** P02e3a. **Size:** S.
**Deliver:** P02 receipt and updated ADR with one wire/chunk policy, exact tested engine support,
required controls, fail-closed activation and explicit production owners.
**Acceptance:** Every P02 condition has measured evidence or an identified production integration
obligation consistent with the design. Do not equate a feasibility choice with production isolation.
**Verification:** Reconcile P02 receipts and inspect native source assumptions; assert encoded chunk
plus bounded serialized envelope fits the receive limit; preserve historical failures and limits.

### [x] K0 — Preparation gate

**State:** verified on 2026-11-20; [requirement-by-requirement preparation audit](capability-platform-evidence/P02.md).
P00/P01/P02 evidence reconciled. C01 is now verified below; C02 is next. No production runtime or later gate is marked complete.

**Depends on:** P00, P01, P02.
**Verify:** Baseline is reproducible, the minimal external-project path works, and a feasible runtime
approach is recorded. No source/credential leakage between profiles. Unresolved feasibility failures
block production runtime promises; reconcile them before freezing transport-dependent contracts.

## Phase 1: one complete meeting workflow through public services

### [x] C01 — Bind a Host mutation to invocation identity and scoped authority

**State:** verified on 2026-11-20 through C01a–C01c; [public delivery and combined acceptance](capability-platform-evidence/C01c2.md).
Native authority/receipt tests and real exported archives cover creation/replay/conflict, denied
permission, lifecycle closure and restart. Legacy packages remain trusted-only. Same branch and
PR #38, pending human merge; C02/C03 and K1 remain pending.

**Depends on:** P01, P02. **Size:** M.
**Deliver:** The authority context and durable idempotency receipt used by the first board mutation,
including activation identity and operation/resource scope. Do not build unrelated policy engines.
**Acceptance:** A forged owner/scope fails at the authoritative operation; repeated key/payload returns
the same result while changed payload conflicts; revoked or old-generation calls cannot commit.
**Likely files:** New native capability-authority module and tests, `src/platform/capability-host.ts`,
`src/platform/capability-broker.ts`, canonical contract.
**Verification:** New authority/receipt tests plus V-P. Record that the legacy runtime remains trusted-only;
protocol-level checks here do not prove isolation from arbitrary same-realm code.

### [x] C01a — Bind native invocation handles to installation generations

**State:** verified on 2026-11-20; [native implementation and regression receipt](capability-platform-evidence/C01a.md).
Generation-bound handles and lifecycle invalidation are integrated. C01a added no package-callable
endpoint; C01b/C01c below now complete the public path. Same branch and PR #38, pending human merge.

**Depends on:** P02. **Size:** M.
**Deliver:** A bounded native authority store and installation-generation tracking, integrated with
install/update/disable/uninstall. This is host-controller infrastructure, not a new package API.
**Acceptance:** Handles bind actual native caller, package/version, generation and the first board
operation/resource scope; forged/unknown handles and stale generations fail; revocation is serialized
with the synchronous effect check. Restart never restores live invocation handles.
**Verification:** Native lifecycle, wrong-caller/scope, revoke/effect ordering and capacity tests.
No production isolated-transport claim; C01b/C01c remain required for the public mutation path.

### [x] C01b — Persist the first board effect and idempotency receipt atomically

**State:** verified on 2026-11-20 through C01b1 and C01b2;
[atomic worker transaction and failure/retry receipt](capability-platform-evidence/C01b2.md).
Real worker IPC, queued revocation, retained idempotency and filesystem failure cases pass.
Public Host delivery is verified through C01c below; the C01 parent is complete at trusted-legacy scope.

**Depends on:** C01a. **Size:** M.
**Deliver:** Worker-side create-item transaction with canonical payload hash and durable result,
including authority-generation validation coordinated with lifecycle changes across processes.
**Acceptance:** Same key/input returns one durable result; changed input conflicts; restart and
reply loss do not duplicate the effect; revoked/old-generation requests cannot commit. Creating an
item neither delegates nor starts an agent.
**Verification:** Actual board-file readback, concurrent/restart/failure/revoke tests through the
native owner; keep existing task-worker behavior intact.

### [x] C01b1 — Share the authorization fence with the native worker

**State:** verified on 2026-11-20; [cross-process fence and regression receipt](capability-platform-evidence/C01b1.md).
Native live-record/registry fencing and actual process-boundary tests pass. C01b2 below connects the
task-board transaction and C01c completes public delivery. Same branch and PR #38.

**Depends on:** C01a. **Size:** M.
**Deliver:** A private, bounded live-authorization record keyed by handle digest, a stable native
file lock, and a worker-side effect-boundary validator. Clear live records on host startup; never
restore authority from a previous process. No renderer issuance endpoint is added.
**Acceptance:** Wrong caller/scope, revoked handles and old installation generations fail at the
worker boundary; revoke and a committing effect are ordered across actual processes. Current
registry changes remain authoritative if record cleanup cannot occur; no stale cache revives grants.
**Verification:** Native process-boundary race, restart, digest/non-replay, legacy lifecycle and
failure tests; keep C01b pending until the real board effect and receipt pass C01b2.

### [x] C01b2 — Commit board creation and its replay receipt together

**State:** verified on 2026-11-20; [implementation and native evidence](capability-platform-evidence/C01b2.md),
same branch and PR #38, pending human merge. Creation is a todo-only native transaction with current
authority and retained receipts; stale legacy saves conflict. Nonempty sources await C02/C03.

**Depends on:** C01b1. **Size:** M.
**Deliver:** Native worker create-item path with a canonical payload hash and result in the same
atomic board file as the item. Deny access through the generic renderer worker-command escape path.
**Acceptance:** Same package/operation/key/input returns the original reference, changed input
conflicts, and receipt replay survives restart/reply loss/deletion without recreating an item.
A create operation only adds a todo item, with no execution authorization or agent side effect.
**Verification:** Real file contents, concurrent retries, injected pre/post-commit failure and
revoke/worker races, plus existing board regressions. Public Host/UI delivery remains C01c/C03.

### [x] C01c — Connect authorized Host mutation requests and document the contract

**State:** verified on 2026-11-20 through C01c1/C01c2; [public Host and desktop evidence](capability-platform-evidence/C01c2.md).
Controller, SDK, kit 0.3.0 and independently built archives ship together for Nooki 0.4.0.

**Depends on:** C01b. **Size:** M; split if public delivery requires it.
**Deliver:** Trusted-controller issuance, bounded Host adapter, canonical error/idempotency types,
kit/Skill updates and actual desktop verification. Package requests cannot choose owner or grants.
**Acceptance:** Native caller binding reaches the authoritative operation; forged input is refused;
public preview reports unsupported desktop operations; disabling invalidates the old caller.
**Verification:** V-P, exported-kit checks and native negative cases. C03 owns the completed public
board workflow/UI; do not mark C01 complete from C01a alone.

### [x] C01c1 — Enforce manifest policy and bind native board admission to the caller

**State:** verified on 2026-11-20; [native adapter and policy evidence](capability-platform-evidence/C01c1.md).
Real worker creation/replay/denial and complete regressions pass; desktop build/install verified.
Tauri injection was source-inspected in this slice; C01c2 below adds actual public desktop dispatch.
Same branch and PR #38, pending human merge; C01c/C01 are now verified through C01c2.

**Depends on:** C01b. **Size:** M.
**Deliver:** Native `board.create` permission checks at issuance and commit, a strict native adapter
using Tauri-injected caller identity, bounded request admission and structured errors.
**Acceptance:** Missing manifest permission cannot receive authority; request fields cannot choose
owner/caller/operation/grants; actual worker creation/replay works and foreign/revoked handles fail.
Transport uncertainty remains distinct from rejection and native details do not leak to packages.
**Verification:** Native policy/adapter/worker tests, existing regressions and desktop build/install.
This increment exposes no issuance endpoint or public Host method; desktop package acceptance stays C01c2.

### [x] C01c2 — Deliver the controller, public Host and exported development kit

**State:** verified on 2026-11-20; [receipt](capability-platform-evidence/C01c2.md) and
[native synthetic state/archive hashes](capability-platform-evidence/C01c2-desktop-state.json).
Real UI import/consent, page/job create, replay/conflict/forged input, missing permission,
disable/stale Host, re-enable and restart pass. Board output remains two todo drafts, with zero
live handles after page exit. Cleanup review findings were fixed and regression-tested.

**Depends on:** C01c1. **Size:** M; split only if the concrete integration requires it.
**Deliver:** Host-controlled grant issuance and release, public board adapter and canonical
permission/error/idempotency types, versioned SDK/kit/Skill and an independent package fixture.
**Acceptance:** Host-selected installation and permission approval govern issuance; the package
operation cannot select an owner or grant. Preview reports `UNSUPPORTED_SERVICE`. Actual desktop
creation/replay/conflict, denied permission, disable and stale caller cases pass through the archive.
Keep the legacy shared-realm trusted-only limitation explicit; R02 owns isolated caller containment.
**Verification:** V-P, exported-kit check/pack and V-N. Record native Tauri caller injection and
the public path, not just direct Rust calls, before closing C01c or C01.

### [x] C02 — Let a capability select and read authorized document snapshots

**State:** complete on 2026-11-24 through C02a/C02b; [final native acceptance](capability-platform-evidence/C02b-native-completion.md)
closes the remaining keyboard/layout checks. Public snapshot selection, permission/lifecycle refusal,
revocation, independent peer reads and retained user citations pass. Same PR #38, pending human merge.

**Depends on:** C01. **Size:** M.
**Deliver:** The document branch of the host Library picker, returning recipient-scoped snapshot grants.
**Acceptance:** Picker shows recipient/purpose; dismissal reads nothing; only chosen snapshots are
readable and revocation prevents later reads. Existing citations continue to resolve for the user.
**Likely files:** `src/platform/document-grants.ts`, `src/features/library/LibraryDialogs.tsx`,
`src-tauri/src/document_grants.rs`, contract, focused grant/picker test.
**Verification:** V-D, focused picker V-UI and V-N; exercise two package identities and denied sharing.

### [x] C02a — Fence selected snapshots and durable revocation against lifecycle and restore

**State:** verified on 2026-11-20; [receipt](capability-platform-evidence/C02a.md), same branch and
PR #38, pending human merge. Native grants bind to current installation generations; old authority
does not revive after re-enable, reinstall or data restore. User citation access is retained after
revocation. This adds no package-requested picker or public revocation endpoint.

**Depends on:** C01. **Size:** M, native authorization slice split from C02.
**Deliver:** Current-registry authorization, immutable snapshot replay, durable revocation markers,
shared data/lifecycle ordering and recovery guards that prevent reuse of removed grant identities.
**Acceptance:** Missing permission, foreign owner and stale installations fail; restart retains valid
snapshots; revoke survives restart/restore and preserves user citations; failed durability is not
acknowledged as success. Restore/capture/read cannot race across native processes, and an interrupted
restore blocks grant access until recovery. Restored snapshot IDs cannot silently acquire new content.
**Verification:** Fourteen document-grant test entries including a real child-process lock fixture,
the Library restore suite, complete native/JavaScript regression, desktop build/install/signature.
The receipt retains reproduced failures, the bounded review findings and the exact evidence limits.

### [x] C02b — Deliver the host-owned document picker and public selection workflow

**State:** complete on 2026-11-24. [C02b receipt](capability-platform-evidence/C02b.md) records independent archive
imports, selected snapshots, cross-package denial and positive control, missing-permission denial,
job selection, stale-Host cancellation, restart, revocation and retained user citations. The
[follow-up receipt](capability-platform-evidence/C02b-ui.md) adds the successful native post-revoke
peer read, browser keyboard/error/retry/layout checks and explicit native replacement/update/reinstall
regressions. The [0.6.0 native run](capability-platform-evidence/C03c.md) verifies picker Search
focus, Tab to a document and Escape dismissal, plus access-manager initial focus and Escape.
Both closing paths reported page focus rather than the opener. The
[focus follow-up](capability-platform-evidence/C02b-focus.md) reproduces and fixes loss of a keyboard
trigger across asynchronous issuance/cleanup and temporary disabling; real-component delayed-success,
dismissal and no-focus-stealing checks pass. [Final native acceptance](capability-platform-evidence/C02b-native-completion.md)
verifies keyboard restoration for both dialogs and the supported 980×680 minimum window in Chinese/light
and English/dark. Browser and native evidence remain distinct. C02b/C02 are complete.

**Depends on:** C02a. **Size:** M; split only if measured scope requires it.
**Deliver:** `library.requestSelection` document branch, typed dismissal/selected results, purpose and
recipient display, host-owned grant/revoke controls, canonical kit contract and exported fixture.
**Acceptance:** Dismissal reads nothing; approved selection returns only selected snapshots to its
intended installation. A pending picker cannot approve an updated/replaced installation or a disposed
caller. Revocation blocks later package reads while user citations still resolve. Neither requests
nor resource IDs confer whole-Library access or a package-selected recipient identity.
**Verification:** V-D, picker V-UI and actual V-N through an independently packaged capability;
exercise two identities, denied sharing, cancellation, lifecycle change while selecting, revocation
and restart. Reproduce the promised public flow before closing C02 or claiming its K1 conditions.

### [x] C03 — Create a task-board item without implicitly delegating it

**State:** complete on 2026-11-24 through C03a/C03b/C03c. Native source authority, retained user
snapshots, public kit and actual ZIP create/replay/revoke/restart acceptance pass; creation remains
todo-only. [Final public/native receipt](capability-platform-evidence/C03c.md). C02's subsequent native
focus/layout completion is reconciled in the [K1 audit](capability-platform-evidence/K1.md).
Same branch and PR #38, pending human merge.

**Depends on:** C01. **Size:** M.
**Deliver:** Public item creation over the native board owner, with stable result and provenance.
**Acceptance:** Authorized creation survives restart; duplicate requests create one item; creation
cannot self-authorize execution or mark a delivery accepted.
**Likely files:** `src-tauri/src/task_goals.rs`, native Host board adapter (new), contract,
`src/features/task-board/task-board.ts`, board API tests (new).
**Verification:** V-B plus receipt-failure/retry tests and V-N; verify current Goals behavior is preserved.

### [x] C03a — Validate selected references at native board creation

**State:** verified on 2026-11-20; [C03a evidence](capability-platform-evidence/C03a.md),
same branch and PR #38, pending human merge. Canonical selected references and live authority
are checked before the atomic native card/receipt effect; replay remains metadata-only.
Nineteen board tests, full native/JavaScript regression and desktop build/install pass.
Public sourced creation and retained delegation remain C03b/C03c; parent C03/K1 stay pending.

**Depends on:** C01, C02a. **Size:** M.
**Deliver:** Bounded typed source references; current selected-document permission, installation and
revocation checks under the worker data/authority locks; canonical snapshot references in the same
board/receipt commit. No document body or package-provided authority is persisted as a source.
**Acceptance:** Selected references succeed; forged, foreign, unselected, stale or revoked references
cannot create a card/receipt. Existing receipt replay returns the prior item without rereading sources;
new keys must pass current source authorization. Source-free behavior and no-delegation remain intact.
**Verification:** Native board/source tests, existing receipt durability and grant/lifecycle suites.

### [x] C03b — Preserve selected snapshots in user-owned task workflows

**State:** complete on 2026-11-24; [native snapshot/restore evidence](capability-platform-evidence/C03b1.md),
[citation/delegation implementation](capability-platform-evidence/C03b2.md) and
[installed-app acceptance](capability-platform-evidence/C03b2-native.md). Same branch and PR #38,
pending human merge. Public sourced creation C03c and parent C03/K1 remain open.

**Depends on:** C03a. **Size:** M.
**Deliver:** Task source representation and user citation opening; explicit user delegation captures
retained selected snapshots rather than silently reading changed current documents. Existing plain
Library references retain their current behavior. Restore validation covers the new reference shape.
**Acceptance:** Original edits, package disable/uninstall and grant revocation do not change an
already-created user's task citation. New package reads remain denied. Delegation is still explicit;
retries/resume keep their captured input. Malformed references fail without selecting a different input.
**Verification:** Task/Goals/source snapshot tests and focused task-reference UI verification.

### [x] C03b1 — Preserve selected inputs in native task snapshots and restore

**State:** verified on 2026-11-20; [C03b1 evidence](capability-platform-evidence/C03b1.md),
same branch and PR #38, pending human merge. Selected task inputs retain original grant bodies
after edit/delete/revoke/uninstall; changed identities and malformed restore data fail closed.
Two review findings were reproduced and fixed; the second bounded review found no further issues.
Full regression and desktop build/install pass. C03b2/C03c and parent C03/K1 remain pending.

**Depends on:** C03a. **Size:** M.
**Deliver:** Native task-source validation and capture for selected grants alongside plain Library
references; Goals add/prepare/brief paths retain the selected body, and restore rejects malformed
source references. The user-owned citation path remains independent of package read authority.
**Acceptance:** Editing/deleting the original, revoking the grant or uninstalling its package does
not substitute current content for an existing selection. Retry preserves captured inputs; changing
the selected reference with the same document ID conflicts. Missing/malformed snapshots fail closed.
**Verification:** Native Goals/board, source snapshot and backup/restore tests, full regression.

### [x] C03b2 — Connect user citation opening and explicit renderer delegation

**State:** complete on 2026-11-24; [implementation/regression](capability-platform-evidence/C03b2.md)
and [native acceptance](capability-platform-evidence/C03b2-native.md). Actual citation opening,
explicit delegation, missing-source failure, Tab/Enter, current-document contrast, restart and
withdrawal pass. Native state confirms retained original content and no agent run/thread.
Desktop build/install/signature checks pass. C03c, parent C03 and K1 remain unchecked.

**Depends on:** C03b1. **Size:** M.
**Deliver:** Typed selected references on task cards, retained-citation opening, and native capture
of full task sources when the user explicitly delegates an existing todo. Keep plain references
and conversation snapshot consumers compatible; capture alone must not authorize execution.
**Acceptance:** A real task citation opens the originally selected text after edit/revoke; explicit
delegation supplies that text rather than a fresh ID-only read. Capture errors leave the todo idle.
**Verification:** Focused adapter/store tests, task-reference UI and native citation/delegation checks.

### [x] C03c — Deliver sourced creation through the public Host and exported kit

**State:** complete on 2026-11-24; [receipt](capability-platform-evidence/C03c.md) and
[retained synthetic state](capability-platform-evidence/C03c-native-state.json). Platform/contract
0.6.0 and kit 0.5.0 expose selected sources through the existing native owner. Two independently
built ZIPs pass selection/create/replay, cross-package denial, revocation, restart and retained
task citations. Native state contains one idle todo and one receipt, with no execution authorization.
Full regression and desktop build/install/signature verification pass. C03 is complete; the K1 audit
also records the subsequent completion of C02 native acceptance.

**Depends on:** C03a, C03b. **Size:** M.
**Deliver:** Public adapter, versioned contract/kit documentation and an independent package fixture
that selects a document then creates a todo with its reference and a stable idempotency key.
**Acceptance:** Actual ZIP selection/create/replay/restart works; revoked/foreign new sources fail;
user citation survives revocation; no agent starts and no delivery is accepted by creation.
**Verification:** Host/kit tests, real archive V-N, V-B/V-D regressions and desktop build/install.
C03's child checks are complete and included in the K1 audit below.

### [x] K1 — Selected inputs and durable board creation

**State:** complete on 2026-11-24; [requirement-to-evidence audit](capability-platform-evidence/K1.md).
C01/C02/C03, outside-checkout kit archives, actual Host grant/replay refusal cases, regression and
installed-app checks pass. Trusted-only limitation and later production containment gates remain.
C04 follows this gate; its current slice status is recorded below. Same PR #38 remains open for human merge.

**Depends on:** C01, C02, C03.
**Verify:** Grant and idempotency failure cases pass through the real Host; current ZIP, document and
board regressions pass. The outside-checkout fixture uses the updated kit without private imports.

### [x] C04 — Select an existing task and attach a delivery with a scoped grant

**State:** complete on 2026-11-26 through C04a–C04c. Public task selection, scoped attachment and
retained viewing pass independent ZIP/native acceptance, including foreign/revoked authority,
user edits, exact replay, source deletion and package removal/restart. See [C04c3 evidence](capability-platform-evidence/C04c3.md).
Task status and execution authority remain unchanged. Next: C05.

**Depends on:** C02, C03. **Size:** M.
**Deliver:** Host-owned task picker and delivery attachment to an existing item.
**Acceptance:** User sees the requested operation; attachment checks item grant and expected revision;
denial/conflict preserves the item and the grant cannot accept, delegate or mutate other items.
**Likely files:** Task selection component (new), native Host board adapter, contract,
`src/features/task-board/TaskReferences.tsx`, focused selection/attachment tests.
**Verification:** V-B, focused V-UI and V-N including another user's edit between selection and write.

### [x] C04a — Make task revisions native-owned across every board writer

**State:** complete on 2026-11-24; [C04a evidence](capability-platform-evidence/C04a.md). Native-owned
versions, migration, restore, replay and all writer paths pass 210 native top-level tests plus one
nested child, 180 JavaScript tests and an isolated installed-0.7.0 worker run. Two existing native
live-agent tests remain ignored. Platform/contract 0.7.0 and kit 0.6.0 are aligned; strict desktop
signature verification passes. Next: C04b.

**Depends on:** C03. **Size:** M.
**Deliver:** One persisted board revision sequence; changed/new cards receive a new revision while
unchanged cards keep theirs. Central native persistence covers legacy UI, Goals and capability writes;
old boards migrate without changing content. Incoming renderer revision fields are not authority.
**Acceptance:** User edits and native state transitions change the affected revision; unrelated-card
edits do not. Delete/recreate never reuses an old revision, including across restart. Failed writes
do not consume committed state. Existing create receipts retain their original result on replay.
**Verification:** Native legacy/Goals/create/restart/failure and backup-validation tests, full regression,
matching contract/kit documentation and desktop build/install. Parent C04 stays pending.

### [x] C04b — Authorize and atomically attach deliveries to selected tasks

**State:** complete on 2026-11-26 via C04b1 and C04b2. Native grants, exact revision checks,
retained text and atomic attachment/replay receipts pass native and installed-worker acceptance.
The public controller, picker, kit and user-visible delivery remain C04c.

**Depends on:** C04a, C02. **Size:** M.
**Deliver:** Host-owned task selection sessions and operation-scoped grants, plus a native attachment
transaction with expected-revision checks and durable idempotency receipts. Bind current installation,
task identity and the requested attachment operation; retain delivery data as user-owned content.
**Acceptance:** Missing/foreign/stale/revoked authority or user edits reject new effects unchanged;
exact committed retries return their recorded result without duplicating delivery. Grants cannot
accept, delegate or edit other tasks. Existing agent deliveries are preserved.
**Verification:** Native transaction, lifecycle, stale-selection and reply-loss/restart tests.

#### [x] C04b1 — Persist installation-bound task selections

**State:** complete on 2026-11-24; [C04b1 evidence](capability-platform-evidence/C04b1.md). Eleven focused
authorization tests, 221 native top-level tests plus one nested child and 180 JavaScript tests pass;
two existing live-agent tests remain ignored. Rebuilt/reinstalled 0.7.0 passes strict signing and an
installed-worker ledger smoke. No public task-picker/attachment interface is exported. Next: C04b2.

Host-owned pending selection, explicit attach-only approval, durable grant/revocation, exact displayed
task revisions, bounded retained metadata and a restore epoch outside backups. Reuse the task-data and
authority fences; legacy board saves must preserve native grant records. Native permission is internal
until the public controller and kit arrive in C04c. Verify dismissal, stale approval, lifecycle,
restart, failed commits and restore/recovery; no task attachment API is claimed by this slice.

#### [x] C04b2 — Commit attachments and replay receipts together

**State:** complete on 2026-11-26; [C04b2 evidence](capability-platform-evidence/C04b2.md). Sixteen
focused native tests, 237 native top-level tests plus one nested child and 180 JavaScript tests pass;
two existing live-agent tests remain ignored. Installed 0.7.0 workers pass concurrent/lost-reply/restart,
queued-revocation and cross-process publication/edit/delete checks. Desktop build/install and strict
signature verification pass. Source snapshots, revisions and receipts commit together; no public API
is exported yet. Next: C04c; parent C04 remains open.

Consume the approved grant under the same task-data/authority fence as revision checking and the
delivery/receipt commit. Preserve native Agent deliveries and task status, retain authorized document
content for the user, and bound new records. Verify foreign/revoked/stale requests, original-result
replay, lost replies, failed writes and removal/restore behavior before closing C04b.

### [x] C04c — Ship the public task picker and independent attachment flow

**State:** complete on 2026-11-26 on the existing branch and PR #38. All three children pass;
[C04c3 evidence](capability-platform-evidence/C04c3.md) separates installed acceptance from simulated
component checks and records the real WKWebView Escape fix. PR #38 remains open for human review.

**Depends on:** C04b. **Size:** M.
**Deliver:** Host picker, public typed requestSelection/attachDelivery, canonical kit/Skill and
independent ZIP fixture, with user-visible delivery references on existing tasks.
**Acceptance:** Real ZIP selection/attachment/dismissal/retry/restart, concurrent-user-edit refusal,
keyboard/layout and retained delivery after removal pass. No execution or acceptance is inferred.
**Verification:** V-B/V-K, focused V-UI/V-N, desktop build/install; close C04 only after all child checks.

#### [x] C04c1 — Expose task selection and user access management

**State:** complete on 2026-11-26. [C04c1 evidence](capability-platform-evidence/C04c1.md) records
the implementation checks; [C04c3](capability-platform-evidence/C04c3.md) closes keyboard/focus/layout,
frozen retry, loading/error and access-state acceptance. Native search-field Escape was fixed and
verified in the rebuilt/reinstalled app.

Public typed `board.requestSelection`, host-owned picker and task-board access manager using the
C04b1 native controller. Bind the installed identity, requested attach-only operation and displayed
revisions; dismissal grants nothing and disposal rejects late results. Preserve frozen confirmation
across uncertain retries and show stale/revoked/inactive status. Include native command bindings,
permission/version gating, contract/kit/Skill updates and focused keyboard/layout verification.
Attachment effects were internal in this slice; C04c2 exports them and C04c3 verifies the complete flow.

#### [x] C04c2 — Connect attachment submission and retained delivery viewing

**State:** complete on 2026-11-26. [C04c2 evidence](capability-platform-evidence/C04c2.md) records
the implementation checks; [C04c3](capability-platform-evidence/C04c3.md) verifies public attachment,
refusal/replay, retained viewing after source deletion and package removal/restart. Platform/contract
0.9.0 and kit 0.8.0 are aligned; 197 JavaScript tests pass after the Escape fix.

Public typed `board.attachDelivery` calls the C04b2 transaction with lifetime cleanup and a bounded
frozen request. Display retained text/references on the selected task independently of its original
source or producing package, preserving Agent delivery and task status. Verify error/replay/refresh,
removed-source viewing and keyboard access; update the exported kit and Skill.

#### [x] C04c3 — Verify independent archives and the installed complete flow

**State:** complete on 2026-11-26; [C04c3 evidence](capability-platform-evidence/C04c3.md).
Reader/peer 1.0.0 independently pass exported-kit check/pack and actual ZIP installation with five
user-approved permissions. Native attachment/refusal/revoke/edit/replay/restart and retained viewing
pass. Keyboard/layout and component edge-state checks pass. Final state: two todo cards, one delivery
each, two attachment receipts, no installed packages and no queued execution. Desktop build/install
and strict signing pass; C04c and C04 are closed. Next: C05.

Build reader/peer ZIP fixtures outside the checkout with the exported kit. Verify actual installation,
selection, dismissal, attachment, replay/conflict, user-edit refusal, revoke, restart and retained
delivery after package removal. Record native state plus keyboard/focus/layout evidence separately
from simulated preview checks. Close C04c and C04 only after all child acceptance passes.

### [ ] C05 — Hand selected context to a native conversation draft

**State:** in progress on the existing branch and PR #38. Inspection found that composer drafts are
renderer-local and native conversation creation can connect to an Agent. Split the work below before
implementation: persist an offered draft first; opening it must not create/send an Agent turn.

**Depends on:** C02. **Size:** M.
**Deliver:** Idempotent handoff returning a conversation/draft receipt with authorized input references.
**Acceptance:** Opening a draft sends no turn; existing unsent user text is not overwritten; target
and source scope cannot be chosen by an ungranted ID or replayed into another conversation.
**Likely files:** `src/features/conversation/conversation-client.ts`, conversation handoff module (new),
`src-tauri/src/conversation_host.rs`, contract, handoff tests.
**Verification:** V-A, focused V-UI and V-N; cover dismissal and repeated handoff.

#### [x] C05a — Retain approved handoff drafts and replay receipts atomically

**State:** complete on 2026-11-26; [C05a evidence](capability-platform-evidence/C05a.md). Eleven
native storage tests and full regression (249 top-level native tests plus one nested child, two
existing live-agent tests ignored; 197 JavaScript tests) pass. Desktop build/install and strict
signature verification pass. This internal store exports no capability/Tauri handoff endpoint;
public authority, navigation and installed archive acceptance remain C05b/C05c.

**Depends on:** C02. **Size:** S.
**Deliver:** An internal native store for user-owned offered drafts, exact request/target binding,
retained selected text and durable receipts. Include bounds, restart and backup/restore validation.
Keep ordinary composer drafts and Agent session owners untouched. No public capability method or
Tauri command is exported by this storage slice; its caller must supply host-approved scope.
**Acceptance:** Repeated exact input returns one draft; changed text, source or target conflicts.
Failed writes do not commit partial drafts; retained data survives source/package removal and restore.
The store cannot send turns or overwrite existing composer contents.
**Verification:** Focused native persistence/failure/replay/backup tests and V-APP. Authority and
interactive acceptance remain C05b/C05c and cannot be inferred from this storage test.

#### [x] C05b — Authorize handoff and open it safely in native chat

**State:** complete on 2026-11-26; native authority and public UI slices are verified.
See [public handoff evidence](capability-platform-evidence/C05b2b-ui.md). The package proposes content; the host
chooses the target during approval. No general conversation grant/listing API is introduced.

**Depends on:** C05a. **Size:** M; split further before implementation if needed.
**Deliver:** Host-owned review/target selection, installation and selected-source checks, lifecycle
fencing and public typed handoff with canonical kit/Skill updates. Keep offered drafts separate from
unsent composer text; only explicit user action adopts/sends a draft. Reuse existing conversation
navigation and Agent adapters; do not create a second message history or execution system.
**Acceptance:** Dismissal produces no draft. Unapproved/foreign target or source, stale installation,
revocation and changed replay target fail without effect. Unknown commit retries preserve exact
approved input. Existing unsent text is preserved, including navigation and delayed completion.
**Verification:** V-A/V-K, focused native authority/restore tests, component checks and V-APP.

##### [x] C05b1 — Bind native handoff approval to content, target and installation

**State:** complete on 2026-11-26; [C05b1 evidence](capability-platform-evidence/C05b1.md). Ten
controller tests, full regression (259 top-level native tests plus one nested child; 197 JavaScript
tests), independent exported-kit check/pack and desktop build/install pass. Platform/contract 0.10.0,
kit 0.9.0. Correlation identity is checked before receipt lookup. Real conversation-target validation,
Tauri/public method and UI remain C05b2; no handoff is exposed prematurely. The evidence records an
existing Vite development-dependency audit advisory separately from functional verification.

**Depends on:** C05a. **Size:** M.
**Deliver:** Bounded native proposal sessions, host-only approval/cancellation, frozen target retries,
current-installation/source checks, restore invalidation and original receipt replay. Declare the
handoff permission consistently; no public handoff method or UI is claimed in this increment.
**Acceptance:** Foreign caller/source, missing permission, changed approval, stale installation or
restore cannot create a draft. Exact committed requests survive restart without recapturing sources;
changing input or target conflicts. Approval commits no turn or ordinary composer edit.
**Verification:** Native controller/permission/replay/lifecycle tests, full affected regression,
contract/kit checks and V-APP. Real target discovery and interactive approval remain C05b2/C05c.

##### [x] C05b2 — Expose reviewed handoff and preserve native composer work

**State:** complete; native bindings and public UI integration below pass their gates. Ordinary
conversation targets are distinct from task execution threads; target checks must use the current
conversation owner rather than trusting a renderer-supplied conversation ID.

**Depends on:** C05b1. **Size:** M; split further if required before implementation.
**Deliver:** Public typed handoff, native command bindings and target discovery over the current
conversation owner; review dialog and safe navigation to a retained offer. Keep unsent user text
separate, requiring explicit adoption/send. Align canonical contract, preview, kit and Skill.
**Acceptance:** Native target validation precedes commit; unavailable targets fail visibly. Dismissal,
unknown-outcome retries, disposal and disabled openers preserve exact input and user drafts. No turn
is sent by handoff. Verify focus, keyboard, loading/error and language/theme/layout behavior.
**Verification:** V-A/V-K, native command checks, component UI checks and V-APP; C05c closes installed
independent archive acceptance.

###### [x] C05b2a — Connect native review to actual conversation targets

**Depends on:** C05b1. **Size:** S.
**State:** complete as the native integration slice. Nine adapter tests and one binding-error test
pass; full native regression passes 269 top-level tests plus one nested child, with two existing
live-agent tests ignored. All 197 JavaScript tests, desktop build/install and signature verification
pass. See [C05b2a evidence](capability-platform-evidence/C05b2a.md). Public SDK/UI and installed
handoff acceptance remain C05b2b/C05c.
**Deliver:** Host-only Tauri bindings, metadata-only target pages from the existing conversation owner,
current target validation and retained-draft reads for the Host UI. Freeze approval before asynchronous
target discovery and recheck installation/restore/disposal before the effect.
**Acceptance:** New drafts need no Agent connection. Existing targets must be current ordinary Nooki
conversations; missing/archived/task-owned targets fail. Foreign callers and dismissed/stale reviews
cannot inspect targets or commit. Exact replay returns its existing receipt without a target lookup.
**Verification:** Native adapter/binding tests with actual local conversation catalog and deterministic
Codex protocol fixtures, full affected regression and V-APP. No public SDK/UI acceptance is inferred.

###### [x] C05b2b — Integrate public handoff, review UI and retained draft navigation

**State:** complete on 2026-11-26; both retained inputs and public review/adoption are delivered.
Platform/contract 0.11.0 and kit 0.10.0; [UI evidence](capability-platform-evidence/C05b2b-ui.md).
**Depends on:** C05b2a. **Size:** M.
**Deliver:** Public typed handoff, immutable request/lifetime controller, Host review dialog and safe
chat offer navigation/adoption over existing composer ownership. Manual send must use the retained
source snapshots, not re-read current Library IDs. Update canonical kit/Skill/preview.
**Acceptance:** User-selected targets/sources match the receipt; cancellation/retry/disposal preserves
intent; existing unsent text remains intact and opening sends no turn. Retained drafts remain usable
without the producing package. Verify real-component keyboard/focus/error/layout behavior.
**Verification:** V-A/V-K, component UI and V-APP; C05c still owns installed archive acceptance.

1. [x] **Retained send inputs:** materialize the offered source text through the existing native
   snapshot owner and use it in explicit conversation sends. Preserve provenance, additional user
   attachments, earlier working-copy edits and retry snapshots. Verify original deletion/producer
   removal, backup/restore, conflicting inputs, foreign callers and native working-copy preparation.
   This internal path does not expose a successful public handoff before the review/adoption UI exists.
   Six native and four JavaScript additions pass; full regression passes 275 top-level native tests
   plus one nested child (two existing live-agent tests ignored) and 201 JavaScript tests. Desktop
   build/install and signature verification pass. [Evidence](capability-platform-evidence/C05b2b-sources.md)
   records working-copy preservation, snapshot reuse and the isolated process-launch fixture fix.
2. [x] **Public review and adoption:** connect the typed package client, Host approval dialog and
   retained-offer navigation to the composer without replacing unsent user work. Update kit/preview/
   Skill and verify real components. Full regression passes 275 top-level native tests plus one nested
   child (two live-agent tests ignored) and 208 JavaScript tests. Real-component handoff and existing
   reconnect checks, independent kit check/pack, desktop build/install and strict signing pass.
   [Evidence](capability-platform-evidence/C05b2b-ui.md) distinguishes component fixtures from the
   remaining C05c installed acceptance and records unrelated regression findings.

#### [ ] C05c — Verify independent handoff archives and installed behavior

**State:** in progress; independent Reader/Peer 1.0.0 ZIPs are built from exported kit 0.10.0,
with separate dependencies and passing check/pack. [Artifact checkpoint](capability-platform-evidence/C05c.md).
The new handoff permission requires installation approval for these concrete artifacts; actual
installed acceptance remains pending and C05 stays open.

**Depends on:** C05b. **Size:** S.
**Deliver:** Independent reader/peer ZIP acceptance using synthetic data and the exported kit.
**Acceptance:** Actual install, review/dismissal, fresh/existing conversation targets, repeated handoff,
source/target refusal, preservation of unsent text, restart and package removal pass. Opening a draft
starts no Agent turn. Check keyboard/focus/error/layout separately from simulated authority.
**Verification:** V-N/V-UI plus final native state; close C05 only after all child acceptance passes.

### [ ] C06 — Expose one observable agent-run path

**State:** in progress; split below before implementation. C01/C02 are complete, so this work may
proceed while C05c waits for its separate archive-installation approval. C05c remains a required K2
gate. The public API is not exposed until native effect policy, durable identity and Host interaction
handling are verified together.

**Depends on:** C01, C02. **Size:** M.
**Deliver:** Start/get/subscribe/cancel semantics for one supported existing agent adapter, using host
approval/question surfaces and durable run identity. No new model client or credential store.
**Acceptance:** Inputs and permitted effects are bounded; missing agent or rejected approval starts
no work; reconnect observes the same run and preserves structured result/artifact references.
**Likely files:** Native agent-run adapter (new), `src-tauri/src/conversation_host.rs`, public agent
client (new), contract, adapter/run tests.
**Verification:** V-A and deterministic transport/approval failures; V-N with one recorded real-agent run.

#### [x] C06a — Prove the bounded Codex execution policy

**State:** complete as the version-pinned policy-feasibility slice. Official CLI 0.170.0 source audit,
actual macOS read/write/symlink/deny-glob and direct-network controls, missing-profile/unsupported-version
checks and ephemeral app-server acknowledgement pass with zero model turns. The broad native
`:minimal` defaults and metadata visibility are explicitly accounted for. See
[C06a evidence](capability-platform-evidence/C06a.md). C06b is complete; production adapter/tool policy
and public API acceptance remain C06c–C06e.

**Depends on:** C01/C02. **Size:** S.
**Deliver:** Reproducible, credential-free native policy probe using the installed Codex CLI and
synthetic files. Record the current app-server schema and its named permission-profile, structured
output and stable request-ID support. Reuse the existing adapter/transport later; do not expose the
ordinary conversation path directly or create a model client.
**Acceptance:** Approved inputs can be read; run output can be written; unrelated synthetic files,
input writes and network access are denied by the native sandbox. Rejection/missing support must
fail visibly, with no fallback to unrestricted or prompt-only enforcement. No model turn is sent.
**Verification:** Actual macOS sandbox probe with both allowed and denied controls, protocol-schema
inspection and a receipt distinguishing filesystem enforcement from future tool/approval validation.

#### [x] C06b — Persist scoped run intent and approval before dispatch

**Depends on:** C06a. **Size:** M; split if the authority and storage owners exceed a focused slice.
**Deliver:** Bounded native run records tied to current installation/restore scope, immutable
instruction/source snapshots, chosen agent/policy, idempotency key and Host approval receipt.
**Acceptance:** Foreign/revoked inputs and dismissed/stale approvals start no work; changed intent
conflicts; retries preserve run identity. Persist dispatch intent before contacting an adapter and
represent uncertain submission without blindly replaying it.
**Verification:** Native authority, atomic-write failure, concurrency, lost-reply and restore tests.

##### [x] C06b1 — Retain approved intent and claim submission once

**Deliver:** Internal bounded native ledger with immutable instructions, selected-source snapshots,
agent/policy/schema selection, installation/restore scope, approval receipt and request key. An atomic
submission claim records a stable client-message identity before any adapter call. Exact retries
read the original run; a previously claimed submission requires reconciliation, never redispatch.
**Acceptance:** Restart/reply loss, concurrent claims, failed writes, changed input, mismatched
snapshots and restore/stale scopes cannot produce a second submission. Backup preserves records
without restoring execution authority. This slice adds no package endpoint or Agent dispatch.
**Verification:** 14 focused native tests plus two child-process executions; full regression passes
289 top-level native tests plus three child executions, with two existing live-agent tests ignored.
203 platform and 5 capability tests pass. V-APP build/install and strict signature verification pass.
[Evidence and boundaries](capability-platform-evidence/C06b1.md). C06b2 is complete below; C06c is next.

##### [x] C06b2 — Bind the ledger to Host review and installation authority

**Depends on:** C06b1. **Deliver:** Native Host review/controller checks current installation,
execution permission, approved policy and selected-source grants under lifecycle fences before
approval and dispatch. Dismissed/expired/changed approvals fail closed; package fields never supply
approval or owner identity. **Verification:** Native review/permission/revocation/concurrency tests.
Public bindings and interaction UI remain C06d; actual adapter dispatch remains C06c.

The distinct `agents.run` declaration/version floor is brought forward from C06d so this controller
can require an explicit manifest grant without broadening legacy `ai.invoke`. Platform/contract
0.12.0 and kit 0.11.0 declare the permission; there is still no public `host.agents` service. Native
adapter availability and policy-digest resolution are trusted internal inputs until C06c connects
the real adapter. The current shared-realm production loader remains trusted-only pending R02/R03.

**Verified:** 12 native review tests; full regression passes 301 top-level native tests plus three
child executions (two existing live-agent tests ignored), 203 platform and 5 capability tests. An
independent exported-kit project passes type/permission-floor checks and packing with its own
dependencies. V-APP build/install and strict signature verification pass.
[Evidence and remaining integration boundaries](capability-platform-evidence/C06b2.md).

#### [ ] C06c — Dispatch and reconcile through the existing Codex adapter

**Next-step decision:** [ADR 0008](adr/0008-capability-agent-adapter-selection.md).
The official 0.172.0 release reproduces the same six configuration limitations. The current
Codex-first path has no verified complete policy interface. The owner explicitly retained Codex
priority on 2026-11-26; do not switch to another adapter. Continue qualifying the Codex-native
startup boundary against the unchanged C06 acceptance bar. Production dispatch remains unavailable.

**State:** implementation remains open. The 2026-11-26 native configuration checkpoint reproduced
connector inheritance and reload gaps before any model turn. Empty MCP maps, enumerating current
servers, and `orchestrator.mcp.enabled=false` do not establish a process-startup deny-all. See
[C06c configuration evidence](capability-platform-evidence/C06c-config.md). Before dispatch, prove
configuration isolation that preserves native authentication and managed restrictions, then verify
Skills/hooks/tool startup as well as the C06a filesystem/network policy. Do not certify the complete
adapter policy from C06a or from a post-start configuration comparison.
The [native credential-link checkpoint](capability-platform-evidence/C06c-auth-link.md) proves
synthetic file-store continuity through a separate Codex home without copying credentials. It is a
candidate authentication mechanism, not complete configuration isolation: system/cloud/project
layers, OAuth refresh, keyring-backed login and the complete tool policy remain unverified.

**Depends on:** C06b. **Size:** M; separate dispatch from interaction handling if required.
**Deliver:** Dedicated package-run sessions through the existing Codex transport with verified input/
output workspace policy; no inherited capability bridge, unrelated Skills, connectors or tools.
Use native thread/turn/client-message identities and output schema. Reconnect observes the same run;
local cancellation and unknown remote outcome remain distinct. Only Host-owned surfaces resolve
questions/approvals; package calls cannot answer them or expand the approved effect scope.
**Acceptance:** Missing adapter/policy mismatch starts no turn; lost replies/restart never duplicate
an unreconciled run; stale/foreign events or replies cannot mutate another run. Terminal results keep
validated structured output and scoped artifact references, not arbitrary filesystem paths.
**Verification:** Deterministic transport/approval/question/cancellation failures and native process
checks. C07 remains responsible for deriving and propagating Job parentage across the execution tree.

#### [ ] C06d — Expose observable runs through Host UI and the exported kit

**Depends on:** C06c. **Size:** M; split native bindings and UI if required.
**Deliver:** Typed available-agent/start/get/subscribe/cancel operations, Host-owned start review and
interaction UI, ordered resumable snapshots/events and visible stop/reconciliation status. Align the
permission/version floor, contract, preview and Skill. Keep private vendor/session data out of SDK
results and never treat a status subscription as execution authority.
**Acceptance:** Only the owning current installation can observe/control its runs; reconnect uses a
cursor or fresh snapshot; package code cannot approve itself. Leaving a view cleans subscriptions
without silently detaching run ownership; explicit cancellation shows the confirmed remote outcome.
**Verification:** Client/native ownership tests, real-component interaction/accessibility checks,
independent exported-kit check/pack and V-APP.

#### [ ] C06e — Verify independent archive and real-agent behavior

**Depends on:** C06d. **Size:** S.
**Deliver:** Independent package acceptance from the exported kit, deterministic denial/fault cases
and one explicitly recorded real-agent run with synthetic approved inputs.
**Acceptance:** Native installation, Host approval/question, start/observe/reconnect/cancel and
structured result/artifact references pass without duplicate work or private credential access.
**Verification:** V-N and final native state. Record package permissions and obtain any required
installation/execution authorization before the corresponding test; C06/K2 remain open until passed.

### [ ] K2 — Chat and agent service gate

**Depends on:** C04, C05, C06.
**Verify:** Existing-item grants, chat drafts and observable runs work from the exported kit.
No unsolicited sends, duplicate agent runs, synthetic user approvals or private credential access.

### [ ] C07 — Propagate cancellation through package-owned execution

**Depends on:** C06. **Size:** M.
**Deliver:** Host-derived parentage between a package Job and its agent child, with revocation and
remote-cancellation reconciliation. Do not infer ownership solely from provenance.
**Acceptance:** Parent cancellation blocks late child writes; unknown remote outcome stays visible;
retry cannot reuse an obsolete attempt or duplicate an unreconciled external effect.
**Likely files:** `src/platform/task-runner.ts`, `src/platform/tasks.ts`, `src-tauri/src/task_execution.rs`,
native agent-run adapter, cancellation tests.
**Verification:** V-P/V-A and V-N cancellation while the agent is active, including restart/late results.

### [ ] C08 — Commit explicit handoff to independent user-owned host work

**Depends on:** C04, C05, C07.
**Size:** M; split board and chat wiring if they cannot share a small verifiable delivery.
**Deliver:** A host decision receipt and durable inputs for user-authorized board delegation/native
chat send. Start independent work through existing owners; do not migrate a live vendor run.
**Acceptance:** Opening a draft/viewing a delivery transfers nothing; explicit delegation survives
package removal without callbacks/private state; handoff versus uninstall has one durable outcome.
**Likely files:** Native Host board adapter, `src-tauri/src/conversation_host.rs`, capability authority,
`src-tauri/src/task_goals.rs`, handoff/removal race tests.
**Verification:** V-B/V-A and V-N: compare package child cancellation against independent host continuation.

### [ ] C09 — Build and verify the independent meeting-notes package

**Depends on:** C02, C03, C04, C05, C07, C08. **Size:** M.
**Deliver:** A minimal reference package using only the exported SDK/Skill: selected text to notes,
existing/new board item attachment, and conversation handoff. Persist sources as an example only
after independently building the real archive outside Nooki.
**Acceptance:** M1 and phase-1 M7 pass; denied input, repeated submission and cancelled child work are
covered; uninstall retains notes/items and independently delegated work.
**Likely files:** Reference package manifest, entry, job module, package tests, desktop acceptance fixture.
**Verification:** V-K, package check/pack, V-N with a real agent and deterministic failure cases.

### [ ] K3 — Phase 1 acceptance

**Depends on:** C07, C08, C09.
**Verify:** V-F and M1/M7 evidence on the assembled revision; no private SDK, renderer-only authority
or extra package-ID branch. Native board, old document references and legacy retry remain compatible.
Keep the trusted-only limitation explicit. Record the next eligible task, R01.

## Phase 2: varied forms, retained artifacts and enforceable removal

### [ ] R01 — Introduce the versioned archive with optional pages and passive assets

**Depends on:** C09, P02. **Size:** M.
**Deliver:** Separate archive/API/data versions, static entry descriptions and validated asset paths,
while retaining the v1 installer. New-format activation stays unavailable until runtime validation passes.
**Acceptance:** Inspect executes no code; a headless manifest and binary asset archive validate;
traversal, symlinks, duplicate entries, expansion limits and unsupported requirements fail early.
**Likely files:** `src-tauri/src/package_installer.rs`, `scripts/package-capability.mjs`, canonical schema,
starter checker, `src-tauri/tests/package_installer_test.rs`.
**Verification:** V-P/V-K plus malformed-archive cases and v1/new-format fixture comparisons.

### [ ] R02 — Bind the isolated runtime bridge to a real caller

**Depends on:** R01, C01, P02. **Size:** M.
**Deliver:** The selected transport with host-issued caller/generation identity and a typed SDK adapter.
**Acceptance:** A runtime cannot impersonate another package or call native internals; revoked/old
handles fail at effects; unauthorized outbound channels are blocked by the selected runtime policy.
**Likely files:** Runtime transport and native boundary (new), SDK transport adapter (new),
capability-authority module, transport containment tests.
**Verification:** P02 probes repeated through the actual app, V-N and protocol-negative tests.

### [ ] R03 — Mount and terminate an isolated capability page

**Depends on:** R02. **Size:** M.
**Deliver:** New-format page loading, environment propagation, fault reporting and runtime destruction;
keep legacy loading separately labeled.
**Acceptance:** DOM/CSS/storage cannot affect host/another package; an infinite-loop fixture can be
stopped while host management remains usable; unmount removes view resources without cancelling Jobs.
**Likely files:** `src/platform/package-loader.ts`, `src/platform/capability-runtime.ts`,
`src/features/capabilities/CapabilityPage.tsx`, chosen runtime adapter, containment fixture/tests.
**Verification:** V-P and V-N with two packages, navigation, runtime crash and forced-stop probes.

### [ ] K4 — Runtime boundary gate

**Depends on:** R01, R02, R03.
**Verify:** Actual desktop identity, native-bridge, DOM/style/storage, egress and forced-stop evidence
matches P02. A browser error boundary or mocked IPC cannot pass this checkpoint. Legacy paths work.

### [ ] R04 — Support immediate command results without background Jobs

**Depends on:** R03. **Size:** M.
**Deliver:** Discriminated immediate-result/long-work responses in the broker and new-format contract.
**Acceptance:** A quick operation creates no Job but retains authorization and necessary invocation
receipt; long work returns an observable handle; legacy job commands preserve retry/checkpoint behavior.
**Likely files:** `src/platform/capability-broker.ts`, broker runtime adapter, contract,
`src/features/conversation/CapabilityInvocationCard.tsx`, broker/result tests.
**Verification:** V-P/V-A, bounded-handler failure tests, V-N for immediate and long-work commands.

### [ ] R05 — Start and stop a visible continuing service

**Depends on:** R03, R04. **Size:** M.
**Deliver:** Package-owned service handles and host stop controls, exercised with a packaged audio
fixture as the first consumer rather than an unused generic service framework.
**Acceptance:** Service outlives its starting command/page; repeated start is deduplicated; disable,
uninstall or forced termination releases resources and restart never autoplays.
**Likely files:** Service owner/native adapter (new), public service client (new), host running-service
control, contract, audio service fixture/tests.
**Verification:** V-N navigation/stop/restart and resource-release checks with the measured P02 budgets.

### [ ] R06 — Require source continuity before an update accesses retained data

**Depends on:** R02, R03. **Size:** M.
**Deliver:** Approved-source/payload records and explicit replacement review in the existing installer.
**Acceptance:** Same ID plus higher version is insufficient; changed/unverifiable source cannot read
private data before approval; declining replacement or new grants preserves the old installation.
**Likely files:** `src-tauri/src/capability_runtime.rs`, `src-tauri/src/package_installer.rs`,
`src/features/capabilities/PackageImportModal.tsx`, registry schema, source-continuity tests.
**Verification:** V-P and V-N update/reinstall cases; distinguish manual source approval from signatures.

### [ ] K5 — Commands, services and replacement authority

**Depends on:** R04, R05, R06.
**Verify:** Immediate commands produce no fake Jobs; service lifetime is explicit; update data access
is gated before executable/migration inspection. No unrelated package is stopped by these operations.

### [ ] R07 — Commit and export a binary artifact

**Depends on:** R02, C02. **Size:** M.
**Deliver:** Host-held transfer handles, bounded writes, atomic artifact commit, revision references
and export through host destination selection.
**Acceptance:** Partial/cancelled transfers never appear published; repeated commit returns the same
artifact; export can be cancelled without false success and original bytes survive producer uninstall.
**Likely files:** Native artifact store (new), artifact Host adapter (new), contract,
Library artifact presentation, artifact storage/export tests.
**Verification:** V-D plus new binary/partial-transfer tests and V-N with independent file-byte checks.

### [ ] R08 — Retain a published output's passive dependencies

**Depends on:** R07. **Size:** M.
**Deliver:** Publication dependency declarations with embed/copy resolution and atomic retention.
**Acceptance:** A report referencing a bundled image still renders after package removal; failed
dependency copy publishes nothing; retained revisions protect dependencies from premature cleanup.
**Likely files:** Native artifact store, `src-tauri/src/document_library.rs`, publication contract,
document presentation resolver, retained-dependency tests.
**Verification:** V-D/V-N including package removal, copy failure and retained-old-revision access.

### [ ] R09 — Select a retained artifact for another capability

**Depends on:** R07, R08, C02. **Size:** M.
**Deliver:** The artifact branch of the shared Library picker with recipient/revision-scoped read grants.
**Acceptance:** Package B reads A's selected output after A is removed; a reference alone grants no
access; read-only selection cannot overwrite the original or expose unrelated files.
**Likely files:** Library picker, artifact grant/store adapter, public artifact client, contract,
cross-package selection tests.
**Verification:** V-D, focused V-UI and V-N using two independent archives without export/re-import.

### [ ] K6 — Retained output and reuse

**Depends on:** R07, R08, R09.
**Verify:** Original bytes, citations and required passive assets survive producer removal; dependent
publication is atomic; a second package receives only selected read scope. Update the exported kit.

### [ ] R10 — Reopen the correct editor without losing a draft

**Depends on:** R03, R09, C05. **Size:** M.
**Deliver:** Declared page targets and host-mediated navigation with authorized resource context.
**Acceptance:** Reopen result A while B has unsaved changes without silent loss; missing/disabled/
incompatible package offers retained preview/export; links carry no grants and execute no command.
**Likely files:** `src/app/App.tsx`, `src/features/capabilities/CapabilityPage.tsx`, navigation adapter
(new), public page contract, reopen/draft tests.
**Verification:** Focused V-UI and V-N for save/discard/cancel, return navigation and removed targets.

### [ ] R11 — Activate compatible code and private data transactionally

**Depends on:** R06, R08, C08. **Size:** M; split transaction and recovery slices if necessary.
**Deliver:** Staged private-data migration and a compatible rollback pair with explicit loss review.
**Acceptance:** Migration has no agent/network/board/publication effects; crashes before/after activation
leave a recoverable code/data pair; rollback never rewinds user artifacts or silently discards private edits.
**Likely files:** `src-tauri/src/capability_runtime.rs`, migration state/store (new), installer UI,
registry schema, crash/rollback tests.
**Verification:** V-P, ordered fault injection, V-N rollback/reinstall and handoff-versus-removal race.

### [ ] R12 — Play a user-selected local file through the music package

**Depends on:** R05, R09, R10. **Size:** M.
**Deliver:** Host local-file selection with a scoped media handle, plus the minimal music reference
package using the existing continuing service. No online music backend or account system.
**Acceptance:** M3 passes without an agent; pause is immediate; navigation preserves playback while
disable/uninstall releases media and file handles.
**Likely files:** Native file-selection adapter (new), media Host client, music manifest/entry,
local-file/playback tests.
**Verification:** V-K and V-N with local synthetic audio, picker dismissal and revoked handles.

### [ ] K7 — User-facing lifecycle gate

**Depends on:** R10, R11, R12.
**Verify:** Reopen paths preserve drafts, migration/rollback is recoverable, and playback stops at the
correct boundary. Independent host work still survives removal. No private SDK is needed by music.

### [ ] R13 — Build the presentation and retained-output reference workflow

**Depends on:** R08, R09, R10, R11. **Size:** M.
**Deliver:** Minimal fixed-layout PPT generation/edit-and-export example with editable text fields, a packaged
template and a second
consumer fixture. Use an existing suitable package library only after checking its contract/license.
**Acceptance:** M2 passes with an independently readable PPTX; user can reopen the selected result;
producer uninstall leaves export, required assets and recipient-authorized reuse intact.
**Likely files:** Presentation manifest, entry/job module, template asset, package tests,
second-consumer desktop fixture.
**Verification:** V-K/V-N, independent PPTX reader, failure during commit/export and bundled-image retention.

### [ ] R14 — Verify a small non-AI game and hostile-runtime fixture

**Depends on:** R03, R06, R11. **Size:** S.
**Deliver:** Small interactive game with assets and private save state, plus the existing P02/R03 hostile
fixture packaged through the public kit. Do not turn it into a full game product.
**Acceptance:** M4 passes without an agent; saved state follows declared schema/update rules;
unresponsive package code is stoppable without breaking shell management or another package.
**Likely files:** Game manifest/entry, small asset, game test, packaged containment fixture.
**Verification:** V-K and V-N with two packages, infinite loop, DOM/style attempts, disable and reinstall.

### [ ] R15 — Verify headless invocation through the real conversation broker

**Depends on:** R04, R07, C07. **Size:** S.
**Deliver:** Page-free package with one immediate operation and one long-work command.
**Acceptance:** M5 passes without a placeholder page; the immediate path creates no Job; invalid inputs,
disabled commands and writes mislabeled as reads cannot bypass checks.
**Likely files:** Headless manifest/entry, command tests, broker desktop fixture.
**Verification:** V-P/V-A/V-K and V-N through chat discovery/invocation, not only direct function calls.

### [ ] K8 — Phase 2 acceptance

**Depends on:** R13, R14, R15, R12.
**Verify:** V-F; M2–M5/M8 and phase-2 M7; rerun M1 through the isolated runtime. All runtime and
resource budgets have measured limits. Legacy packages remain accurately labeled and usable.
Retain failures as blockers; no claim of untrusted-package support based only on a mock or static check.

## Phase 3: repeatability, scheduling and compatibility

### [ ] T01 — Harden kit consistency and failure fixtures

**Depends on:** R13, R14, R15. **Size:** M.
**Deliver:** Automated consistency checks among canonical schema, runtime validation, generated SDK,
Skill instructions and fixtures. Expand the already-working kit rather than create another SDK.
**Acceptance:** Unsupported API/permission drift fails a check; examples build from the exported kit;
local user edits to installed Skills remain preserved through upgrade/recovery.
**Likely files:** `scripts/build-capability-kit.mjs`, starter checker, developer Skill,
`tests/developer-kit.test.ts`, `src-tauri/tests/developer_integration_test.rs`.
**Verification:** V-K, all reference package checks and existing integration conflict/recovery tests.

### [ ] T02 — Improve trial installation and package-specific reload

**Depends on:** T01. **Size:** M.
**Deliver:** Developer controls over the existing isolated-profile workflow: inspect/trial install,
permission preview, selected-package reload and useful diagnostics.
**Acceptance:** Reload does not disturb another package or ordinary user data; failed trial leaves the
last valid package available; diagnostics distinguish simulated, desktop and real-service results.
**Likely files:** `DeveloperCenterModal.tsx`, `PackageImportModal.tsx` in capabilities,
`src-tauri/src/developer_integration.rs`, profile/reload helper, trial-install tests.
**Verification:** V-K, focused V-UI and V-N using failing and locally modified packages.

### [ ] T03 — Establish the supported-version and platform compatibility matrix

**Depends on:** T01, T02. **Size:** M.
**Deliver:** Versioned legacy/new-format fixtures and a runnable conformance matrix with explicit
agent/OS support claims. Begin with the actual tested desktop platform, not assumed parity.
**Acceptance:** Compatible pairs pass and incompatible requirements fail before execution; a second
clean profile uses different paths/settings; missing real-adapter/platform evidence remains unverified.
**Likely files:** Conformance runner (new), compatibility fixture index, representative legacy/new
manifests, compatibility report.
**Verification:** V-P/V-K/V-N across the declared matrix; record exact versions and meaningful exclusions.

### [ ] K9 — Independent development gate

**Depends on:** T01, T02, T03.
**Verify:** M7 is repeatable with only the distributed kit on a clean profile; developer reload is
isolated and compatibility claims match evidence. No broad platform support claim without a test run.

### [ ] T04 — Create an authorized in-app job schedule

**Depends on:** T03, C07. **Size:** M.
**Deliver:** Host review UI and persisted schedule binding job/version, source policy, timezone,
approved effects and stable occurrence identity. Reuse Jobs rather than add another execution engine.
**Acceptance:** No schedule exists after dismissal; repeated creation/occurrence starts one run;
trigger only executes while the host is available and under the approved scope.
**Likely files:** Native schedule store/dispatcher (new), schedule review UI (new), public schedule
contract/client, schedule persistence tests.
**Verification:** Deterministic clock/restart tests and V-N; do not use real-time waiting as the only proof.

### [ ] T05 — Apply missed-run and revocation policy to schedules

**Depends on:** T04, R11. **Size:** M.
**Deliver:** Pause/resume/remove, missed-occurrence handling and lifecycle integration.
**Acceptance:** Downtime/timezone changes follow the displayed policy without duplicate catch-up;
revocation/disable/uninstall prevents further triggers; changed scope/version requires the defined review.
**Likely files:** Schedule store/dispatcher, `src/platform/capability-runtime.ts`, native lifecycle owner,
schedule status UI, lifecycle/schedule tests.
**Verification:** Fault/clock tests and V-N restart, disable/re-enable, update and uninstall.

### [ ] T06 — Build the scheduled weekly-report reference package

**Depends on:** T05, R08, T01. **Size:** S.
**Deliver:** A small report package using selected inputs, approved scheduling and reviewable drafts.
Only add a notification primitive if the demonstrated completion flow requires it; split that addition.
**Acceptance:** M6 passes; sources and effects match the approved schedule; no automatic publication
or background execution is claimed after Nooki exits.
**Likely files:** Weekly-report reference manifest, entry/job module, package tests, acceptance fixture.
**Verification:** V-K/V-N plus deterministic missed-run checks and one recorded real-agent generation.

### [ ] K10 — Scheduling gate

**Depends on:** T04, T05, T06.
**Verify:** M6, schedule failure tests and updated public kit pass. Restart catches up only as approved;
package removal leaves no executable trigger. Scheduling does not widen existing input grants.

### [ ] T07 — Migrate the supported first-party example without deleting legacy data

**Depends on:** T03, T06. **Size:** M.
**Deliver:** Move one supported first-party example (start with `examples/checkpoint-demo`) to the
released public path and publish the legacy package inventory/migration guide. Inventory the hidden
weekly-review package explicitly; do not resurrect or delete it merely to satisfy a sample checklist.
**Acceptance:** Migrated example needs no internal imports or special privileges; historical references
and v1 fixtures remain usable; any further supported bundled packages get separate suffixed tasks.
**Likely files:** Example manifest/entry/tests, migration guide, legacy inventory fixture.
**Verification:** V-P/V-K/V-N with an upgrade fixture; defer v1 removal until the design's retirement criteria pass.

### [ ] T08 — Record final clean-install and upgrade acceptance

**Depends on:** T07, T06. **Size:** M, acceptance delivery.
**Deliver:** M1–M8 evidence on the supported matrix, including fresh install, upgrade, uninstall and
retained output, plus user/developer troubleshooting and remaining limitations.
**Acceptance:** A second user profile can build/install/share without author settings; every required
case has real evidence or an explicit blocker; compatibility/deprecation guidance matches shipped behavior.
**Likely files:** Final acceptance runner, evidence index, compatibility guide, troubleshooting guide,
release-readiness note. No automatic release/tag/publication is part of this task.
**Verification:** V-F/V-K/V-N on the exact assembled revision and V-APP; reuse unchanged recorded evidence
where appropriate and rerun affected scenarios after new fixes.

### [ ] K11 — Phase 3 and implementation completion

**Depends on:** T07, T08.
**Verify:** All task receipts and M1–M8 gates pass; updated kit and actual application agree; PRs are
delivered for human review, with merge/release status stated separately. Keep unresolved external
verification as a blocker. Do not mark implementation complete merely because documentation is finished.
