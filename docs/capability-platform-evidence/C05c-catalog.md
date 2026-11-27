# C05c: Installed catalog, loading and permission-refusal follow-up

Date: 2026-11-27. Continuation of the [approved archive acceptance](C05c.md), on the same feature
branch/PR #38 and isolated profile `/private/tmp/nooki-profile-M5Hz3N`. The original Reader/Peer
archives and permissions are unchanged; Reader remains removed and Peer remains installed.

## Existing targets through the installed Host

Nooki 0.12.0 (executable SHA-256 recorded in the preceding evidence) read three synthetic, unstarted
local conversations seeded while the app was stopped. The [fixture](../../tests/fixtures/capability-conversation-handoff/README.md)
uses the existing local-catalog format, with zero turns, `nativeStarted: false` and a paused task
board. It does not run Pi, alter Codex priority or bypass the isolated profile's Agent denial.
The real Host falls back to this catalog when Codex discovery is unavailable and explicitly reports
partial results in the picker.

| Installed case | Observed result |
| --- | --- |
| Existing ordinary destination | `Handoff ordinary synthetic chat` and the disappearing fixture were offered; the task-owned record was excluded |
| Preserved composer | Opening the ordinary chat's offer preserved `EXISTING UNSENT SYNTHETIC TEXT`; explicit adoption appended the Peer text and disabled the adoption button |
| Exact replay | Intent `13b21f41-36ad-4a8c-8ffb-a534449e72af` replayed draft `bc4a289b5aa295c90568ead4beda2d412e4e40b64a2ced05da5cb932374dbabb`, targeting `pi-handoff-fixture-ordinary`, without navigation or duplication |
| Destination changed after selection | Only the disappearing synthetic record was archived after selection. Confirming intent `e8324194-22e3-44c1-94d8-83300a72dc69` reported `The approved handoff or conversation changed`; retry did not create a draft or silently select a new chat |
| Refresh after cancellation | A fresh review offered only the ordinary record; the archived and task-owned records were absent |
| Real native loading | With the synthetic catalog read delayed using the FIFO fixture, the installed Chinese UI showed `正在读取聊天…` and disabled refresh/save. Releasing the read restored the ordinary record and explicit partial-catalog warning |

The controlled loading run restored the byte-identical catalog, SHA-256
`b32f18a1d22e38b7d6ef8b371aae91acbe138242d870eaa870fff0b27d8c8a2e`.
Installed observations now include Chinese/dark selection/loading and English/light existing-target
review, alongside the earlier Chinese/light and English/dark narrow/wide observations. Screenshot
pixels are not CSS viewport measurements; the full 320/768/1240 CSS-width cross-product is covered
separately by real-component browser checks. No model call or Send action was used.

## Permission refusal correction

The installed native refusal was correct but its UI suggested an unchanged retry even when source
access had been revoked or belonged to another package. Patch 0.12.1 recognizes `PERMISSION_DENIED`,
explains that access must be checked before a fresh review, removes the retry action and focuses
Cancel. Uncertain-result retries keep their existing immutable key/content/destination behavior.
The exported contract remains 0.12.0 and kit 0.11.0; only its platform compatibility metadata moves
to 0.12.1.

A regression test first failed against the original UI, then passed for Chinese and English with
no extra draft, no retry action and Cancel focused. The complete real-component handoff suite also
passed its existing replay, immutable retry, no-auto-send, adoption, missing-target, lifecycle,
loading and theme/layout checks. Logs: `/tmp/nooki-c05c-refusal-{red,green}.log`.
The first full JavaScript run exposed stale kit platform metadata; after synchronizing it, all
203 platform and 5 capability tests passed (`/tmp/nooki-c05c-catalog-js-green.log`).

## Installed patch and final state

The rebuilt/reinstalled Nooki 0.12.1 executable SHA-256 is
`4e069cc4c517ffbaf22c22619576c4b2da0598503d82b8176cd6498c09fb40ad`.
Desktop build (39.90s native release), install and strict deep signature verification passed.
Logs: `/tmp/nooki-c05c-patch-{build,install,native}.log`.

In the actual installed Chinese/dark Host, Peer attempted the same synthetic Reader source grant.
Confirmation displayed the new localized permission message, disabled destination controls and
removed Save/Retry. Pressing Return activated Cancel and the package received `status: dismissed`.
This verifies the keyboard cancellation path in WKWebView; both localized strings and explicit DOM
focus are additionally asserted by the component suite. No new source access was granted.

Read-only assertions after this refusal verified exactly five drafts/five receipts: the preceding
four New-chat offers plus one ordinary-chat offer. All preceding drafts remain byte-for-byte equal
as parsed values, including the retained original source. The archived target has no receipt.
The three catalog records still have zero turns and `nativeStarted: false`; the invocation map is
empty, the board remains paused, and the isolated home remains empty. The synthetic task record
also contains a metadata-reconciliation error because its `pi-…` ID is not a Codex Goal UUID; this
fixture limitation does not claim a working Goal task or Agent dispatch. Task ownership filtering
was observed independently in the real Host selector.

Final snapshot: `/tmp/nooki-c05c-catalog-final-state-20261127.json`, SHA-256
`20585217bf9994a9eefba465286677d06e75c74fff117a805b90e5ff0ce3683e`.
The computer-control adapter lost its window after the required refusal/cancellation check; the
isolated launcher child was identified by parent PID and stopped. Other application/worker
processes were left alone. The component-test Vite server was stopped.

C05c and C05 are complete for the documented contract and synthetic installed acceptance. This
closes chat-draft handoff, not real Agent execution, source-history deletion or hostile-package
containment. C06 and downstream gates remain open.
