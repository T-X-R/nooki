# C02b follow-up: independent access and component UI verification

- Date: 2026-11-20; source is this receipt's commit, based on `7a10681`.
- Same branch and [PR #38](https://github.com/T-X-R/nooki/pull/38); human merge pending.
- Scope: close the remaining peer read, verify component UI behavior separately from native input,
  correct one misleading error message, and strengthen pending-selection lifecycle coverage.

## Installed-app result

The existing `/private/tmp/nooki-profile-tu8kzH` profile was launched with installed 0.5.0 after the
previous verified rebuild. Peer opened through the normal sidebar and read its saved Beta snapshot:
`c48ad8bdfa81ee477f69eacf404546eccf46a5adfd441000c07bfa5fe8166a7d`. Reader Beta's revocation marker
was already present. The successful public read returned `# beta\nSynthetic beta source only.`
Thus revoking reader's grant did not revoke peer's separate grant for the same source, including
across another app restart. A subsequent peer picker was explicitly dismissed without approval.

Native keyboard checks again produced no observable Tab transition; coordinate input returned
`noWindowsAvailable`. Later Library navigation again did not finish visibly. The app was quit
normally, and its launcher returned exit 0. Log: `/tmp/nooki-c02b-acceptance-resume.log`.
No native keyboard or narrower native access-manager acceptance is claimed by this run.

## Real components with simulated native services

Fixture: [`tests/ui/fixtures/library-host`](../../tests/ui/fixtures/library-host/README.md).
The test entry imports the production React components, native HTML dialog, picker state and CSS.
Only IPC/data are simulated; the page visibly identifies that fact. It is outside the application's
entry graph and is not exported to capability developers. An isolated in-app browser opened the
known localhost fixture; no personal browser session or Library data was used.

Observed through browser interaction and read-only DOM inspection:

| Case | Result |
| --- | --- |
| Initial focus | Picker focuses its search input; manager focuses Close |
| Keyboard | Tab from picker search reaches Alpha; Escape dismisses both dialogs and restores their respective opener |
| List error | Failure and Reload shown, approval disabled; Reload restores documents; manager has equivalent recovery |
| Loading | Picker shows Loading documents and disabled approval; Cancel remains available |
| Unknown commit outcome | Approved Alpha stays checked, both checkboxes lock, retry explanation appears; retry audit records the same Alpha twice and returns metadata only |
| Revoke failure | Unconfirmed-outcome message, Active record and retry remain; retry changes it to Revoked and removes its revoke button |
| Empty manager | Explicit no-access message |
| Pending cancellation | Abort closes the picker after 2.5 seconds; result is cancellation and audit contains no commit |
| Console | No captured application warnings or errors |

A list-load failure originally displayed both an error and “No documents in the Library yet”.
This falsely implied that a failed read had established an empty Library. The one-line fix suppresses
the empty-state message while an error is present. The failure was observed before editing, then
reproduced with a fresh fixture request after editing: error/Reload remained, the false empty claim
was absent, and reload succeeded. A hot reload had rerun the effect and consumed the one-shot fault;
that intermediate state was not treated as the fresh-request verification.

Layout matrix, both dialogs at each row, height 800 CSS pixels:

| Width | Language/theme | Dialog horizontal bounds | Horizontal overflow |
| --- | --- | --- | --- |
| 320 | Chinese/light | 16–304 | None |
| 400 | English/dark | 16–384 | None |
| 800 | Chinese/dark | 96–704 | None |
| 1240 | English/light | 316–924 | None |

All measured dialog bounds also fit vertically. Screenshots additionally inspected Chinese/light
at 320×700 and English/dark at 400×700; text wraps, controls and footer remain legible and reachable.
Viewport overrides were reset and the temporary tab closed. Tabbing past the final enabled control
reported the document body rather than a background control; focus cycling through browser chrome
was not asserted. These checks prove the tested browser behavior, **not** native WKWebView keyboard
behavior or native service authorization.

## Native lifecycle and verification

One added integration test independently covers a pending session across same-version registry
replacement, version update and uninstall/reinstall. Every old commit is denied before a grant file
exists; a fresh approval for the new installation succeeds. These use the native registry APIs,
not an installed-archive update UI. The initial test incorrectly attempted duplicate installation
and failed with “already installed”; correcting its setup to `update_capability` was a test repair,
not a product security fix. The earlier C02b receipt's broad replacement language should be read
with this explicit distinction: the original test covered disable/re-enable; this follow-up supplies
the three additional transitions.

- Six native selection integration tests pass: `/tmp/nooki-c02b-lifecycle-acceptance-final.log`.
- Eight Host lifecycle/selection tests pass: `/tmp/nooki-c02b-ui-host-tests.log`.
- Fixture and application TypeScript check pass: `npx tsc -p tests/ui/fixtures/library-host/tsconfig.json`;
  `/tmp/nooki-c02b-ui-fixture-check.log`. Its first attempt omitted an existing application global
  declaration; including the application sources fixes the test configuration.
- Final desktop release build passes in 35.20 seconds, app bundle 24.54 MiB; local reinstall and
  strict signature verification pass. Logs: `/tmp/nooki-c02b-ui-delivery-build.log` and
  `/tmp/nooki-c02b-ui-delivery-install.log`. The existing large-chunk advisory remains.

C02b/C02 remain open for the native input/layout observations already tracked, rather than relabeling
browser evidence as native acceptance. C03's board/source integration can proceed independently
from C01; K1 still requires both C02 and C03. Production runtime containment remains R02/R03/K4.
