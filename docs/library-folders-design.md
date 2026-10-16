# Library folders

## Goal and layout

Replace topic/section navigation with a familiar folder workspace, retaining Nooki typography, warm surfaces, accent colors, and compact controls. The application sidebar has one Library link without disclosure or child navigation. The Library workspace contains a directory pane and a content pane:

```
Library
┌ My documents                 + ··· ┬ My documents / Project       + ┐
│ Search documents                  │                                │
│ ▾ Project                    + ··· │ Child folders and documents    │
│   ▾ Notes                    + ··· │ or the selected document       │
│     Document                   ··· │                                │
│ Root document                  ··· │                                │
└───────────────────────────────────┴────────────────────────────────┘
```

“My documents” is the root. A plus menu at root or any folder creates a Markdown document, creates a child folder, or imports Markdown/TXT into that exact location. Creation shows the destination as a breadcrumb, without a destination picker. No source/date grouping or automatic folders. The content pane shows folder contents, breadcrumbs, document reader, and a clear empty state. Search spans document titles and contents across the library and shows results with their location.

The title, current-location breadcrumb, add/manage actions, and global search share one compact workspace toolbar. The directory is slightly narrower than the original folder layout. “My documents” is an icon-free, collapsible group header.

Folder ellipsis: rename, move, delete. Rename edits the name in its current row or heading, with Enter/blur to save and Escape to cancel. Errors keep the draft in place for retry. Menus use bounded dimensions and fixed compact rows, rendered outside the directory layout to avoid inherited sizing in the desktop WebView. Document ellipsis: revise/rename, move, history, export, move to Trash. Document drag and drop moves into a folder or root; the Move dialog provides a keyboard alternative. Root ellipsis opens Trash. Existing conversation selection, authorization, revision history, citation snapshots, imports, exports, and Trash remain available. No new sharing, table, or cloud features.

## Folder contract and migration

Organization gains optional `folders: [{id, name, parentId?, documentIds}]`. Absence means legacy state. Migration derives root folders from topics and child folders from their custom sections; unowned custom sections become root folders. Stable prefixed IDs avoid collisions. Assigned source sections without a custom section become folders only when they represented explicit organization; unassigned capability/import/conversation documents remain at root. Old topic references shared by several topics remain entries in several folders referencing one unchanged document. An explicit move removes old folder entries and places the document at one destination. Migration never republishes content or changes IDs, revisions, history, origins, Trash, grants, or snapshots. Existing legacy organization fields remain in the stored backup for recovery, but all active UI writes use folder operations. Migration is deterministic and runs only when `folders` is absent; the first successful mutation persists it. Read-only loads do not write user data.

Folder mutations validate names (trimmed, 1–80 characters), sibling uniqueness (case insensitive), existing parents, and cycles. Move documents validates every ID and destination before mutating. Root is represented by an absent folder ID. Create/import validate their destination before publishing. Deleting a folder moves direct documents and child folders into its parent; conflicting child names receive a numbered suffix, and no content is deleted. Backup restore validates folder parents, IDs, cycles, and document references before replacing live data.

## Acceptance and verification

1. Global Library entry never expands; all folders are inside the workspace.
2. Contextual creation/import saves directly to the clicked location, including root and empty folders.
3. Nested create/rename/move/delete survives reload; duplicates and cycles fail without mutation.
4. Old topic/section membership, shared documents, revisions, Trash, origins, and citations survive migration.
5. Drag works to collapsed/empty folders and root, preserves content/revisions, and reports save failures without removing the source; retry works.
6. Folder and document menus support pointer and keyboard, dismiss on Escape/outside click, and restore focus. Responsive layout and long names remain usable.
7. Conversation save selects a folder; document references still open current documents or retained snapshots.
8. Run focused store/native migration tests, full platform tests, browser regression flows, TypeScript/Vite build, native tests, desktop build and reinstall. Inspect the installed app. Update the existing feature branch and PR; leave human merging unchanged.

## Implementation order

First add and test migration and folder operations in browser/native stores. Then replace sidebar/workspace and destination consumers. Finally run regression and visual checks, rebuild/reinstall, and publish the reviewable branch.
