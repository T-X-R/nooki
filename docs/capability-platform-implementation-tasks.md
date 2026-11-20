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
P00/P01/P02 evidence reconciled; C01 is next. No production runtime or later gate is marked complete.

**Depends on:** P00, P01, P02.
**Verify:** Baseline is reproducible, the minimal external-project path works, and a feasible runtime
approach is recorded. No source/credential leakage between profiles. Unresolved feasibility failures
block production runtime promises; reconcile them before freezing transport-dependent contracts.

## Phase 1: one complete meeting workflow through public services

### [ ] C01 — Bind a Host mutation to invocation identity and scoped authority

**State:** in-progress; split into C01a–C01c before implementation because authority lifecycle,
worker persistence and public Host delivery have separate verification boundaries.

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
Generation-bound handles and lifecycle invalidation are integrated. No new package-callable endpoint;
C01b/C01c and the C01 parent remain pending. Same branch and PR #38, pending human merge.

**Depends on:** P02. **Size:** M.
**Deliver:** A bounded native authority store and installation-generation tracking, integrated with
install/update/disable/uninstall. This is host-controller infrastructure, not a new package API.
**Acceptance:** Handles bind actual native caller, package/version, generation and the first board
operation/resource scope; forged/unknown handles and stale generations fail; revocation is serialized
with the synchronous effect check. Restart never restores live invocation handles.
**Verification:** Native lifecycle, wrong-caller/scope, revoke/effect ordering and capacity tests.
No production isolated-transport claim; C01b/C01c remain required for the public mutation path.

### [ ] C01b — Persist the first board effect and idempotency receipt atomically

**Depends on:** C01a. **Size:** M.
**Deliver:** Worker-side create-item transaction with canonical payload hash and durable result,
including authority-generation validation coordinated with lifecycle changes across processes.
**Acceptance:** Same key/input returns one durable result; changed input conflicts; restart and
reply loss do not duplicate the effect; revoked/old-generation requests cannot commit. Creating an
item neither delegates nor starts an agent.
**Verification:** Actual board-file readback, concurrent/restart/failure/revoke tests through the
native owner; keep existing task-worker behavior intact.

### [ ] C01c — Connect authorized Host mutation requests and document the contract

**Depends on:** C01b. **Size:** M; split if public delivery requires it.
**Deliver:** Trusted-controller issuance, bounded Host adapter, canonical error/idempotency types,
kit/Skill updates and actual desktop verification. Package requests cannot choose owner or grants.
**Acceptance:** Native caller binding reaches the authoritative operation; forged input is refused;
public preview reports unsupported desktop operations; disabling invalidates the old caller.
**Verification:** V-P, exported-kit checks and native negative cases. C03 owns the completed public
board workflow/UI; do not mark C01 complete from C01a alone.

### [ ] C02 — Let a capability select and read authorized document snapshots

**Depends on:** C01. **Size:** M.
**Deliver:** The document branch of the host Library picker, returning recipient-scoped snapshot grants.
**Acceptance:** Picker shows recipient/purpose; dismissal reads nothing; only chosen snapshots are
readable and revocation prevents later reads. Existing citations continue to resolve for the user.
**Likely files:** `src/platform/document-grants.ts`, `src/features/library/LibraryDialogs.tsx`,
`src-tauri/src/document_grants.rs`, contract, focused grant/picker test.
**Verification:** V-D, focused picker V-UI and V-N; exercise two package identities and denied sharing.

### [ ] C03 — Create a task-board item without implicitly delegating it

**Depends on:** C01. **Size:** M.
**Deliver:** Public item creation over the native board owner, with stable result and provenance.
**Acceptance:** Authorized creation survives restart; duplicate requests create one item; creation
cannot self-authorize execution or mark a delivery accepted.
**Likely files:** `src-tauri/src/task_goals.rs`, native Host board adapter (new), contract,
`src/features/task-board/task-board.ts`, board API tests (new).
**Verification:** V-B plus receipt-failure/retry tests and V-N; verify current Goals behavior is preserved.

### [ ] K1 — Selected inputs and durable board creation

**Depends on:** C01, C02, C03.
**Verify:** Grant and idempotency failure cases pass through the real Host; current ZIP, document and
board regressions pass. The outside-checkout fixture uses the updated kit without private imports.

### [ ] C04 — Select an existing task and attach a delivery with a scoped grant

**Depends on:** C02, C03. **Size:** M.
**Deliver:** Host-owned task picker and delivery attachment to an existing item.
**Acceptance:** User sees the requested operation; attachment checks item grant and expected revision;
denial/conflict preserves the item and the grant cannot accept, delegate or mutate other items.
**Likely files:** Task selection component (new), native Host board adapter, contract,
`src/features/task-board/TaskReferences.tsx`, focused selection/attachment tests.
**Verification:** V-B, focused V-UI and V-N including another user's edit between selection and write.

### [ ] C05 — Hand selected context to a native conversation draft

**Depends on:** C02. **Size:** M.
**Deliver:** Idempotent handoff returning a conversation/draft receipt with authorized input references.
**Acceptance:** Opening a draft sends no turn; existing unsent user text is not overwritten; target
and source scope cannot be chosen by an ungranted ID or replayed into another conversation.
**Likely files:** `src/features/conversation/conversation-client.ts`, conversation handoff module (new),
`src-tauri/src/conversation_host.rs`, contract, handoff tests.
**Verification:** V-A, focused V-UI and V-N; cover dismissal and repeated handoff.

### [ ] C06 — Expose one observable agent-run path

**Depends on:** C01, C02. **Size:** M.
**Deliver:** Start/get/subscribe/cancel semantics for one supported existing agent adapter, using host
approval/question surfaces and durable run identity. No new model client or credential store.
**Acceptance:** Inputs and permitted effects are bounded; missing agent or rejected approval starts
no work; reconnect observes the same run and preserves structured result/artifact references.
**Likely files:** Native agent-run adapter (new), `src-tauri/src/conversation_host.rs`, public agent
client (new), contract, adapter/run tests.
**Verification:** V-A and deterministic transport/approval failures; V-N with one recorded real-agent run.

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
