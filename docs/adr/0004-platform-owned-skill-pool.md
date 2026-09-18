# ADR 0004: The Skill Pool is a platform feature backed by `~/.agents/skills`

- Status: accepted
- Date: 2026-09-17

## Context

A person running several coding agents keeps the same agent skill in each tool's own directory, kept
in sync by hand. Nooki already wrote its own developer skill into one tool directory at a time, which
reproduced the problem it should have solved.

Skills are shared machine-wide state, not capability state. Nothing about them belongs to a single
Capability Package, and a person should not have to install a capability to keep their skills in
order.

## Decision

Make the **Skill Pool** a platform feature alongside the Document Library and the Capability Center,
with `~/.agents/skills` as the single place a person keeps skills. Nooki collects the skills already
installed on the machine into that pool, resolves duplicates by hand, and distributes pool skills to
the coding agents it detects.

Key choices:

- **Copy, not symlink.** A copy survives tools that refuse to follow links — Nooki's own developer
  integration rejects a linked skill directory. The cost is that a mirror can drift from the pool, so
  drift is made visible instead of being prevented: each mirror is hashed against its Mirror Receipt,
  a changed mirror is reported as `modified`, and the person chooses whether to overwrite it or adopt
  the change back into the pool.
- **Never resolve a duplicate silently.** Nooki lists the conflict, shows both sides, and the person
  picks: keep the pool copy, keep the incoming copy, or keep both under a new name.
- **Only touch what Nooki wrote.** A Mirror Receipt inside a tool's skills directory records the
  mirrors Nooki wrote and their hashes. Without a receipt entry, a directory belongs to the person
  and is left alone. An entry without a readable `SKILL.md` is reported as unrecognized and is never
  moved or deleted.
- **Adopt before deleting.** Adoption copies into the pool and verifies the copy before the original
  is replaced with a mirror.
- **Show only detected tools.** One tool installed, one tool listed. A custom tool is a name plus a
  directory, so a tool Nooki has never heard of works without a release.
- **A tool that reads the pool natively gets no mirrors.** Mirroring into a directory the tool
  already reads would duplicate every skill, so per-skill selection is unavailable there and the
  interface says so.
- **Uninstall, not unlink.** Removing a skill removes the mirror and its registration from every tool
  that holds it, then moves the pool copy to trash, in one confirmed action.
- **The developer skill uses the same path.** `workbench-capability-dev` is installed into the pool
  and distributed from there, which ends the per-tool copies.

Detection reuses the binary and home-directory probing already written for the developer integration.
Nooki reads tool directories, writes only inside their `skills` directory, never reads credentials,
and never runs a tool binary.

## Consequences

- Nooki takes responsibility for files outside its own data directory. The Mirror Receipt is what
  keeps that responsibility bounded, so it has to be written before a mirror is trusted.
- Mirrors drift. That is accepted and surfaced rather than designed away.
- Skills are machine-wide, so this feature has no meaning in a browser preview and is a desktop-only
  surface.

## Not decided here

- Project-level skills in a repository's `.agents/skills`.
- A remote skill marketplace or downloading skills from inside Nooki. A coding agent may install a
  skill from GitHub into the pool; Nooki picks it up on the next scan.
- Editing skill content. Nooki manages identity, placement, and removal, not authoring.
- Windows. Paths and tool detection target macOS first; nothing in the design blocks Windows later.

See [the Skill Pool spec](../spec-skill-pool.md) for the flows and the interface.
