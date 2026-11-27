# Capability platform implementation plan

- Date: 2026-11-19
- Planning baseline: design revision `c631006`; application baseline remains Nooki 0.3.2
- Status: implementation underway; current status is recorded in the task checklist
- Design authority: [Capability platform design](capability-platform-design.md) and [ADR 0006](adr/0006-capabilities-as-the-product-core.md)
- Task state and detailed acceptance: [implementation checklist](capability-platform-implementation-tasks.md), the single task-status record
- Current review: [PR #38](https://github.com/T-X-R/nooki/pull/38)

## Current execution policy — revised 2026-11-27

The owner clarified that **the complete approved toolbox scope is retained, with Codex as the only
Agent adapter in the current implementation**. The problem is overly detailed verification holding
back development. Change the timing and granularity of testing, not the promised functionality or
its authority boundaries. This section supersedes the original sequencing, task-splitting and
verification-gate timing below. Existing task IDs remain the completion record; no new preparation
phase or suffixed qualification checkpoints are added.

### Development order

| Order | Complete functional path to implement | Existing task coverage |
| --- | --- | --- |
| **1 — in progress** | Package request → Host review → Codex execution → observable progress/questions/cancel → retained result → saved/reopened meeting notes. Reopening observes the same run. | C06c–C06e, the required C07 behavior, and the C09 package caller developed together |
| 2 | Attach results to existing/new tasks, hand drafts to chat, and explicitly delegate independent Host work that survives package removal. | Remaining C07–C09 |
| 3 | Versioned packages and isolated runtime, immediate commands and continuing services, transactional update/removal, local music and non-AI game packages. | R01–R06, R10–R12, R14 |
| 4 | Presentation generation/export, retained binary assets, cross-package selection, editor reopening and headless/chat invocation. | R07–R09, R13, R15 |
| 5 | Complete exported development Skill/kit and developer workflow, supported compatibility behavior, schedules/weekly reports and legacy migration. | T01–T07 |
| **6 — consolidated acceptance** | Run the complete assembled toolbox through the remaining desktop, lifecycle, compatibility, fault and upgrade scenarios; fix failures and record final acceptance. | Pending K2–K11 verification, C06e/C09 and reference-package acceptance, T08 |

Reuse the existing journal, Codex transport, selected snapshots, Library publication and document
views. The immediate engineering work is the actual Host-owned launch and result reconciliation,
connected to its review/status/cancel UI and exported SDK/package caller in the same functional
path. Internal commits are allowed; an adapter-only commit or standalone probe is not a completed
user feature. Keep all original service/lifecycle requirements, including Host questions/approvals,
structured results, cancellation parentage, independent handoff and retained artifacts.

### Core tests during development

Run focused tests for the behavior being changed, and only the shared regressions it can affect:

- The normal requested flow reaches its real result/storage owner.
- Missing approval, foreign/revoked input or an invalid installation cannot authorize an effect.
- A repeated start or lost reply cannot silently create duplicate execution.
- Where the change involves cancellation, restart or persisted state, verify the relevant state
  transition and visibility of an uncertain outcome. Never automatically replay uncertain work.

These are checks on the implementation, not a requirement to enumerate every failure combination.
A confirmed defect in the active path is fixed immediately. Do not defer a known authorization,
data-loss or duplicate-execution defect merely to finish coding faster. Keep native model/tool/auth
ownership and the current trusted-only package boundary until the planned isolation is implemented.

### One consolidated acceptance pass after development

Defer the following broader verification to the final assembled implementation: repeated full
installed-app walkthroughs, compatibility/authentication/platform matrices, long-running/resource
measurements, exhaustive crash/write-fault permutations, broad containment variants, and the full
clean-install/upgrade/update/rollback/uninstall suite. Implement the corresponding features in the
order above; deferring their tests does not remove those features or declare their acceptance passed.

The final pass includes the installed Codex/meeting path and the music, presentation, game, headless
and scheduled-report workflows from the original plan. Record actual model calls separately from
synthetic fixtures and honor the existing execution authorization. A fixture is not evidence of a
real authenticated model run. Other Agent adapters are outside the current Codex-only work.

Existing evidence is reused for unchanged behavior. Do not rerun the historical native probe set,
full repository suites or documentation/compatibility matrices for each intermediate edit. Maintain
one compact running result entry per functional delivery instead of one document per experiment.
Build/reinstall the local app for each completed code delivery as required by the project; do not
repeat a build solely for unchanged-code reassurance. A feature can be recorded as development/core
tests complete while final acceptance remains pending. Do not report the whole project complete
until the consolidated acceptance pass and required delivery steps are finished.

## 1. Scope and starting point

Implement the approved toolbox design incrementally. Preserve current packages and user data while
opening shared Host services, introducing independently stoppable package runtimes, and making the
developer Skill sufficient for independent development. This plan creates no implementation, API,
package format, release, or claim that future acceptance tests already pass.

The original inventory has 35 parent tasks and 12 checkpoints. The revised execution policy above
groups remaining tasks into usable workflows; do not add more suffixed preparation tasks. Earlier
design review and the baseline's passing tests do not count as implementation completion.

The design specifies behavior; this document specifies sequencing and delivery. Keep product scope
unchanged. Exact schema spelling, isolation topology, and budgets are resolved by the designated
tasks with evidence. If an experiment cannot meet a design invariant, report the result and revise
the proposal explicitly; do not weaken acceptance or silently broaden permissions.

## 2. Execution order and phase gates

| Order | Tasks | Delivered outcome | Checkpoint |
|---|---|---|---|
| 1 | P00–P02 | Reproducible baseline, minimal portable kit/profile, early runtime feasibility decision | K0 |
| 2 | C01–C03 | Scoped invocation context, selected documents, idempotent board-item creation | K1 |
| 3 | C04–C06 | Existing-task attachment, chat draft handoff, observable agent work | K2 |
| 4 | C07–C09 | Cancellation ownership, independent host delegation, external meeting package | K3: phase 1 exit |
| 5 | R01–R03 | New package structure, authenticated bridge, isolated page execution | K4 |
| 6 | R04–R06 | Immediate commands, continuing services, approved-source update boundary | K5 |
| 7 | R07–R09 | Durable binary output, retained dependencies, cross-package selection | K6 |
| 8 | R10–R12 | Reopen navigation, transactional private-data migration, local music package | K7 |
| 9 | R13–R15 | Presentation, game and headless reference packages | K8: phase 2 exit |
| 10 | T01–T03 | Hardened public kit, development UX, repeatable compatibility coverage | K9 |
| 11 | T04–T06 | Authorized in-app scheduling and a weekly-report package | K10 |
| 12 | T07–T08 | Supported-example migration and final clean-profile/upgrade evidence | K11: phase 3 exit |

The table contains **12 checkpoints, K0–K11**; K0 is the preparation checkpoint, followed by 11
delivery checkpoints. Use the IDs, not an inferred percentage, when reporting progress.

This table records the original order. Follow the revised execution policy above. Dependency lists in the checklist additionally
describe what each task consumes. An unmet requirement must remain visible, but it does not prevent implementing the other parts of
the same end-to-end delivery. P02 brings design slice 2A's bounded feasibility experiment forward; production runtime
replacement still belongs to phase 2. It prevents phase 1's transport assumptions becoming an
accidental permanent contract.

```mermaid
flowchart LR
    P[P00-P02: baseline, kit, feasibility] --> C[C01-C09: meeting workflow]
    C --> G1[K3: phase 1 gate]
    G1 --> R1[R01-R06: runtime and commands]
    R1 --> R2[R07-R12: output and lifecycle]
    R2 --> R3[R13-R15: reference packages]
    R3 --> G2[K8: phase 2 gate]
    G2 --> T[T01-T08: development and compatibility]
    T --> G3[K11: phase 3 gate]
```

The following are retained acceptance criteria; broader checks are executed in the consolidated final
pass, rather than repeatedly gating the next development task.

**Phase 1 / K3:** M1 and phase-1 M7 pass using an exported kit and an isolated desktop profile.
Package-owned child execution cancels correctly; separately authorized host work survives removal.
The legacy same-realm runtime remains explicitly trusted-only.

**Phase 2 / K8:** M2–M5, M8 and phase-2 M7 pass, with M1 rerun against the new runtime. Containment,
forced stop, passive dependency retention, cross-package file selection, and update/reinstall data
boundaries must be proven in desktop Nooki. No untrusted-package claim before this gate.

**Phase 3 / K11:** M1–M8 pass on the declared support matrix. Scheduling has explicit availability
and missed-run semantics. An independent user can use the exported kit, install packages on a clean
profile, upgrade, and remove them without host source or private author settings.

## 3. Existing owners to extend

These are code-navigation anchors, not permission to refactor whole subsystems. Each task lists a
small starting footprint; proposed new files are marked as such in the checklist.

| Concern | Existing owners and regression anchors |
|---|---|
| Public contract and kit | `packages/capability-contract/src/index.ts`, `scripts/build-capability-kit.mjs`, `skills/workbench-capability-dev/`, `tests/developer-kit.test.ts` |
| Package loading and lifecycle | `src/platform/capability-runtime.ts`, `src/platform/package-loader.ts`, `src-tauri/src/package_installer.rs`, `src-tauri/src/capability_runtime.rs` |
| Invocation and execution | `src/platform/capability-broker.ts`, `src/platform/tasks.ts`, `src/platform/task-runner.ts`, `src-tauri/src/task_execution.rs` |
| Board ownership | `src/features/task-board/task-board.ts`, `src/features/task-board/task-board-store.ts`, `src-tauri/src/task_goals.rs`, `src-tauri/src/task_worker.rs` |
| Chat and agents | `src/features/conversation/conversation-client.ts`, `src/features/conversation/conversation-jobs.ts`, `src-tauri/src/conversation_host.rs`, `src-tauri/src/agent_tools.rs` |
| Documents and grants | `src/platform/document-grants.ts`, `src/platform/document-library.ts`, `src-tauri/src/document_grants.rs`, `src-tauri/src/document_library.rs` |
| Navigation and installation UI | `src/app/App.tsx`, `src/features/capabilities/CapabilityPage.tsx`, `PackageImportModal.tsx`, `DeveloperCenterModal.tsx` in that feature directory |

In particular, the native Goals/worker path already owns current task-board execution. Do not expose
the legacy renderer-only dispatcher as the new authoritative board execution API. P00 must reconfirm
the owning paths before modification; repository state may change after this plan was written.

## 4. Per-task delivery contract

1. Read the design sections named by the task and verify dependencies against the current tree and
   the evidence receipts. Record the task as in progress with its branch/PR and concrete scope.
2. Deliver one usable path, including its UI when needed, authority checks, failure behavior, focused
   tests, and corresponding exported SDK/Skill update. Do not implement the rest of a service catalog.
3. Run the focused core checks for the changed flow. Retain installed/archive acceptance for the
   consolidated final pass unless needed to resolve a concrete active-path failure. Simulated
   preview and mocked browser tests remain separate evidence, not native acceptance.
4. Apply the repository's delivery workflow: commit, push, keep the active PR open for human review,
   and rebuild/reinstall the local desktop app after each completed verified change. Quit normally
   first and use the existing installer; do not terminate unrelated agent work.
5. Save the task's evidence receipt and update its checklist status. An unchecked failure or unavailable
   external verification cannot be relabeled passed to clear the next gate.

S and M are historical sizing hints, not instructions to split an integrated user flow into more
standalone milestones. Keep edits focused and internally reviewable, but deliver its native, UI,
SDK and package pieces together. Intermediate commits are allowed; a commit is not a new acceptance
checkpoint or a reason to rebuild unchanged code. No speculative service catalog is added.

Task IDs do not automatically create new requirements, branches, or PRs. Reuse the existing branch,
worktree and open PR for this ongoing requirement, as project instructions require. After a human
merge, fetch current `origin/master` and follow the normal feature-branch workflow for the next
authorized delivery. Never merge automatically, push to `master`, or upload local `AGENTS.md`.

## 5. Verification commands and evidence

Run the focused suites for the changed behavior. Add meaningful tests for the new operation before
claiming its acceptance; the baseline commands below do not by themselves cover future services.

| Code | Baseline command / verification procedure |
|---|---|
| V-P | `node --test tests/package-loader.test.ts tests/capability-broker.test.ts tests/task-runner.test.ts` and `cargo test --offline --test package_installer_test --test capability_runtime_test` in `src-tauri` |
| V-K | `node --test tests/developer-kit.test.ts` and `cargo test --offline --test developer_integration_test` in `src-tauri`; export kit, scaffold outside checkout, check and pack there |
| V-D | `cargo test --offline --test document_grants_test --test document_library_test` in `src-tauri`, plus focused Library tests for changed behavior |
| V-B | `node --test tests/task-board.test.ts` and `cargo test --offline --test task_goals_test` in `src-tauri`; preserve native board semantics |
| V-A | `node --test tests/conversation.test.ts tests/capability-invocations.test.ts tests/conversation-capability-sources.test.ts` and affected native conversation/agent tests |
| V-UI | Relevant scripts in `tests/ui/`, with their configured local server and installed browser dependency; record mocked-host coverage as such |
| V-N | Actual packaged archive on the isolated desktop profile; retain steps, observed UI/state and artifact results, including restart/uninstall where specified |
| V-F | At phase gates: `npm test`, `npm run build`, `cargo test --offline` in `src-tauri`, relevant UI regressions, and the phase's V-N scenarios |
| V-APP | `npm run desktop:build`, normal quit, `npm run desktop:install`, and `codesign --verify /Applications/Nooki.app` on the current macOS environment |

New suites introduced by a task must have their exact runnable command added to its receipt. Existing
UI scripts are browser harnesses; arrange their server and dependencies rather than assuming a
Playwright installation or treating a harness as native isolation proof. Run V-APP for completed
changes per project policy. During development, use focused core evidence plus the build for the completed delivery.
Broader V-F and installed acceptance are consolidated after functional development, as specified above. Reuse evidence for an unchanged exact revision rather than rerun
the same suite without a new change or unresolved concern.

The first phase uses one available agent adapter. Record a real-agent run for M1 when that integration
is delivered and use deterministic doubles for denial, cancellation and fault tests. Other adapters
enter the declared compatibility matrix explicitly; unsupported policy enforcement must be reported
as unsupported, not approximated by a prompt. External dependency failure is unverified/blocked
evidence, not a pass or a reason to implement another model client.

Each completed user-facing delivery updates a compact receipt under `docs/capability-platform-evidence/<ID>.md` (create only
when work is performed): commit and PR, host/SDK/package versions, tested platform/profile, exact
commands and results, acceptance IDs, real versus simulated checks, artifact identity, limitations,
and next implementation step. Distinguish development/core-test completion from pending final acceptance. Do not put credentials or private source content in these receipts.

## 6. Status and resumption rules

`docs/capability-platform-implementation-tasks.md` is the only status checklist. Use unchecked entries for pending work; add `State:
in-progress`, `State: blocked`, or `State: review` with a reason and receipt when appropriate. Mark
checked only when the task's acceptance and delivery contract pass. Use `development/core tests complete;
final acceptance pending` when broader validation is deliberately deferred; that state does not block
the next development task unless a concrete dependency is still unimplemented or its core test fails. Record human merge separately
from verified implementation; an open PR is not a failed test and a merged PR is not proof of native
acceptance. Checkpoints require actual evidence, not merely checked task headings.

At the start of a later chat, read this plan, the checklist, the last relevant receipt and the current
Git state. Choose the next incomplete user-facing delivery in the revised order above; implement its missing
parts together and use the old task IDs to record the specific remaining requirements.
Carry forward accepted scope and existing work. Do not restart completed tasks, invent progress from
design prose, or bypass a failed containment/migration gate. Report progress by completed IDs and
current gate, not a percentage based on unequal task sizes.

Useful future instructions are “Start P00”, “Continue the next eligible task”, or “Review K3”. A
request to plan does not start any of those tasks. This document carries the workflow forward without
creating automations, tracker issues, or background execution.

## 7. Risk and decision gates

| Risk | Early evidence / response |
|---|---|
| Isolation cannot meet desktop media/termination/egress requirements | P02 experiment before production bridge work; R02/R03 must reproduce it in the application; never equate same-realm checks with isolation |
| Agent cancellation and board ownership diverge | C07/C08 prove dependent cancellation and independent handoff before the meeting gate; repeat on the new runtime |
| SDK contract drifts from implementation | P01 establishes portable generation; every service task ships kit changes; T01 hardens consistency checks |
| Retained file still points into an uninstalled package | R08 atomic dependency retention and R13 independent-reader/uninstall checks |
| Replacement code reads old data before approval | R06 rejects access before source review; R11 rechecks ordering for migration and rollback fault paths |
| Delivery crosses several layers | Keep one user flow and reviewable commits; do not add independent preparation checkpoints |
| New services expand beyond the sample consumers | Require an acceptance use for each operation; unused catalog methods stay deferred |

No calendar commitment is made. Estimate remaining effort after P02 and each phase gate using actual
implementation evidence. Marketplace, arbitrary native package execution, live vendor-run migration,
and capability execution after application exit remain outside this plan.
