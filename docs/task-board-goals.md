# Task board backed by native Codex Goals

Nooki owns the queue, execution context, durable task records, user interaction and delivery review. Codex owns planning, tools, verification, completion decisions and cross-turn continuation through native Goals. A turn ending does not complete a task. There is no host-generated continuation prompt or semantic completion classifier.

New tasks enter the queue automatically. Closing the window leaves an independent worker running. Existing personal to-dos retain their status and existing delegated tasks retain their original scope. A completed Goal becomes ready for human review only after the final turn ends.

Each task retains its native thread and execution context. Resume explicitly restores the working directory, model, approval policy, sandbox and host overrides before reactivating the Goal. Pausing a Goal prevents continuation but permits its current turn to finish; stopping also interrupts the current turn and waits for the native acknowledgement. Reopening the UI never resumes a user-paused Goal.

The worker is the only task-board writer. An OS lock prevents duplicate workers, and local IPC carries operations and snapshots. Persist claims and native thread identities before activating Goals. Uncertain handoffs reconcile the existing thread rather than resend a task. Transport recovery does not grant new permissions or replay external effects.

The task interface exposes working-directory selection, native questions and approvals, execution history and delivery. Library source snapshots and Markdown previews are reused. Codex keeps its configured skills and tools; the previous draft-only restrictions apply only to legacy task sessions. Renderer-dependent Nooki capability packages are not advertised as headless tools.

## Implementation checkpoints

- [x] Native Goal adapter: explicit context restoration, pause versus stop, final-turn barrier, interaction forwarding.
- [x] Durable background worker: queue, single ownership, migration, recovery, IPC and data-maintenance exclusion.
- [x] Task interface: auto-queue, directory selection, controls, native requests, delivery and history.
- [x] Verification: focused regression tests, existing suites, browser lifecycle, real Codex integration, packaged worker.
- [x] Desktop delivery: built, reinstalled and verified the local app; the existing task-board PR remains the review target.

## Validation evidence informing the design

An isolated Codex 0.162.0 app-server test completed four native turns with zero client turn/start or turn/steer requests. Pause survived reconnect and process restart. Native file work continued without a connected client. A restart with only threadId resumed with read-only policy; explicitly restoring the original execution configuration allowed the same thread to finish. Goal completion preceded final turn completion. These synthetic checks establish the integration contract, not acceptance of arbitrary business tasks.

## State and operation contract

| User operation | Host action | Native execution |
| --- | --- | --- |
| Create | Freeze selected references and durably queue a new Goal task | None until a queue slot is available |
| Pick up / resume | Restore and verify execution context, persist the thread, activate its Goal | Codex starts and continues turns |
| Pause continuation | Set the Goal to paused | Current turn finishes; no next turn |
| Stop | Pause the Goal, interrupt active turns, reconcile native history | Show stopping until no active turn remains; keep files |
| Answer / approve | Forward the user's answer or one-time decision to the native request | No inferred answer or automatic approval |
| Request changes | Persist feedback and revise the Goal's request reference | Codex reads the new feedback and decides the work |
| Accept | Mark the delivered task accepted | Does not launch a turn |

Approval policy is `on-request`, with workspace-write sandbox and network access shown at creation. The original model/provider, reasoning effort, reviewer, runtime roots, sandbox and host overrides are retained. A mismatch prevents reactivation. No global Codex configuration is changed. Standard native command/file approvals, per-turn permission requests, synchronous questions and asynchronous question items are supported. Unknown native request types remain visible for user handling. If a disconnected approval is not replayed by Codex, the task reports that fact; Nooki does not fabricate an approval.

The default queue is serial. An uncertain active session holds its slot until reconciled. Queue pickup can be paused separately from an individual Goal. A user-paused or stopped Goal resumes only through explicit action. Native blocked, usage-limited and budget-limited states are surfaced without an automatic retry loop.

The task worker uses a private Unix socket and an OS ownership lock. Durable claims are flushed before activation. The desktop installer hands ownership to the new binary without interrupting Codex. No login item is installed: sleep/offline time does not execute work, and launching Nooki after reboot reconciles retained tasks. Native session history and credentials remain in Codex's own storage.

New Goal history is read through the task worker and has no second conversation composer. Legacy to-dos and delegated draft tasks retain the existing renderer coordinator and original permissions; they are not silently converted to executable Goals.

Delivery text and top-level Markdown/text outputs (up to 50 files, 2 MB each, 8 MB total) are snapshotted after the final successful turn. Code and other file formats remain in the selected workspace and are linked by Codex's final delivery. The existing document preview, comparison, download and Library-save UI is reused. Backup restore requires background execution to be stopped and imports Goals paused; it does not copy Codex credentials/history or arbitrary project directories, nor authorize execution on another machine.

## Implementation validation

- Native protocol fixture: pause versus stop, restart with explicit context, no host continuation turns, approval forwarding, stale renderer writes, policy mismatch, final-turn barrier, immutable delivery, feedback and backup-restore gating.
- Real Codex 0.162.0: a document task produced a verified Markdown artifact and reached human review only after the final turn ended.
- Real worker lifecycle: a four-step file task paused after its first turn, remained paused after worker restart, stopped in its second turn, then resumed the same thread after both worker and app-server restart. Four native turns produced exactly `1, 2, 3, 4`, with no duplicated steps.
- Browser checks cover auto-queue, workspace selection, pause/stop, approvals, questions, persisted state, delivery preview, native history, human acceptance, and legacy task behavior at 980 px and 1240 px in both themes.

The installed macOS bundle was also exercised against the deterministic fixture: a second worker could not claim ownership, and the normal installer handed off and restarted the first worker while retaining its stopped state and original thread.
