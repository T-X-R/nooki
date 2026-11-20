# P02: Native continuation attempt with unavailable desktop control

- Date: 2026-11-20; requested after the user reported unlocking the Mac.
- Result: **no new interactive acceptance**. Previous passing prototype evidence remains valid
  at its documented scope; this attempt does not supersede it or advance production gates.
- Existing branch and [PR #38](https://github.com/T-X-R/nooki/pull/38), pending human merge.

The retained receive-mode probe was launched with fresh synthetic profile
`/private/tmp/nooki-profile-xZFP1v`. Its SHA-256 remains
`37862c0502cd57d0b9f5e39f33992f8bd7fb81a5e8e6818e8b7f417b5a3a6e7c`, matching
[the earlier unlocked build](P02-unlocked.md). No ordinary data or credentials were used.

Three native app-selection attempts returned the desktop controller's message that the Mac was
being locked after a previous Computer Use session. This establishes an unavailable control
interface, not the user's physical lock-screen state. No channel, pressure, media or removal
control was reached. The browser component fixture remained usable through its separate interface.

The probe reached its existing five-minute watchdog at 300,655 ms and the launcher returned exit 1.
[The retained 29-event startup/watchdog trace](P02-attempt-native.json) is not a passing isolation
trace. A subsequent process-specific cleanup attempt found the process already gone; it did not
terminate an ordinary application. Launcher log: `/tmp/nooki-same-window-final-receive.log`.

Next native action is to reconnect the desktop controller, create a fresh profile and repeat the
[receive/media procedure](P02-continued.md). Do not infer interactive success from startup events,
the prior passing runs, or browser component checks. P02/K0 retain their prior feasibility status;
production R02/R03/K4 and the pending C02b/C03b2 native acceptance remain open.
