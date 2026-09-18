# Nooki

Nooki is a local-first host for independently installed capabilities. Nooki remains useful as a shell even when no business capability is installed.

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
The act of validating and registering a Capability Package. A newly installed Capability is enabled by default and does not require separate model configuration.

**Enablement**:
The state that permits an installed Capability to appear in Nooki entry points and respond to commands.

**Disablement**:
The state that retains a Capability Package and its data while preventing it from participating in Nooki execution.

**Uninstallation**:
The removal of a Capability Package. User data is retained unless the user separately confirms its deletion.

**Capability Host**:
The controlled environment through which a Capability accesses Nooki resources. A Capability never depends on the internal structure of Nooki pages.

**Activity Event**:
A user-visible fact recorded by Nooki or an authorized Capability for later review or agent-assisted summarization.

**Agent Capability**:
A Capability that reads explicitly authorized Activity Events and produces traceable, reversible generation or organization actions.

**Agent Substrate**:
What Nooki is. It owns what the agents on a machine share and never owns what any one of them is doing. It distributes shared assets, reads sessions without writing them, keeps the ledger of what happened, and runs no model client of its own.
_Avoid_: Agent platform, AI platform

**Shared Asset**:
Something more than one agent on this machine can use, that Nooki distributes from one place: a skill today, an MCP server and a conventions file later. A credential is not a Shared Asset.

**Agent Access**:
The Agent Tool that serves `ai.invoke` for Capability Packages. It is a choice among the agents installed here, never a protocol, endpoint, model, or key. Invocations spend that agent's quota, and Conversations are unaffected by it.
_Avoid_: AI Provider, compatible endpoint, capability model access

**Agent Sign-in**:
Whether an Agent Tool reports itself as signed in, read from that tool's own files and never declared by a person. An agent that keeps its credentials where Nooki cannot look is reported as unknown rather than guessed at. Sign-in is shown and never enforced: an agent with no login of its own, such as pi, is still selectable. Nooki never collects or stores a credential.

**Model Gateway**:
The single model invocation interface exposed to Capabilities. It checks installation, enablement, and `ai.invoke` permission, then hands the request to the Agent Tool chosen for Agent Access.

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
The Capability Host interface through which an authorized Capability publishes durable document content without knowing how Nooki stores, indexes, or presents it.
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

**Skill Pool**:
The Nooki-managed directory `~/.agents/skills` holding one copy of every agent skill the person keeps. It is the only place a skill is added, resolved, or deleted, and it is what makes the same skill available to every coding tool on the machine.
_Avoid_: Skill folder, skill registry

**Pool Skill**:
One entry in the Skill Pool, identified by its directory name and described by the `name` and `description` its `SKILL.md` declares.

**Agent Tool**:
A coding agent installed on this machine that reads skills from a known directory, such as Codex, Claude Code, or pi. Nooki lists an Agent Tool only when it is detected, and a person can register one Nooki does not know about by naming its skills directory. Detection reads files and never runs an agent binary; an agent is started only when a Capability asks for work.
_Avoid_: Client, IDE

**Skill Mirror**:
The copy of a Pool Skill that Nooki writes into an Agent Tool's skills directory. A copy rather than a link, because a tool may refuse to follow links.
_Avoid_: Symlink, shortcut

**Mirror Receipt**:
The record Nooki keeps inside an Agent Tool's skills directory listing the Skill Mirrors it wrote and their content hashes. A directory absent from the receipt belongs to the person and is never modified or removed.

**Adoption**:
Moving a skill that lives in an Agent Tool's directory into the Skill Pool, after which that tool is served by a Skill Mirror.

**Duplicate Review**:
The decision Nooki asks for when skills collide: the same name with different content, an edited mirror, a hand-made link, or two pool skills holding identical content. Nothing is overwritten before the person chooses.

**Skill Uninstallation**:
Removing a Pool Skill from every Agent Tool that holds it, including its Mirror Receipt entry, before moving the pool copy to trash. Deleting files in one place is not an uninstallation.

**Document Source**:
The platform feature or Source Capability recorded as the producer of a Library Document. Provenance is independent of installation and document retention.
