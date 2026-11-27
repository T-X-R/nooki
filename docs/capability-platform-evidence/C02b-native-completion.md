# C02b completion: native keyboard and minimum-window acceptance

- Date: 2026-11-24; installed source `517a32b655c5e4436823831cca80484b50995d2c`.
- Same branch and [PR #38](https://github.com/T-X-R/nooki/pull/38), pending human merge.
- Result: the remaining C02b native checks pass; C02b and parent C02 are complete.
- Platform/contract 0.6.0, development kit 0.5.0; no implementation changes in this receipt.

## Native keyboard verification

The existing `/private/tmp/nooki-profile-5dTf40` launcher remained alive. On resumption, keyboard
input worked, so the same process continued without another launch or package installation.
Unlike the previous pointer-opened observations, the following checks establish keyboard focus on
the trigger before opening the dialog:

| Flow | Actual installed-app observation |
| --- | --- |
| Access manager opener | Focus Library search, Shift+Tab through global Search to Document access; AX identifies Document access as focused. |
| Access manager open/close | Return opens the dialog with Close focused; Escape closes it and AX identifies the original Document access button as focused. |
| Package picker opener | In reader, focus its reference textarea and Shift+Tab to Select and save intent; AX identifies that button as focused. |
| Package picker open | Return invokes the actual asynchronous public Host. The package disables its action buttons while awaiting selection; picker Search receives focus. |
| Picker traversal/close | Tab reaches the synthetic document checkbox. Escape returns `dismissed`; AX identifies Select and save intent as focused again. |

This verifies the [focus fix](C02b-focus.md) in installed WKWebView with the independently packaged
reader. Pointer opening with no prior keyboard focus remains a different condition; a page-focused
result there is not relabeled as failure to restore a keyboard trigger.

## Native minimum-window layout

The shipped window configuration has minimum logical dimensions 980 by 680. Dragging the test
window's corner down to that limit produced 1960 by 1360 screenshots on the measured 2x display.
Both picker and access manager were inspected at that actual native size in Chinese/light and
English/dark. Recipient, purpose, status/document text, Search/selection controls where applicable,
and all dialog actions fit inside the visible window without clipping or horizontal overflow.
The access manager displays the existing revoked reader grant; this run does not create another
grant just to repeat the previously verified revocation action. Prior smaller browser viewport
checks remain browser evidence, not a claim that the native window supports widths below 980.

One additional Escape attempt during the narrow-window checks produced no visible transition;
Cancel then dismissed that picker. This intermittent native-control observation is retained. It
does not replace the separately observed successful keyboard-open/Tab/Escape/focus-restoration
sequence above. No universal background-input guarantee is claimed.

All layout selections were dismissed. The window was enlarged again, then the application quit
normally; the existing launcher returned exit 0. Log: `/tmp/nooki-c02b-focus-fixed-native.log`.
[Retained comparison results](C02b-native-completion-state.json) assert the board, receipt ledger,
grant, revocation marker and current document are unchanged from the C03c retained state: one todo,
one create receipt, one revoked grant and no native execution tasks. No personal profile or
credentials were used.

## Reconciled acceptance

| Requirement | Evidence |
| --- | --- |
| Recipient/purpose, dismissal, search/limit, chosen-only reads, job selection | [C02b installed archives](C02b.md) |
| Missing permission, forged recipient, foreign grant, separate peer grant, disposed Host | [C02b installed archives](C02b.md) |
| Durable grants, lifecycle/restore fencing and revocation | [C02a](C02a.md), [C02b lifecycle tests](C02b-ui.md) |
| Restart, revoked reader denied, retained user citation, independently authorized peer still reads | [C02b](C02b.md), [follow-up](C02b-ui.md), [current sourced archive](C03c.md) |
| Component loading/error/retry and narrow browser layouts | [C02b UI](C02b-ui.md) |
| Real asynchronous keyboard-trigger restoration | [red/green component reproduction](C02b-focus.md) and this native run |
| Actual native narrow access-manager and picker layout | This run, Chinese/light and English/dark at the supported minimum |

Native integration tests cover installation replacement/update/reinstall while selection is pending;
this is not claimed as an installed-archive update UI exercise. Production malicious-code containment
remains R02/R03/K4. With those boundaries unchanged, C02a and C02b satisfy C02.
