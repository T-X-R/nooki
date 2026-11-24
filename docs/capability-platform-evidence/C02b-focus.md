# C02b follow-up: focus across asynchronous selection

- Date: 2026-11-24; source is this receipt's commit, based on `ef275aa`.
- Same branch and [PR #38](https://github.com/T-X-R/nooki/pull/38); human merge pending.
- Result: asynchronous keyboard focus regression reproduced and fixed in real components.
  Native keyboard restoration and narrower native access-manager layout remain pending.

## Reproduction and cause

The [C03c native run](C03c.md) reported page focus after closing both dialogs. That observation did
not distinguish a pointer-triggered button without prior keyboard focus from an asynchronous loss
of a genuinely focused trigger. It is not sufficient evidence that every close path is broken.

The existing [Library UI fixture](../../tests/ui/fixtures/library-host/README.md) now includes an
`async-disabled` case using the real public Host adapter, actual dialogs and synthetic native services.
Keyboard Enter opens the picker while React disables its trigger. Issuance and cleanup each wait
2.5 seconds; the fixture can continue processing the returned result before re-enabling the button.
Before the fix, Escape returns `dismissed` but leaves `document.activeElement` on BODY after the
button is enabled. The dialog captures focus only after asynchronous native issuance, by which time
the disabled button has lost it. The original synchronous browser fixture did not exercise this.

A first fix captured the trigger before issuance and restored it on the first animation frame after
cleanup. It passed immediate cleanup but failed with delayed cleanup. Temporary diagnostic output
confirmed `captured-focus:BUTTON:Open picker`, followed by `disabled=true`, `connected=true`, no
open dialog and BODY focus at that frame. React had not re-enabled the trigger yet. Those temporary
diagnostics were removed after establishing the cause; the failed intermediate implementation is
not claimed as verified.

## Final change and observed behavior

The private Host wiring captures focus before the first await. After cleanup, a small DOM helper
waits for the trigger's actual enabled state rather than a guessed timeout. Restoration stops if
the trigger is removed, another control/dialog has focus, or a new pointer/keyboard/focus interaction
supersedes the old request. The observer and input listeners are removed on completion/cancellation.
This adds no public option, package permission, native grant behavior or contract-version change.

Observed through the real components in an isolated browser:

| Case | Result |
| --- | --- |
| Keyboard dismissal | Search receives initial focus; Escape dismisses; Open picker receives focus when enabled. |
| Successful selection | Selecting Alpha and approving returns its synthetic grant; Open picker receives focus after delayed cleanup. |
| Caller continues processing | Keeping the trigger disabled another 2.5 seconds after the result still restores focus when it enables. |
| New dialog during cleanup | Opening the access manager while cleanup is pending keeps focus on its Close button after the old request finishes. |
| New dialog after result | Opening the manager after `dismissed` is visible but before the old trigger enables cancels the old restoration; Close retains focus after enabling. |
| Manager keyboard close | Escape from the keyboard-opened manager restores its own opener. |

The final fixture was reloaded to avoid development hot-reload/createRoot warnings contaminating
the timing observations. The temporary browser tab was closed. No native grant was created or
revoked by these simulated-service checks.

## Regression and desktop delivery

- New Host ordering test fails before the change, then all nine Host tests pass. It verifies capture
  before native issuance and restoration after native cleanup. Logs:
  `/tmp/nooki-c02b-focus-red.log` and `/tmp/nooki-c02b-focus-green.log`.
- Full final JavaScript regression: 175 platform + 5 capability tests pass:
  `/tmp/nooki-c02b-focus-js-final.log`. Fixture TypeScript and `git diff --check` pass.
- No native implementation changed; the C03c native regression remains the relevant baseline
  (200 top-level tests plus one nested child; two existing live-agent tests ignored).
- Final desktop build passes in 37.50 seconds, 24.58 MiB bundle; install and strict signature
  verification pass. Logs: `/tmp/nooki-c02b-focus-build-final.log` and
  `/tmp/nooki-c02b-focus-install.log`. The existing chunk-size advisory remains.

## Native work still required

The pre-fix test launch in `/private/tmp/nooki-profile-5dTf40` accepted accessibility inspection,
but keyboard input failed with a desktop capture/window error. It quit normally (launcher exit 0)
before installation. The final installed build was relaunched in that same already-approved,
credential-free synthetic profile; log `/tmp/nooki-c02b-focus-fixed-native.log`. It is left available
for the requested foreground handoff. No native focus or layout pass is claimed for this increment.

Next: use Tab/Enter to open both dialogs in the actual app, confirm Escape returns to their focused
triggers, then inspect the access manager at the supported narrower native window size. Pointer
opening without a focused trigger is a separate condition, not evidence of keyboard restoration.
C02b/C02/K1 stay unchecked until these observations pass. C03 remains complete; later platform
and production-isolation gates remain open.
