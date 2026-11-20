# Task citation component fixture

Run `npm run dev -- --host 127.0.0.1 --port 5193 --strictPort`, then open
`http://127.0.0.1:5193/tests/ui/fixtures/task-sources/` in an isolated browser.
Type-check with `npx tsc -p tests/ui/fixtures/task-sources/tsconfig.json`.

This renders the production `TaskReferences` and CSS. Navigation is simulated by displaying
the actual `workbench:open-document` event; no native document read or delegation occurs here.
Check Enter activation, Tab to the separate remove control, removal without a new open event,
selected reference identity, added snapshot identity, and plain-reference fallback. Language/theme
controls support narrow-width checks. Reload resets the removable reference.

The installed-app counterpart is `tests/fixtures/task-sources/seed.py`. Its acceptance remains
separate; browser results must not be reported as native task citation acceptance.
