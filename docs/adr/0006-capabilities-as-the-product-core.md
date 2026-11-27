# ADR 0006: Capability Packages are Nooki's core extension mechanism

- Status: accepted product direction; implementation pending
- Date: 2026-11-19
- Partially supersedes: [ADR 0005](0005-nooki-is-the-agent-substrate.md), for product scope and package runtime boundaries
- Design: [Capability platform](../capability-platform-design.md)

## Context

Nooki already installs independent Capability Packages, provides a scoped Host interface, runs
package jobs, and lets conversations invoke explicit package commands. Its developer Skill can
produce an independent project and an installable archive.

The intended product is a personal toolbox. Users should be able to install capabilities for
presentations, music, meeting notes, reports, games, and unforeseen domains without modifying Nooki.
Packages should use the shared chat, task board, agent access, and Library through public contracts,
then be removable without breaking other functionality or deleting the user's retained work.

ADR 0005's agent-substrate positioning and its shared-between-agents feature test are narrower than
this intent. The current trusted, same-realm package loader also cannot supply the containment and
termination guarantees needed for independently authored packages at broader scale.

## Decision

**Nooki is a host for independently installed capabilities. Capability Packages are its primary
extension mechanism; agent access is one of the host's shared services.**

1. Nooki owns shared resources, navigation, authorization, installation, execution management, and
   durable user artifacts. Packages own domain behavior, their own UI, and private data.
2. Packages integrate through a versioned public Host contract. They do not import shell features,
   call internal native commands, inspect another package's data, or implement vendor agent adapters.
3. Pages are optional. Explicit commands, finite jobs, and persistent in-app services have distinct
   lifetimes; commands may return immediate results without a Job. None requires AI to qualify.
4. The target runtime must provide enforceable identity, scoped authority, fault containment, and
   resource termination. The mechanism requires a separate evidence-backed runtime decision.
5. Published artifacts, their required passive dependencies, and stable references survive package
   removal. Private data is retained by default and can be deleted separately with a clear user decision.
6. Evolve the current implementation in phases, preserving legacy contracts during migration.
   Do not rewrite every built-in feature or build a marketplace as a prerequisite.

This supersedes the use of “shared between agents” as the admission test for Nooki capabilities.
It also replaces a blanket refusal to provide package isolation with a requirement to use and
validate suitable platform isolation mechanisms. It does not require inventing a sandbox, agent
loop, model client, or credential system. Retain ADR 0005's separation from vendor execution and
authentication internals, its reusable agent adapters, and its shared-asset principles where applicable.

## Consequences

- Expose existing conversation, task-board, agent, and Library owners through scoped public services.
- Treat task-board intent, job attempts, agent runs, and conversation turns as related but distinct.
- Separate provenance from execution ownership: nested work follows cancellation parentage, while
  explicitly handed-off user work has an independent host lifetime.
- Provide host-mediated resource selection and reopen navigation so retained results remain usable
  across capabilities without private data access or implicit grants.
- Check approved-source continuity on updates and reinstalls before exposing retained private data.
- Extend packaging for optional pages and immutable assets, then validate music, games, and file output.
- Keep the existing loader explicitly trusted-only until a replacement meets the isolation gates.
- Deliver the minimal SDK, Skill and isolated verification workflow with every phase; phase 3 hardens
  that tooling rather than introducing it. Implement catalog operations only as consumers need them.
- A new domain should normally require a new package, not a new hard-coded branch in Nooki.

## Not decided here

Exact wire schemas, the isolation topology, resource budgets, artifact transport, and migration
storage mechanics remain implementation choices with explicit gates in the design. Accepting this
ADR approves the product and ownership direction, not a claim that proposed APIs already exist.
