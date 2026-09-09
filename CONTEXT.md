# Nooki

Nooki is a local-first host for independently installed capabilities. The Nooki remains useful as a shell even when no business capability is installed.

## Language

**Nooki**:
The host product that provides navigation, global settings, commands, and lifecycle management for installed capabilities.
_Avoid_: App shell, container

**Capability**:
An independently installed, enabled, disabled, and uninstalled unit of user-facing functionality, such as a report, table, or journal.
_Avoid_: Feature, plugin

**Capability Package**:
The distributable form of a Capability, containing its identity, version, entry points, visible interface, and requested permissions.
_Avoid_: Extension bundle

**Capability Registry**:
The Nooki record of installed Capability Packages and their version, compatibility, and enabled state.

**Installation**:
The act of validating and registering a Capability Package. A newly installed Capability is enabled by default and does not require separate AI Provider configuration.

**Enablement**:
The state that permits an installed Capability to appear in Nooki entry points and respond to commands.

**Disablement**:
The state that retains a Capability Package and its data while preventing it from participating in Nooki execution.

**Uninstallation**:
The removal of a Capability Package. User data is retained unless the user separately confirms its deletion.

**Capability Host**:
The controlled environment through which a Capability accesses Nooki resources. A Capability never depends on the internal structure of Nooki pages.

**Activity Event**:
A user-visible fact recorded by the Nooki or an authorized Capability for later review or agent-assisted summarization.

**Agent Capability**:
A Capability that reads explicitly authorized Activity Events and produces traceable, reversible generation or organization actions.

**AI Provider**:
The platform-managed source for model invocations, defined by a protocol, endpoint, model, and credential reference. A Codex subscription session is not a general-purpose AI Provider.

**Model Gateway**:
The single model invocation interface exposed to Capabilities. It checks installation, enablement, and `ai.invoke` permission before resolving the globally selected AI Provider.

**Credential Broker**:
The platform mechanism that resolves credentials for a Provider adapter without exposing raw tokens or API keys to Capability Packages.

**Agent Host**:
The platform interface for agent work involving tools, input references, and execution progress. It may use the Model Gateway or a dedicated Agent Runtime.

**Codex Agent Runtime**:
The runtime that executes agent tasks through the local Codex CLI and its subscription session and sandbox policy.

**Workspace**:
The personal context shared by Capabilities and Activity Events. The first release has one default Workspace without coupling Capabilities to specific pages.

**Document Library**:
The Nooki-owned, long-lived space for documents published by Capabilities or saved from Conversations. Documents remain available when their Source Capability is disabled or uninstalled.
_Avoid_: Capability storage, file dump

**Document Gateway**:
The Capability Host interface through which an authorized Capability publishes durable document content without knowing how the Nooki stores, indexes, or presents it.
_Avoid_: Library API, file writer

**Document Publication**:
A Capability's request to create or update a durable Markdown document using a stable identity and descriptive metadata.
_Avoid_: AI response, file path

**Library Document**:
A named Markdown artifact retained by the Document Library with its source and Document Collection.
_Avoid_: Activity Event, attachment

**Document Collection**:
A stable grouping inside one Source Capability's Document Library namespace. It is metadata managed by Nooki, not an arbitrary filesystem path supplied by a Capability.
_Avoid_: Folder path, directory string

**Source Capability**:
The Capability identity recorded as the producer of a Library Document. It is provenance only; uninstalling the Capability does not delete its documents.
_Avoid_: Owner

**Document Grant**:
An explicit user authorization allowing one Capability version to read only selected Library Document snapshots through the Capability Host. It is created by Nooki, never by the receiving Capability.

**Source Snapshot**:
The immutable document content captured when a document is attached to a Conversation turn or a Document Grant is confirmed. Its retention keeps a generated document's citations stable when the current Library Document changes or its source Capability is uninstalled.

**Document Reference**:
A provenance link to a Library Document, optionally identifying a Source Snapshot and a specific passage.

**Review Draft**:
A generated, locally retained result that the user must inspect before a Capability requests Document Publication. Completing generation does not imply publication.

**Conversation**:
The platform workspace for interacting with a persistent Codex session. Codex owns its message history and context; Nooki presents the interaction and connects it to Library documents.

**Conversation Turn**:
One user message and the Codex work that follows, including replies, public thinking summaries and tool progress.

**Conversation Answer**:
A Codex reply the user can keep in the Conversation or explicitly save as a Library Document with its source references.

**Document Source**:
The platform feature or Source Capability recorded as the producer of a Library Document. Provenance is independent of installation and document retention.
