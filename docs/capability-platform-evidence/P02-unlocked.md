# P02: Unlocked-desktop revalidation

- Date: 2026-11-20; user requested continuation after unlocking the Mac
- Source: `5308f2b6de13174e4cb28421ee0a64286180176b`; probe rebuilt without source changes
- Review: existing `codex/capability-platform-design`, [PR #38](https://github.com/T-X-R/nooki/pull/38); human merge pending
- Environment: macOS 15.6.1 (24G90), arm64, WebKit 20621.3.11.11.3; Tauri 2.12.5 / Wry 0.57.1
- Probe executable SHA-256: `37862c0502cd57d0b9f5e39f33992f8bd7fb81a5e8e6818e8b7f417b5a3a6e7c`
- Outcome: scoped same-window checks pass; the [P02 decision](P02.md) and production gate states are unchanged

## Runs and reproduction

Build `cargo build --offline --example capability_runtime_probe --features runtime-probe-receive`
in `src-tauri`, copy the executable into the temporary probe bundle and sign it locally. Use the
isolated launcher from [P02b2b2a](P02b2b2a.md). This run used the existing temporary bundle at
`/tmp/nooki-p02b/Nooki Runtime Probe.app`; no ordinary Nooki profile or credentials were used.

1. Profile `/private/tmp/nooki-profile-78viPZ`: channel ownership, receive attempt, local playback,
   hidden-page status, release, infinite loop in A, native removal, B playback/release, normal quit.
   [Raw native events](P02-unlocked-media-native.json): 101 events, exit 0.
2. Profile `/private/tmp/nooki-profile-QxDbOa`: run receive-boundary checks without media interaction,
   wait for both package reports, show A, start finite receive pressure, inspect status, remove A
   before its deadline, show B, inspect status and quit normally.
   [Raw native events](P02-unlocked-receive-native.json): 239 events, exit 0.

All controls were operated through the native desktop UI. The first run's media interaction
overlapped the bounded receive workload: the early A audio attempt had no successful start receipt,
and A's complete receive report was absent. This run is **not** a complete receive pass. A later
explicit play succeeded, and the separate second run supplies both complete receive reports.
The traces establish overlap and missing evidence, not a confirmed root cause for the missing
report. No fixture or production code was changed to obtain the second result.

## Observed results

| Case | Evidence and result |
|---|---|
| Pending channel ownership | A/B/control foreign reads refused at 21,771–21,772 ms; shell receives its exact 9,027-byte message at 24,268 ms in run 1 |
| Hidden playback | A starts at 51,744 ms; its clock advances from 0.166 to 25.224 seconds at 76,914 ms while unfocused and after the shell selected B; paused/ended both false |
| Release | At 80,196 ms A reports stopped advancement, paused true, ready/network states 0 and no source attribute; historical `currentSrc` is not treated as a live resource |
| Infinite-loop removal | A starts looping at 85,082 ms. Host status responds at 90,844 ms. Native close removes A at 96,313 ms. A ticks stay at 176 while B advances 124→167 and shell 234→276 between the two status samples |
| Peer after removal | B starts audio at 96,840 ms, advances to 4.851 seconds, then releases it at 105,224 ms |
| Native identity | Run 2 reports distinct `probe-a` / `probe-b` callers, both in `probe-workspace`; native script-message fallback is `undefined` for both |
| Valid and forbidden calls | Both return the 32 KiB echo exactly; both refuse shell spoofing, host-secret access and host-window title mutation |
| Receive refusal | Both reject 1 MiB IPC, resource POST, oversized metadata and malformed JSON; abandoned callbacks return 400 rather than hanging; valid local SVG returns 200 |
| Other protocol | A's CSP blocks the `tauri` POST; B's native handler returns 413 without CSP |
| Cancellation and recovery | Both report AbortError for the delayed resource and later return `recovered`; complete reports arrive at 33,116 / 50,079 ms |
| Finite burst | A has 20 accepted / 12 refused resource requests; B has 23 / 9. Each accepts four of six delayed operations. Peak receive reservations are four / 262,144 bytes |
| Pressure removal | Pressure starts at 66,534 ms; removal at 81,107 ms occurs after 14,573 ms, before the 60-second deadline, with no sender-completed event |
| Refusal stops | Total refusals rise from the pre-pressure 55 to 1,055 at removal, then remain 1,055 at 92,789 ms; 1,000 additional refusals belong to this pressure interval |
| Peer remains usable | B records 48/48 successful calls before removal and 108/108 before normal quit; final status has zero receive bytes/in-flight requests and A absent |

The second run's delayed operations did not overlap between owners as in every historical run;
both owners accepted four. Scheduling and hidden-page throttling affect the exact counts and
timings. These are observed finite cases, not a throughput/fairness promise. The rejection counter
includes the earlier receive checks, so 1,055 is not reported as a pressure-only count.

## Verification and remaining work

- Independent trace assertions check both complete receive results, exact caller/window binding,
  denial/recovery outcomes, channel ordering, playback/release, loop removal, peer progress,
  removal before the pressure deadline, stable refusal count and final zero reservations.
- Receive-mode native tests: **11 passed**, zero failed; `/tmp/nooki-unlocked-probe-tests.log`.
- Probe build passes; `/tmp/nooki-unlocked-probe-build.log`. Run logs:
  `/tmp/nooki-unlocked-probe-run.log`, `/tmp/nooki-unlocked-receive-run.log`.
- Default desktop build passes: 38.85-second native release build, 24.18 MiB bundle. The existing
  large-chunk advisory remains; `/tmp/nooki-unlocked-app-build.log`.
- Local reinstall and `codesign --verify --deep --strict /Applications/Nooki.app` pass;
  `/tmp/nooki-unlocked-app-install.log`. Nooki and the probe were stopped before installation.
- This increment changes evidence/checklist documentation only. The full JavaScript/native
  regression results for this source remain in [C01a](C01a.md); they were not rerun here.

This is a disposable same-window prototype verification on the measured engine. It does not
complete production isolation, universal CPU/memory containment, a new network/storage audit,
or a production Host-service workflow. Historical permission positive controls and observed
WebContent process exit remain in P02b2b2a; this rerun checks native view removal and peer liveness,
not a new process-exit measurement. P02/K0 remain complete at feasibility/preparation scope;
C01b/C01c and production R02/R03/K4 remain unfinished. Earlier failed runs remain retained.
