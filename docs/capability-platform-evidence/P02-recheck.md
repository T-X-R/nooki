# P02: Same-window desktop recheck

- Date: 2026-11-20; continued after the user reported the Mac unlocked.
- Outcome: the scoped same-window cases below pass; P02/K0 retain their feasibility status.
- Branch: `codex/capability-platform-design`; [PR #38](https://github.com/T-X-R/nooki/pull/38) remains open for human review.
- Environment: macOS 15.6.1 (24G90), arm64, WebKit 20621.3.11.11.3.
- Executable: the retained receive-mode probe from [the earlier unlocked run](P02-unlocked.md),
  SHA-256 `37862c0502cd57d0b9f5e39f33992f8bd7fb81a5e8e6818e8b7f417b5a3a6e7c`.
  Its build source is `5308f2b6de13174e4cb28421ee0a64286180176b`; probe sources are unchanged
  through `16f0a378bba2ecaf3efa5b4de7b21e2c85b174b8`. This run reuses that binary, not a newly
  built production isolation runtime.

## Native runs

The existing isolated-profile launcher and native desktop controls were used throughout. No
ordinary profile, credentials, real documents or agent were used. Both processes exited normally
with code 0. Reproduction follows [the embedded probe procedure](P02b2b2a.md), using
`runtime-probe-receive` mode and fresh profiles.

1. `/private/tmp/nooki-profile-gxoeAv`: channel ownership, receive checks for both packages, finite
   pressure in A, status during pressure, destroy A before its deadline, show B and inspect status.
   [Retained receive/pressure events](P02-recheck-receive-native.json): 256 events.
2. `/private/tmp/nooki-profile-Np0jOG`: play A, hide A/show B, inspect playback, return to A and
   release; start A's infinite loop, inspect status, destroy A, show B, play/release B and quit.
   [Retained media/loop events](P02-recheck-media-native.json): 45 events.

| Case | Observation |
| --- | --- |
| Pending channel ownership | A/B/control foreign reads fail at 26,542–26,543 ms; shell subsequently receives its exact 9,027-byte message at 29,052 ms. |
| Native identity and authorization | Both receive reports identify distinct `probe-a` / `probe-b` callers inside `probe-workspace`. Shell spoofing, host-secret access and host-window mutation fail; native script-message fallback is absent. |
| Receive limits and recovery | Both return the exact 32 KiB echo, refuse 1 MiB IPC/resource POST, oversized metadata and malformed JSON; abandoned callbacks return 400, local SVG returns 200, cancellation reports AbortError and later calls return `recovered`. |
| Other protocol | A's CSP rejects the `tauri` POST; B, without that CSP, receives native status 413. |
| Bounded concurrency | A accepts 23/32 resource requests and B 24/32; other responses are 413. Both accept four of six delayed calls. Peak receive reservations are four requests / 262,144 bytes. |
| Removal under pressure | A starts at 78,134 ms and is removed at 91,005 ms, 12,871 ms into the 60-second bounded workload. No sender-completed event precedes removal. |
| Refusal count and release | Total refusals are 40 before pressure, 326 during pressure and 510 at removal; they remain 510 at 108,595 ms. The pressure interval therefore adds 470 refusals. That post-removal sample has zero receive/admission bytes and in-flight operations; A is absent. |
| Peer under pressure | B succeeds before and after removal; the last retained sample records 124/124 successful calls at 114,452 ms. |
| Hidden playback | In run 2, A starts at 25,606 ms. After switching to B, A's playback advances from 0.176 to 11.800 seconds at 37,340 ms, unfocused and not paused. |
| A release | At 44,596 ms A reports stopped advancement, paused true, ready/network states 0 and no source attribute. The historical `currentSrc` value is retained and is not a live-resource claim. |
| Infinite-loop containment | A starts looping at 48,038 ms. Host status responds at 83,515 ms; native removal at 96,307 ms removes only A. From loop start to the final 118,003 ms status, A's heartbeat stays 37 while B advances 36→105 and shell 39→108. |
| Peer interaction after loop removal | B starts audio at 112,303 ms, advances to 5.759 seconds, then successfully releases it at 123,242 ms. |

Run 1 reaches the existing 256-event collector cap at 114,452 ms. Its complete receive reports,
removal, post-removal resource sample and 124 successful peer calls are retained **before** that cap.
It cannot establish later events or audio release. Run 2 supplies separate uncapped playback,
release and infinite-loop evidence. No absence of events after saturation is used as proof of
termination. Normal process exit is established by the launcher, independently of the event log.
The observed counts and timing are finite measurements, not fairness or throughput guarantees.

## Verification and delivery

- Assertions over both retained JSON traces pass: exact caller/window binding, channel ordering,
  refusal/recovery, removal before the pressure deadline, stable post-removal refusal counts,
  released reservations, peer progress, hidden playback and both audio releases.
- Receive-mode native tests on committed source `16f0a37`: **11 passed, zero failed**;
  `/tmp/nooki-same-window-recheck-tests.log`.
- Default desktop build on that committed source passes: 33.62-second native release build,
  24.41 MiB app bundle; the existing large-chunk advisory remains.
  `/tmp/nooki-same-window-recheck-app-build.log`.
- Local reinstall and `codesign --verify --deep --strict /Applications/Nooki.app` pass;
  `/tmp/nooki-same-window-recheck-app-install.log`. Both test runs and the ordinary app were stopped.
- A temporary source export was used for build/tests/install so existing uncommitted C02 document
  authorization work remained untouched and was not installed or certified by this verification.
- Run logs: `/tmp/nooki-same-window-recheck-run.log` and
  `/tmp/nooki-same-window-recheck-media.log`. This increment changes evidence/checklist documents
  only; full application regression results remain in [C01c2](C01c2.md) and were not rerun here.

## Acceptance boundary

This verifies the disposable same-window prototype on the measured engine. It does not complete
production isolation, universal CPU/memory containment, a new network/storage audit, a new
WebContent-process exit measurement, or production Host-service integration. Earlier positive
permission controls and process-exit observations remain in [P02b2b2a](P02b2b2a.md).

P02/K0 remain complete at feasibility/preparation scope. C01 remains complete at its documented
trusted-legacy boundary; C02/C03, K1 and production R02/R03/K4 remain pending. No implementation
task is promoted by this recheck.
