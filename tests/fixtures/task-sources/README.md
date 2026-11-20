# Disposable native task-source fixture

Create a fresh profile with `node scripts/desktop-profile.mjs create`, then run
`python3 tests/fixtures/task-sources/seed.py <profile-path>` before its first launch.
Launch the installed build with `node scripts/desktop-profile.mjs launch <profile-path>
/Applications/Nooki.app/Contents/MacOS/app` (one shell command).

The fixture contains only synthetic data: a changed current document, an original selected
snapshot with a revocation marker, a missing-grant control, and a plain-reference control.
The queue is paused. Synthetic agent sign-in status enables the delegate control but contains
no credentials; the test-profile prohibition on real agent execution remains enabled.

Native acceptance procedure:

1. Open Selected snapshot task and its citation; expect ORIGINAL SELECTED CONTENT.
2. Return to the task, explicitly delegate it, and keep the queue paused. Expect queued state
   and a captured task snapshot containing the original body. Open the citation again.
3. Delegate Missing source task. Expect an error and unchanged todo/authorization state;
   a pending native request receipt may exist without authorizing execution.
4. Open Current document task's citation; expect CHANGED CURRENT CONTENT.
5. Quit and restart the same profile; check retained snapshot and queued state.

Do not claim a real agent run or public ZIP selection/create flow from this fixture. Public
sourced creation and the independent distributed-kit scenario are tracked under C03c.
