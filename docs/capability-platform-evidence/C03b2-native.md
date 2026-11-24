# C03b2: Resumed installed-app acceptance

- Date: 2026-11-24; tested source `8a898fde0d6f5b42c41527f91b5d137c6bb42335`.
- Result: C03b2 native citation/delegation acceptance passes; C03b1 and C03b2 together close C03b.
- Same branch and [PR #38](https://github.com/T-X-R/nooki/pull/38), pending human merge.
- Application: freshly rebuilt and installed Nooki 0.5.0; this increment changes evidence only.

## Setup and control recovery

The [committed source fixture](../../tests/fixtures/task-sources/README.md) seeded fresh profile
`/private/tmp/nooki-profile-QwNWXy`. It contains a changed current document, an original selected
grant already marked revoked, a missing-grant task and a plain-reference task. Agent status metadata
is synthetic and contains no credentials. The queue remained paused and the test-profile agent
execution prohibition remained enabled throughout.

Initially, accessibility button actions could expand tasks and delegate, but citation and sidebar
navigation did not visibly complete, Tab did not move focus, and coordinate input returned
`noWindowsAvailable`. Raising/centering the window did not resolve this. After the user brought
the test window to the current desktop foreground, the pending Library navigation completed and
subsequent navigation and keyboard input worked. This narrows the earlier observation to the
background/native-control conditions; no product fix or general background-rendering guarantee
is claimed. The failed observations remain recorded rather than relabeled as successful clicks.

## Observed native behavior

| Case | Observation |
| --- | --- |
| Explicit delegation | Clicking Delegate on Selected snapshot task changes todo to queued; the paused queue shows one waiting task. |
| Captured source | The persisted task snapshot contains the original selected body and full grant/revision identity, not the changed current body. |
| Missing grant | Clicking Delegate on Missing source task displays `Document grant not found`; it remains todo without authorization. A pending native receipt is retained. |
| Task citation | The queued task opens the Library's retained-source view, labeled as a saved snapshot, showing `ORIGINAL SELECTED CONTENT — retained after revoke.` |
| Native keyboard | From task-detail Close, Tab focuses Open reference; Enter opens the retained snapshot. |
| Current-document contrast | View current document opens `CHANGED CURRENT CONTENT — should not replace the selection.` |
| Plain-reference control | Current document task opens the same changed current document through its ordinary reference. |
| Restart | Normal quit returns exit 0. Relaunching the same profile preserves the paused queue, selected task's queued state and missing task's todo state. Reopening the queued citation still shows the original body. |
| Withdrawal | In a further launch, Withdraw returns the selected task to todo. Its citation still opens the original grant body without task execution authorization. |
| Cleanup | All three launches quit through the native app menu and return exit 0. Final app inventory reports Nooki stopped. |

[Retained synthetic state](C03b2-native-state.json) records the final board, original captured source,
changed current body and content hashes. Assertions checked snapshot/grant equality, inequality with
current content, the existing revocation marker, preserved committed/pending receipts and a final
paused board of three todos with no authorization, run ID or conversation thread. The retained
snapshot is `716491f5-b70b-4d9d-8cea-0bdb20127efc`; withdrawal leaves its history intact.

These are actual installed-app UI actions and native persistence reads. They do not prove a live
agent run or a public ZIP selecting and creating a sourced task; the latter remains C03c. The earlier
[C03b1](C03b1.md) tests cover additional delete/uninstall and restore cases. Native access-manager
layout/picker acceptance under C02b remains separate, as do production runtime R02/R03/K4.

## Delivery checks

- Current-source desktop build passed: 34.82-second native release build, 24.57 MiB app bundle.
  Local install and `codesign --verify --deep --strict /Applications/Nooki.app` passed.
- Application TypeScript/build ran as part of desktop build. The existing large-chunk advisory remains.
- No implementation or dependency changes followed the [C03b2](C03b2.md) full regression
  (200 top-level native tests plus one nested child; 172 platform + 5 capability tests). Those
  unchanged results were reused; this evidence-only increment did not rerun the entire suite.
- Logs: `/tmp/nooki-c03b2-resume-build.log`, `/tmp/nooki-c03b2-resume-install.log`,
  `/tmp/nooki-c03b2-resume-native.log`, `/tmp/nooki-c03b2-resume-restart.log`,
  `/tmp/nooki-c03b2-resume-withdraw.log`.

C03b2/C03b are complete at the documented trusted-user integration boundary. C03c, parent C03,
C02b/parent C02 and K1 remain open. No later phase or production isolation gate is advanced.
