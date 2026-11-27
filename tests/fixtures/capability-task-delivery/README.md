# Public task-delivery acceptance packages

This fixture uses only exported kit 0.8.0 / Nooki 0.9.0 contract and UI modules. Reader and peer use
separate identities, storage, grants and receipts. Both declare storage, document publication,
selected-document reading, todo creation and `board.attach-delivery`. There are no jobs, commands,
Agent calls, native imports, credentials or automatic startup effects. Use synthetic data in an
isolated desktop profile. Building these archives is not approval to install them.

## Reproduce outside the checkout

1. Export `npm run capability:kit -- /tmp/task-delivery-kit.zip`; extract it outside this checkout.
2. From the extracted Skill run `node scripts/create-capability.mjs <new-directory> org.example.task-delivery-reader`.
   Copy this fixture's `index.tsx`, `style.css` and `manifest.json` into that new project.
3. Install the project's own dependencies, then run `npm run check` and `npm run pack`. Do not use
   checkout imports or dependency symlinks. Repeat for `org.example.task-delivery-peer`, using
   `peer-manifest.json` as its `manifest.json`.
4. Record archive paths/hashes and permissions, then install the actual ZIPs through Nooki in the
   isolated profile after the installation permissions have been approved.

## Installed acceptance sequence

1. Each package: publish original notes and create its synthetic todo. Repeating Create uses its
   original key and returns the same receipt, not another task. The fixture never delegates work.
2. Reader: choose its own published notes. Open the task picker, inspect package/purpose/attach-only
   scope, then dismiss. There must be no grant or new intent. Confirm one current task on the next
   attempt; the complete intent (grant ID, exact item revision, document references and key) is saved
   before any attachment. Inspect Task access for its active record.
3. While the reader grant is active and before attachment, peer pastes the reader's complete intent
   into its refusal field and tries Foreign task grant. Expect `PERMISSION_DENIED` and no effect.
4. Peer obtains its own fresh grant for its own unchanged task. With the same reader intent still
   pasted, try Own task grant with foreign source. Expect `PERMISSION_DENIED`. Do this before using
   the peer grant for any successful effect so a stale task cannot mask document-ownership refusal.
5. Reader: Attach or replay unchanged twice. Expect one delivery, one attachment receipt and identical
   `{item,deliveryId}` results. Changed input with the same key must return `CONFLICT`. A new key with
   the old task revision must fail without adding another delivery. Other task content stays unchanged.
6. In Task details expand the delivery. It must show ORIGINAL RETAINED DELIVERY; viewing must not
   execute/accept the task. Change the original through the fixture, then delete that synthetic
   original from the Library. The task's retained body must remain original after both actions.
7. Quit/relaunch the profile normally. Reader's saved intent must survive; replay unchanged returns
   the original result even though the original document is gone, with no extra delivery.
8. Revoke reader's task grant in Task access. New effects fail, exact committed replay still returns
   its metadata, and the retained delivery remains. Record revoked and stale/inactive access states.
9. Republish a synthetic source. Reader uses Select document snapshot to obtain an active document
   grant, then selects a fresh task version. Revoke only the document grant in Library access before
   attachment. Expect `PERMISSION_DENIED` with the fresh task unchanged. Grant/task edits must be
   controlled separately so the refusal has an unambiguous cause.
10. For user-edit refusal, prepare a fresh valid source and task intent. Edit the task title/description
    through Nooki before attachment. Expect `CONFLICT`, unchanged delivery count and a stale task
    grant. Cancelling a picker or retrying an uncertain approval must not silently refresh the version.
11. Peer independently selects the reader's synthetic document through the Library picker and its
    own current task. Its authorized attachment must succeed; this distinguishes legitimate sharing
    from the foreign-reference controls. Change/delete the original and retain the selected body.
12. Remove the producing package through the capability manager. User-owned tasks and retained text
    must remain readable after removal and restart; no new package effect may run. Inspect native
    state for card status, receipts, exact retained content and absence of execution/run authority.

## UI and evidence boundaries

- Verify picker search/limit, loading/error/retry, explicit dismissal, Tab/Enter/Space/Escape and
  opener-focus restoration across disabled buttons and asynchronous issuance/cleanup.
- Verify both package pages, picker/access manager and retained viewer in Chinese/English and
  light/dark at narrow/wide supported sizes. Test duplicate task titles and long retained text.
- Portable preview must visibly reject native methods with `UNSUPPORTED_SERVICE`; neither successful
  builds nor simulated storage prove native grant or attachment behavior.
- Record independent scaffold/check/pack, static/component checks, installed command acceptance and
  actual UI observations separately. Do not close C04c1/C04c2/C04c/C04 while any required evidence is
  missing. The legacy shared realm remains trusted-only pending the production isolation tasks.
