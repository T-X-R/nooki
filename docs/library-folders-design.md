# Library folders

## Goal and layout

Replace topic/section navigation with a familiar folder workspace, retaining Nooki typography, warm surfaces, accent colors, and compact controls. The application sidebar has one Library link without disclosure or child navigation. The Library workspace contains a directory pane and a content pane:

```
Library
┌ Library                            ┬ My documents / Project         ┐
│ Search documents                  │                                │
│ My documents                    +  │                                │
│ ▾ Project                    + ··· │ Child folders and documents    │
│   ▾ Notes                    + ··· │ or the selected document       │
│     Document                   ··· │                                │
│ Root document                  ··· │                                │
└───────────────────────────────────┴────────────────────────────────┘
```

“My documents” is an icon-free, collapsible root group. Its contextual plus menu, and each folder's plus menu, immediately create an empty document or folder at the clicked location. New folders enter inline renaming; sibling untitled names are numbered. Imports retain a file picker and review. No creation dialog, destination picker, source/date grouping or automatic folders are needed.

The compact header combines Library title/count, breadcrumbs, the current document's export/history menu and global search. It has no global add button or folder menu. The directory is narrower than the original layout. The content pane displays child folders and document rows, without document selection checkboxes or a batch toolbar. Search spans titles and bodies and shows each result's location.

Documents use an always-formatted Markdown rich-text editor with a continuous borderless title/body surface that fills the pane, automatic versioned saves, local draft recovery, and conflict protection. History opens a closable right sidebar with hidden scrollbars and normal wheel/trackpad scrolling; selecting a version previews it read-only in the existing document pane. Closing returns to the current editable version; restoring is a separate explicit action. Keep current plus nine prior revisions, pruning older history after successful publication without removing citation snapshots. Formatting controls float beside selected body text and never reserve a toolbar row; `/` in an empty paragraph opens block insertion. Standard keyboard shortcuts retain undo/redo. The body displays no update timestamp or source textarea. Citation snapshots remain read-only. Export opens a native Save dialog for a single Markdown file, with quiet cancellation and no displayed filesystem path. See [Document editing](library-document-creation.md) for the interaction contract.

Folder ellipsis: Add to conversation, rename, move, delete. Document ellipsis: Add to conversation, rename, move, supported capability authorization, original conversation when available, and Trash. Rename stays in place; Enter/blur saves and Escape cancels. Menus use bounded dimensions and compact rows outside the directory layout to avoid inherited WebView sizing. A folder appears as one compact name/count attachment without a disclosure tree, while retaining all descendants, including empty directories, in its task data and agent context. Its serialized hierarchy accompanies the retained document snapshots in task input and agent context. Shared document IDs are captured once; trashed documents are excluded. The existing 50-document conversation limit produces an explicit failure for oversized folders, without partial attachment. Both folders and documents support drag and drop, with the Move dialog as a keyboard alternative. Trash remains at the directory footer. Imports, grants, revisions, origin links and citation snapshots remain available.

## Folder contract and migration

Organization gains optional `folders: [{id, name, parentId?, documentIds}]`. Absence means legacy state. Migration derives root folders from topics and child folders from their custom sections; unowned custom sections become root folders. Stable prefixed IDs avoid collisions. Assigned source sections without a custom section become folders only when they represented explicit organization; unassigned capability/import/conversation documents remain at root. Old topic references shared by several topics remain entries in several folders referencing one unchanged document. An explicit move removes old folder entries and places the document at one destination. Migration never republishes content or changes IDs, revisions, history, origins, Trash, grants, or snapshots. Existing legacy organization fields remain in the stored backup for recovery, but all active UI writes use folder operations. Migration is deterministic and runs only when `folders` is absent; the first successful mutation persists it. Read-only loads do not write user data.

Folder mutations validate names (trimmed, 1–80 characters), sibling uniqueness (case insensitive), existing parents, and cycles. Move documents validates every ID and destination before mutating. Root is represented by an absent folder ID. Create/import validate their destination before publishing. Deleting a folder removes its entire subtree, including empty descendants, and moves every unique contained document to Trash in the same organization update. Nothing is lifted to its parent. Existing Trash timestamps, document revisions, origins and citation snapshots remain intact; unrelated folders/documents are unchanged. Deleted folders are not retained in Trash; restored documents appear at root unless they still have another surviving folder membership. Legacy shared entries reference one document, so trashing that document hides all its entries until restoration. Backup restore validates folder parents, IDs, cycles, and document references before replacing live data.

## Acceptance and verification

1. Global Library entry never expands; all folders are inside the workspace.
2. Contextual creation immediately opens an empty untitled item without a dialog; creation/import preserves the clicked destination, including root and empty folders.
3. Nested create/rename/move/delete survives reload; duplicates and cycles fail without mutation.
4. Old topic/section membership, shared documents, revisions, Trash, origins, and citations survive migration.
5. Documents and folders drag into empty/collapsed folders or root, preserve content/revisions, reject cycles and report failed saves without removing the source.
6. Folder and document menus support pointer and keyboard, dismiss on Escape/outside click, and restore focus. Responsive layout and long names remain usable.
7. Conversation save selects a folder; folder attachments retain the complete selected hierarchy and every live source; references open current documents or retained snapshots.
8. Run focused store/native migration tests, full platform tests, browser regression flows, TypeScript/Vite build, native tests, desktop build and reinstall. Inspect the installed app. Update the existing feature branch and PR; leave human merging unchanged.

## Implementation order

First add and test migration and folder operations in browser/native stores. Then replace sidebar/workspace and destination consumers. Finally run regression and visual checks, rebuild/reinstall, and publish the reviewable branch.

Window chrome uses an explicit left-mousedown drag handler for non-interactive descendants of the Library toolbar, standard topbar, and window controls header. Buttons, links, and input controls remain interactive; double-click toggles maximization. Verify both the Tauri IPC call and the installed desktop gesture.
