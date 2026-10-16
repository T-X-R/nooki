# Create a Library document

The Library toolbar offers **Create document** as its primary action, with Import and Trash as secondary actions. Write a title and Markdown content, switch to Preview to inspect formatting, then choose **Create and save**. Saving opens the new document in the reader immediately.

Choose **Save to section** while creating a document to save directly into a section available in the current topic; **My documents** is the default. Creating within a topic also links the document to that topic. Destination validation runs before publishing, and creation uses the same durable storage, revision history, search, export, and conversation attachment flows as other Library documents. No file import is required.

The editor uses a single writing column, a separate view switch, and a persistent footer. Blank titles or content cannot be saved. Save failures retain the draft for retry; closing a nonempty draft requires an explicit discard action. The native and browser stores validate the current topic before publishing.

Validation covers durable readback, topic membership, revision history, invalid content and stale topics, browser creation and retry, draft discard, preview formatting, and responsive light/dark layouts.

Custom section headings also offer **Rename section** and **Delete section**. Names must be nonempty, at most 80 characters, and unique within their owning topic without regard to case. Deleting a section requires confirmation and returns its documents to their original source sections. Documents, topic membership, revision history, and Trash status are preserved. Assignments for trashed documents are also cleared so restoring a document cannot resurrect a deleted section. Stale destination selections are rejected after deletion and use the current name after a rename. Built-in source sections are not editable.

Sections created inside a topic belong to that topic and also appear in **All documents**. They are hidden from other topics, including the Move and Save to Library destination lists. Shared documents remain visible under their original source in topics that do not own the assigned section. Creating a section under All documents, or reading a legacy section without an owner, keeps it in All documents only. Deleting a topic retains its sections under All documents. Moving a document from All documents into a topic-owned section also links it to that topic; explicit cross-topic placements are rejected.

Drag a document by its title onto another section to move it. Valid targets are highlighted; dropping into a collapsed section expands it after a successful move. Dropping outside a section cancels, and persistence failures leave the document in its original section with visible error feedback. This changes organization only, preserving document content, revision history, and topic links. **Move to section** remains available for keyboard use.
