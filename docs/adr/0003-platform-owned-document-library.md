# ADR 0003: Capabilities publish durable documents through a platform Document Gateway

- Status: proposed
- Date: 2026-09-04

## Context

Some capability output is a durable document rather than a transient result. Only the capability
knows which of its results deserve to be kept, and no capability should be given a filesystem path or
be made to depend on how the Library stores anything.

## Decision

The Capability Host provides a `Document Gateway`, separate from the Model Gateway. A capability that
declares the `documents.publish` permission submits only a stable key, a title, a collection, a date,
and Markdown content. The platform owns authorization, source namespacing, validation, persistence,
indexing, and Library presentation.

- A capability cannot pass a file path and does not depend on the Library implementation.
- The platform does not automatically persist the result of every AI call, because only the
  capability knows which results are durable documents.
- Disabling or uninstalling the source capability stops further publishing but never deletes
  documents already in the Library.
