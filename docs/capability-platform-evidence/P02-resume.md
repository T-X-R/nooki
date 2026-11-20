# P02: Resumed same-window native verification

- Date: 2026-11-20; continued after the user reported the Mac unlocked.
- Result: the scoped channel, receive, pressure-removal, media and loop-removal cases pass.
- Branch: `codex/capability-platform-design`; [PR #38](https://github.com/T-X-R/nooki/pull/38) remains open for human review.
- Environment: macOS 15.6.1 (24G90), arm64; retained probe uses WebKit 20621.3.11.11.3.
- Probe: the receive-mode binary from [P02-unlocked](P02-unlocked.md), SHA-256
  `37862c0502cd57d0b9f5e39f33992f8bd7fb81a5e8e6818e8b7f417b5a3a6e7c`.
  Its build source is `5308f2b6de13174e4cb28421ee0a64286180176b`; probe sources remain unchanged
  through `07d0704242f1fed6d5fbe5c576e8143891b4b4ed`. This session reused that binary.

## Reproduction and observations

Use the isolated launcher and native controls described in [P02b2b2a](P02b2b2a.md), with
`runtime-probe-receive` enabled. Both sessions used fresh synthetic profiles, no ordinary user
documents or credentials, and exited normally with code 0. All interactions used the desktop UI.

1. `/private/tmp/nooki-profile-PU4mZ7`: channel scope; both receive reports; show A; finite pressure;
   native status; destroy A before its deadline; show B; status; normal quit.
   [Receive events](P02-resume-receive-native.json): 256 entries.
2. `/private/tmp/nooki-profile-da0EJw`: play A; show B; status; return to A and release; show B;
   start A's loop; status; destroy A; play B; status; release B; normal quit.
   [Media/loop events](P02-resume-media-native.json): 45 entries.

| Case | Retained observation |
| --- | --- |
| Channel ownership | A/B/control foreign reads fail at 16,866–16,900 ms; shell subsequently receives its exact 9,027-byte message at 19,363 ms. |
| Caller and permission boundary | Both reports identify distinct native `probe-a` / `probe-b` callers inside `probe-workspace`. Spoofed shell calls, protected host commands and host-window mutation fail; native script-message fallback is absent. |
| Receive and recovery | Both return the exact 32 KiB echo; refuse 1 MiB IPC/resource POST, oversized metadata and malformed JSON; abandoned requests return 400, valid SVG returns 200, cancellation returns AbortError and later calls return `recovered`. A's CSP refuses the other-protocol POST; B's native handler returns 413. |
| Finite concurrency | A accepts 20/32 resource requests and B 23/32; others return 413. Each accepts four of six delayed calls. Peak receive reservations are four requests / 262,144 bytes. |
| Pressure removal | A starts at 69,591 ms and is removed at 90,823 ms: 21,232 ms into its 60-second bounded workload. |
| Resource release | Refusals rise from 56 before pressure to 1,007 during pressure and 1,475 at removal: 1,419 additional refusals. At 95,616 ms they remain 1,475; A is absent and both receive/admission bytes and in-flight operations are zero. |
| Peer progress | Retained B samples succeed before and after removal, ending at 112/112 successful calls at 102,475 ms. |
| Hidden playback | A starts at 20,136 ms, is hidden at 23,087 ms, and advances from 0.170 to 16.110 seconds by 36,189 ms while unfocused and not paused. |
| A media release | At 47,195 ms A reports stopped advancement, paused true, ready/network states 0 and no source attribute. Historical `currentSrc` is not evidence of a live resource. |
| Infinite-loop removal | A starts looping at 56,929 ms; host status responds at 67,160 ms and native removal occurs at 70,558 ms. Through the final 87,846 ms status, A's heartbeat stays 130 while B advances 124→247 and shell 199→322. Only A is absent from the view inventory. |
| B after removal | B starts audio at 75,864 ms, advances to 12.042 seconds, and releases it successfully at 91,900 ms. The same-window shell and B remain visibly usable. |

The receive collector reaches its existing 256-event limit at 103,513 ms. The UI subsequently
shows 120/120 peer successes and a stable status, but those later observations are **not** in the
retained JSON and are not used for its assertions. Both receive reports, removal, the 95,616 ms
post-removal resource sample and 112/112 peer successes are retained before saturation. No absence
of events after saturation proves termination. The separate media run remains below the cap.
Counts and timings describe these finite runs, not throughput, fairness or termination guarantees.

## Verification and delivery

- Trace assertions pass for caller/window binding, channel ordering, denial/recovery, bounded
  pressure removal, stable refusals, released reservations, peer progress, hidden playback and
  both media releases: `/tmp/nooki-same-window-resume-assert.log`.
- Receive-mode native tests on committed source `07d0704`: **11 passed, zero failed**;
  `/tmp/nooki-same-window-resume-tests.log`.
- Default desktop build on that source passes: 36.54-second native release build, 24.40 MiB bundle.
  The existing large-chunk advisory remains; `/tmp/nooki-same-window-resume-app-build.log`.
- Nooki 0.4.0 was reinstalled after both sessions and ordinary Nooki were stopped. Installation
  and `codesign --verify --deep --strict /Applications/Nooki.app` pass;
  `/tmp/nooki-same-window-resume-app-install.log`.
- A temporary committed-source export excluded the unfinished C02b picker changes from these
  tests, build and installation. Those working-tree changes were preserved, not certified.
- Launcher logs: `/tmp/nooki-same-window-resume-receive.log` and
  `/tmp/nooki-same-window-resume-media.log`. Both returned exit 0 with no watchdog event.
  The first post-quit UI snapshot timed out after the process had exited; app inventory and the
  launcher independently confirmed exit. It is not a failed test or a locked-screen diagnosis.
- This increment changes evidence/checklist documents only. The full application regression
  results remain in [C02a](C02a.md); this session did not rerun that full suite.

## Acceptance boundary

P02 and K0 remain complete at the documented prototype feasibility/preparation scope. This is not
production runtime acceptance, universal CPU/memory containment, a new network/storage audit,
a new WebContent-process exit measurement or production Host integration. Historical positive
permission controls and process-exit observations remain in [P02b2b2a](P02b2b2a.md).

C01 and C02a retain their documented completed scope; C02b, parent C02, C03, K1 and production
R02/R03/K4 remain pending. No later task or gate is promoted by this recheck.
