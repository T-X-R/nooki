# Public sourced-board acceptance package

This fixture uses the distributed kit 0.5.0 / Nooki 0.6.0 contract only. It declares storage,
document publication, read-selected and board.create. It has no jobs, agent calls or native imports.
The refusal controls intentionally exercise foreign references and conflicting requests.

1. Export `npm run capability:kit -- /tmp/sourced-board-kit.zip` and extract outside the checkout.
2. Run the extracted Skill's `scripts/create-capability.mjs <new-directory> org.example.sourced-board`.
   Copy this fixture's `index.tsx`, `style.css` and `manifest.json` into the generated project.
3. Install that project's own dependencies, run `npm run check` and `npm run pack`. Repeat for
   `org.example.sourced-peer`, using `peer-manifest.json` as its manifest. No checkout imports or
   dependency symlinks are needed. Import both actual ZIPs in a fresh isolated desktop profile.
4. Reader: publish the original source; select it through the Host picker. The selection action
   stores the full input and a new intent key before any create. Create/replay twice; expect one
   todo and identical item references. Changed input with that key must return CONFLICT.
5. Peer: paste the reader's single public source reference into the refusal field and attempt
   creation. Expect PERMISSION_DENIED. Do this while the reader grant is still active, to isolate
   ownership refusal from revocation. The peer may separately select the same document for itself.
6. Reader: change current source. Open the task citation in Nooki; expect ORIGINAL SELECTED SOURCE.
   Quit/restart; Show saved intent and Create/replay must use the same key/input and item identity.
7. Library → Document access: revoke reader's selection. Reader's Read selected source and
   Try creation with new key must fail. Create/replay with the committed original key must still
   return the original reference; its task citation remains readable by the user.
8. Inspect native state: one reader todo, canonical sources, original provenance/revision, one
   committed create receipt, and no execution authorization, run, thread or accepted delivery.
9. Check both languages/themes, keyboard controls and narrow/wide page layouts. Portable preview
   must visibly fail desktop operations; do not treat it as native authorization evidence.

The evidence receipt must distinguish scaffold/check/pack, component rendering and actual native
archive execution. These legacy packages remain trusted-only; this fixture does not test production
runtime isolation or later task-delivery APIs.
