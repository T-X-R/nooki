# Desktop pet

Settings includes a **Wake Nooki** switch within **Appearance**, with no preview card or separate section. The switch is off by default. Enabling it shows the Nooki cat above ordinary desktop windows. The task-board avatar remains static.

The pet's eyes reflect its highest-priority activity. When Codex needs a reply or approval, the cat tilts its head with one tall white eye and one round eye. A blocker, usage limit, or budget limit gives it slowly turning spiral eyes. An unread delivery gives it star eyes and a small hop. During execution it nods with focused eyes. Other states and snapshot read errors show the idle cat. With reduced motion enabled, each expression uses its matching still image.

The idle animation remains transparent lossless WebP (3.2 seconds per loop). Questions, blockers, and unread deliveries take precedence over running tasks. A review task stays in the list until accepted, but stops selecting the pet's animation once its result is visible in the foreground execution conversation. The main and pet windows share a local read receipt for each task and delivery turn. A revised delivery has its own receipt. Older review tasks without a delivery turn ID appear in the list only.

## Interaction

- Drag the cat to move it. Its bottom-right anchor and enabled preference are saved locally in `desktop-pet.json`.
- Click the cat to expand task activity. No status label is displayed beneath the cat. Click a task to open its existing conversation in the main window.
- Questions and approvals take priority, followed by blocked/limited tasks, review, active work, queued tasks, and paused/stopped tasks. States appear in the expanded task list.
- Archived tasks and accepted tasks without activity are omitted. Active turns and requests remain visible even after task acceptance. Queue pickup pause does not hide active work.
- A task without a thread shows its state but cannot navigate until a conversation exists.
- Escape, the collapse button, or loss of window focus collapses the list. Reading errors are shown as unavailable, never idle, and are retried.
- The pet has no composer, approvals, pause/stop, acceptance, or execution controls. Those remain in their existing task-board/conversation surfaces.

## Ownership and lifecycle

The pet renderer has its own entry point. It does not mount `App`, the task dispatcher, capability bridge, or a Codex client. Every two seconds it reads a small projection of the worker's atomically saved task board through a dedicated native command. Reading never launches a worker or issues a Goal/turn command.

Only task IDs, titles, status, conversation IDs and activity flags reach this renderer. Opening a conversation validates the current task association, saves the navigation target in a native mailbox, shows the main window, and notifies it. Main subscribes before checking the mailbox, so startup cannot lose a jump. It acknowledges the target after accepting it.

When enabled, closing main hides its window and leaves the pet visible. Disabling the pet destroys only its window. Quitting the desktop process closes the pet; the existing independent background worker keeps its established lifecycle. Restarting the desktop app restores the preference and position without starting a task. No login item is installed.

The native host stores enabled state and position because these are shared across windows and needed before main's renderer starts. Appearance and language follow the existing main-window preferences. Restored positions are clamped to a connected display's work area, accounting for its scale factor.

Expanding and collapsing use a retained bottom-right anchor rather than reading intermediate native window geometry. Repeated collapse requests from conversation navigation and focus loss are idempotent, so opening a conversation leaves the cat in place.

The activity panel adapts to screen edges independently of the cat. Near the left edge it opens toward the right; near the right edge it opens toward the left. It prefers the space above the cat and switches below when the upper edge leaves insufficient room. The window stays within the display's work area while a renderer offset preserves the cat's screen position, including when dragging an expanded window.

The desktop implementation is verified on macOS. Browser previews do not expose the desktop-only setting. The pet's window permission set allows events and dragging; its feature commands validate the calling window.

## Verification

- Unit tests cover task priority, archive/acceptance filtering, active accepted tasks, queue pause, per-task pause/stop, and limits.
- Native tests cover preference persistence, read-only empty snapshots, multiple-monitor coordinates, off-screen clamping, all four screen corners at standard/Retina scale, and duplicate collapse transitions preserving the anchor.
- `tests/ui/desktop-pet.mjs` covers settings ordering/toggling, compact and expanded layouts, direct conversation navigation, unavailable-state recovery, light/dark appearances, and reduced motion.
- Native desktop checks verify the real setting, transparent cat, activity list, existing-thread navigation, and main-window closing with the pet retained.
