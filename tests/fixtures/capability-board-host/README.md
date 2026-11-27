# Public board Host acceptance fixture

This is a synthetic verification package, authored and built outside the Nooki checkout from
exported kit 0.3.0 before retaining these four source files. It uses only the public SDK. The
forged-owner button and retained stale Host deliberately violate normal package guidance to test
rejection; do not copy those patterns into a production package.

1. Export the kit with `npm run capability:kit -- /tmp/board-kit.zip` and extract it outside Nooki.
2. Run its `scripts/create-capability.mjs <new-directory> org.example.board-acceptance`.
3. Copy this fixture's `index.tsx`, `style.css` and `manifest.json` into that project.
4. In that independent project, run `npm install`, `npm run check` and `npm run pack`.
5. Use `scripts/desktop-profile.mjs create` / `launch <profile>` in Nooki to launch an empty isolated
   profile. Import the actual archive through the UI, review the permission and confirm installation.
6. Check Create/replay twice (same reference), Conflict (CONFLICT), Forged owner (INVALID_INPUT),
   and Create from job (completed with a second reference). The board should have two todo cards.
7. Schedule stale call, leave the page and disable the package before eight seconds pass. Re-enable
   and reopen: the late call reports CANCELLED, with no third card. Replaying uses the first reference.
8. Quit/restart the same profile and replay again. The original reference and two cards remain.
9. Scaffold a second outside-checkout project, copy the same page/style and use `denied-manifest.json`
   as its manifest. Independently install/check/pack; desktop Create must report PERMISSION_DENIED.

This fixture does not call an agent. Read the linked evidence for native file assertions, zero live
grants after page exit, limits and deliberately unverified hostile-code isolation.
