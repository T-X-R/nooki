# P02: Continued same-window native acceptance

- Date: 2026-11-20; continued after the user reported the Mac unlocked.
- Result: the scoped same-window channel, receive, pressure removal, media and loop removal checks pass.
- Branch: `codex/capability-platform-design`; [PR #38](https://github.com/T-X-R/nooki/pull/38) remains open for human review.
- Environment: macOS 15.6.1 (24G90), arm64; retained probe uses WebKit 20621.3.11.11.3.
- Executable: the receive-mode probe from [P02-unlocked](P02-unlocked.md), SHA-256
  `37862c0502cd57d0b9f5e39f33992f8bd7fb81a5e8e6818e8b7f417b5a3a6e7c`.
  Its build source is `5308f2b6de13174e4cb28421ee0a64286180176b`; the probe source has no diff
  between that commit and `ca1a57e`. This session reused the verified binary.

## Native runs

Reproduce using the isolated launcher and embedded workspace controls described in
[P02b2b2a](P02b2b2a.md), with `runtime-probe-receive` enabled. All controls were operated through
the native desktop UI. Fresh synthetic profiles were used; no ordinary documents, credentials or
agents participated. Both processes exited normally with code 0.

1. `/private/tmp/nooki-profile-ggmaRH`: channel ownership, both receive reports, finite pressure
   in A, status, destroy A before the pressure deadline, show B, status, normal quit.
   [Retained receive events](P02-continued-receive-native.json): 256 entries.
2. `/private/tmp/nooki-profile-NujdXG`: play A, show B, status, return to A and release; show B,
   start A's infinite loop, status, destroy A, play B, status, release B and quit.
   [Retained media events](P02-continued-media-native.json): 45 entries.

| Case | Retained observation |
| --- | --- |
| Pending channel ownership | A/B/control foreign reads fail at 25,015–25,016 ms; the shell receives its exact 9,027-byte message at 27,513 ms. |
| Native identity and authority | Both complete reports identify distinct `probe-a` / `probe-b` views within `probe-workspace`. Shell spoofing, protected host commands and host-window mutation are refused; native script-message fallback is absent. |
| Receive limits and recovery | Both return the exact 32 KiB echo; refuse 1 MiB IPC/resource POST, oversized metadata and malformed JSON; abandoned requests return 400, valid SVG returns 200, cancellation returns AbortError and subsequent calls return `recovered`. |
| Other protocol | A's CSP rejects the `tauri` POST; B's native handler returns 413 without that CSP. |
| Finite concurrency | A accepts 20/32 resource requests and B 23/32; the remainder return 413. A accepts four of six delayed calls; B's six overlapping calls are refused by the byte budget. Peak receive reservations are four requests / 262,144 bytes. Both callers recover afterward. |
| Pressure removal | A starts at 63,828 ms and is removed at 72,968 ms: 9,140 ms into its 60-second workload, before any sender-completed event. |
| Resource release | Refusals rise from 49 before pressure to 407 at removal, adding 358 during pressure. At 79,378 ms they remain 407; both receive/admission bytes and in-flight operations are zero, and A is absent. |
| Peer progress | B succeeds before and after removal; the final retained sample records 132/132 successful calls at 104,916 ms. |
| Hidden playback | A starts at 15,648 ms. After switching to B at 27,510 ms, A's clock advances from 0.176 to 21.297 seconds by 36,882 ms, unfocused and not paused. |
| A media release | At 43,789 ms A reports stopped advancement, paused true, ready/network states 0 and no source attribute. Historical `currentSrc` does not establish a live resource. |
| Infinite-loop removal | A starts looping at 54,010 ms. Host status responds at 60,027 ms; removal at 64,056 ms removes only A. At 77,900 ms A's heartbeat remains 59 while B advances 44→68 and shell 58→82. |
| Peer after removal | B starts audio at 69,146 ms, advances to 8.810 seconds, and releases it at 82,064 ms. The shell and B remain usable in the same window. |

The receive collector reaches its existing 256-event cap at 104,916 ms. Both complete receive
reports, removal, the post-removal resource sample and peer progress are retained before that cap.
No absence of later events proves termination. The media run remains below the cap. Normal process
exit is independently established by the launchers. Concurrency counts reflect scheduling in this
finite run, not a fairness or throughput guarantee; B's temporary byte-budget refusals are retained.

## Verification and delivery

- Independent assertions over both JSON traces pass: caller/window binding, channel ordering,
  refusal/recovery, bounded pressure removal, stable counters, released reservations, peer progress,
  hidden playback, both media releases and infinite-loop removal.
  Log: `/tmp/nooki-native-continued-assert.log`.
- Receive-mode native tests on committed source `ca1a57e`: **11 passed, zero failed**.
  Log: `/tmp/nooki-native-continued-tests.log`.
- Default desktop build passes: 38.83-second native release build, 24.54 MiB bundle.
  The existing large-chunk advisory remains. Log: `/tmp/nooki-native-continued-build.log`.
- Nooki 0.5.0 reinstall and `codesign --verify --deep --strict /Applications/Nooki.app` pass.
  Both probes and the ordinary app UI were stopped before installation; existing background task
  workers were not used for this acceptance. Log: `/tmp/nooki-native-continued-install.log`.
- A temporary committed-source export excluded unfinished C03a changes from tests/build/install.
  Those working-tree changes were preserved and are not certified by this receipt.
- Launcher logs: `/tmp/nooki-native-continued-receive.log` and
  `/tmp/nooki-native-continued-media.log`. Both returned exit 0. A desktop-tool state-change notice
  interrupted the first quit attempt; refreshed menu state and a second quit completed normally.
- This increment changes evidence/checklist documentation only. It does not rerun the full
  application regression suite; prior results remain in [C02b](C02b.md) and [C02b-ui](C02b-ui.md).

## Acceptance boundary

P02 and K0 remain complete at prototype feasibility/preparation scope. This recheck does not
complete production isolation, universal CPU/memory containment, a new network/storage audit,
a new WebContent-process exit measurement or production Host integration. Historical positive
permission controls and process-exit observations remain in [P02b2b2a](P02b2b2a.md).

C01 and C02a retain their documented completed scope. C02b/parent C02, C03, K1 and production
R02/R03/K4 remain pending; no later task or gate is promoted by this verification.
