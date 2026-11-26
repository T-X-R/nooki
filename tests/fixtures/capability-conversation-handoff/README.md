# Public conversation-handoff acceptance packages

This fixture uses only exported kit 0.10.0 / Nooki 0.11.0 contract and UI modules. Reader and peer
have separate identities and storage. Both declare `storage`, `documents.publish`,
`documents.read-selected` and `conversations.handoff`. No job, command, Agent call, native import,
credential access or automatic startup effect is present. All effects require explicit buttons.
Use only synthetic documents in an isolated desktop profile. Building does not authorize installation.

## Reproduce independently

1. Export `npm run capability:kit -- /tmp/handoff-kit.zip` and extract it outside the checkout.
2. Run the exported Skill's `scripts/create-capability.mjs <new-directory>
   org.example.conversation-handoff-reader`. Copy this fixture's `index.tsx`, `style.css` and
   `manifest.json` into that project. Repeat with the peer identity and `peer-manifest.json`.
3. Each project installs its own dependencies without symlinks and runs `npm run check` and
   `npm run pack`. Inspect the actual ZIP manifest/entries and record hashes.
4. Check the portable preview at 480/1000 px, light/dark and Chinese/English. Saving a text-only
   intent uses simulated storage; handoff and document operations must reject as unavailable.
5. Obtain approval for both actual ZIPs and all four permissions before installing through Nooki.

## Native acceptance sequence

1. Install both ZIPs through Nooki's normal permission confirmation. Record profile/binary/hash.
   Verify the shared-runtime notice and the exact four permissions; no real Agent is used.
2. Reader saves a text-only intent and opens handoff. Inspect identity, full text, new/existing
   destination and sharing copy. Dismiss using Escape; no native draft or receipt is created and
   focus returns to the opener. Retry the same intent and approve a new-chat offer.
3. Leave an unsent synthetic message in the new composer before another fresh offer. Opening must
   preserve it; adoption appends text. Do not click Send. Navigation and receipt replay must not
   start a turn, create duplicates or replace the user's unsent text.
4. Reader publishes original notes, selects the exact document through the Host Library picker,
   and saves an intent with sources. Peer pastes that complete synthetic intent and tries Foreign
   source grant; expect permission refusal with no draft. Target override must fail as invalid
   before review. Peer may later select the same source through its own picker and succeed.
5. Approve reader's source-bearing intent and inspect the saved original text/revision. Repeating
   Hand off or replay unchanged returns the same receipt without navigation; changing text with
   that key conflicts. A fresh effect using a revoked selection fails; committed replay still works.
6. Choose an existing ordinary synthetic conversation in the Host picker, inspect the destination,
   and approve. Existing unsent composer text must remain. A task-owned or disappeared target is
   unavailable; never silently create or retarget a conversation. Use a deterministic local test
   adapter if a native catalog fixture is required; do not use personal conversations or a real model.
7. Change the original through the fixture. The offer must retain ORIGINAL RETAINED HANDOFF.
   Restart the test profile and replay the saved intent. The native offer/receipt survives and no
   duplicate is created. Manual composer edits are not claimed to survive application restart.
8. Remove the reader through the capability manager and restart. Capability drafts still opens its
   approved offers and retained sources without the producer. If testing permanent source deletion,
   obtain specific approval for that synthetic document before deleting its history.
9. Check read-only native state for exact retained text, receipts, targets and absence of an Agent
   turn. Record installed behavior separately from native unit tests and synthetic component IPC.

Verify keyboard/focus, loading/error, Chinese/English, light/dark and narrow/wide layouts in the
actual Host controls. C05c/C05 stay open until the required installed behavior is evidenced; a
successful build or portable preview cannot close them.
