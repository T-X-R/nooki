# Library Host UI verification

Serve the repository with `npm run dev -- --host 127.0.0.1 --port 5193 --strictPort`, then open
`http://127.0.0.1:5193/tests/ui/fixtures/library-host/` in an isolated browser. Type-check the fixture
with `npx tsc -p tests/ui/fixtures/library-host/tsconfig.json`.

This test-only entry imports the production picker, access manager, dialog and styles. It replaces
native IPC with **simulated synthetic services**; it does not prove native authority, durability,
package loading or WKWebView input behavior. It is not part of the application entry or exported kit.
Actual independent-package acceptance is in `docs/capability-platform-evidence/C02b.md`.

Repeatable UI cases:

1. Success: open picker, verify search focus, Tab to Alpha, Escape to dismiss and restore focus to
   Open picker. Reopen to verify fresh zero selection. Select Alpha; Beta becomes disabled at limit 1.
2. Empty: no documents, disabled approval. Search no-match in success mode, then clear the search.
3. Loading: loading status and disabled approval for 2.5 seconds; cancellation remains available.
4. List error: only the failure message appears, not a false empty-Library claim; Reload restores the
   documents. Repeat for access-manager loading/error/reload.
5. Commit error: select Alpha and approve; both checkboxes stay locked, the unknown-outcome error and
   retry explanation appear. Retry returns metadata only; the visible audit contains two identical
   `commit:synthetic/Alpha` entries.
6. Revoke error: access manager initially shows Active; first revoke reports an unconfirmed outcome,
   leaves the record available and allows retry. Second revoke displays Revoked and removes its button.
7. Abort: pending picker closes after 2.5 seconds and displays cancellation without a commit audit entry.
8. Chinese/English and light/dark at widths 320, 400, 800 and 1240: inspect both dialogs, accessible
   names, wrapped recipient/purpose text, usable footer and no horizontal overflow. Escape closes the
   manager and restores focus to its opener. Native dialog tabbing may reach browser chrome at the
   last control; that is not evidence of focus reaching an underlying application control.

Inspect console errors, visible results and DOM bounds; do not infer native security from these mocks.

Focus regression: choose `async-disabled`, use keyboard Enter on Open picker, then Escape in the
picker. This uses the real Host adapter with delayed synthetic issuance/cleanup and keeps its
opener disabled for another 2.5 seconds after the result. Focus must return when that button enables.
Repeat, but open the access manager while the original button remains disabled: enabling it must not take
focus out of the second dialog. Also select Alpha and approve to check the success path. No native
grant is created by this browser fixture.
