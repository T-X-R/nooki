# Spec: Skill Pool

Status: draft, awaiting review.

## Objective

Nooki gains a platform feature — the **Skill Pool** — that makes `~/.agents/skills` the single place
where a person keeps agent skills, and keeps every coding agent on the machine supplied from that one
place.

The person today copies the same skill into every tool's own directory by hand. Nooki instead:

1. Collects the skills already installed on the machine into one pool at `~/.agents/skills`.
2. Shows duplicates and lets the person decide which copy survives, instead of overwriting silently.
3. Distributes pool skills to the coding agents detected on the machine, per tool and per skill.
4. Removes a skill from the pool and from every tool that received it, in one action.

This is a platform feature, next to the Document Library and the Capability Center. It is not a
Capability Package and does not depend on one.

### Not in scope for this version

- Project-level skills (`.agents/skills` inside a repository). Machine-wide skills only.
- A remote skill marketplace, or downloading skills from the network inside Nooki. A coding agent may
  install a skill from GitHub into the pool; Nooki picks it up on the next scan.
- Editing skill content. Nooki manages identity, placement, and removal, not authoring.
- Windows. Paths and tool detection target macOS first; nothing in the design blocks Windows later.

## Language

Terms below are added to `CONTEXT.md` when this spec is approved.

**Skill**: A directory holding a `SKILL.md` whose frontmatter declares a `name` and a `description`,
in the form defined by the Agent Skills standard. The directory name is the skill's identity.

**Skill Pool**: The Nooki-managed directory `~/.agents/skills` that holds one copy of every skill the
person keeps. It is the only place a skill is edited, versioned, or deleted.

**Pool Skill**: One entry in the Skill Pool, identified by its directory name and described by its
`SKILL.md` frontmatter.

**Agent Tool**: A coding agent installed on this machine that reads skills from a known directory,
such as Codex, Claude Code, or pi. Nooki lists an Agent Tool only when it is detected.

**Skill Mirror**: The copy of a Pool Skill that Nooki writes into an Agent Tool's skills directory.
Nooki owns its Skill Mirrors and never touches a directory it did not write.

**Mirror Receipt**: The record Nooki keeps inside an Agent Tool's skills directory listing the Skill
Mirrors it wrote and their content hashes. Without a receipt entry, a directory is the person's own
and is left alone.

**Adoption**: Moving a skill that lives in an Agent Tool's directory into the Skill Pool, after which
the tool is served by a Skill Mirror.

**Duplicate Review**: The screen where the person resolves skills that share a name, or share content
under different names, before they enter the pool.

## Decisions

| Question | Decision |
|---|---|
| Source of skills | Skills already installed in detected tool directories (adopted), plus anything an agent or the person drops into `~/.agents/skills` directly |
| Duplicate handling | Never silent. Nooki lists the conflict, shows both sides, and the person picks: keep pool copy, keep incoming copy, or keep both under a new name |
| Distribution | Per tool and per skill selection; every skill selected by default for every detected tool |
| Mechanism | Copy, not symlink |
| Tool visibility | Only detected tools are listed. One tool installed, one tool shown |
| Deletion | Uninstall, not just unlink: remove the mirror and its registration from every tool that holds it, then move the pool copy to trash, in one confirmed action |
| Developer skill | `workbench-capability-dev` is installed into the pool and distributed from there, ending the per-tool copies |
| Navigation | A top-level entry between Document Library and Conversations |
| Refresh | Mirrors sync automatically: on opening the Skill Pool, on window focus, and after every pool change |

### Why copy rather than link

A copy survives tools that refuse to follow links — Nooki's own developer integration rejects a
linked skill directory today (`src-tauri/src/developer_integration.rs`). The cost is that a mirror can
drift from the pool. Nooki accepts that cost and makes drift visible: each mirror is hashed against
its Mirror Receipt, a changed mirror is reported as `modified`, and the person chooses whether to
overwrite it or adopt the change back into the pool.

## Agent Tools

| Tool | Skills directory | Detected when |
|---|---|---|
| Codex | `$CODEX_HOME/skills`, default `~/.codex/skills` | `~/.codex` exists, or a `codex` binary is on `PATH`, or Codex.app is installed |
| Claude Code | `$CLAUDE_CONFIG_DIR/skills`, default `~/.claude/skills` | the directory's parent exists, or a `claude` binary is on `PATH` |
| pi | `~/.pi/agent/skills` | `~/.pi` exists, or a `pi` binary is on `PATH` |
| Custom tool | a directory the person names and points at | the person added it |

The custom-tool entry is what makes "xxa, xxb, zyx" work without a Nooki release: name, skills
directory, done. It is stored with the built-in tools and behaves identically.

A tool that reads `~/.agents/skills` natively (pi does) is shown with its pool-reading directory and
no mirrors, because mirroring into a directory the tool already reads would duplicate every skill.
Per-skill selection is unavailable for such a directory and the interface says so.

Detection reuses the binary and home-directory probing already written for the developer integration
rather than inventing a second mechanism. Nooki reads tool directories and writes only inside their
`skills` directory. It never reads credentials and never runs a tool binary.

## Flows

### Scan

Nooki scans the pool and every detected tool directory. For each directory entry it reads
`SKILL.md` frontmatter (`name`, `description`) and hashes the file contents. The result is:

- Pool skills, with name, description, file count, and hash.
- Tool entries classified as: `mirror` (present in the Mirror Receipt and unchanged), `modified`
  (in the receipt, content differs), `linked` (a symlink into the pool, from the person's earlier
  manual setup), or `foreign` (unknown to Nooki — a candidate for Adoption).
- Conflicts, for Duplicate Review.

An entry without a readable `SKILL.md` is reported as unrecognized and is never moved or deleted.

### Adopt

The person selects foreign entries and confirms. Nooki copies each into the pool, verifies the copy,
then replaces the original with a mirror and records it in that tool's Mirror Receipt. A `linked`
entry is resolved by keeping the pool target and replacing the link with a copy.

Adoption never deletes the source before the pool copy is verified.

### Duplicate Review

Two kinds of duplicates are surfaced:

1. **Same name, different content** — two tools hold `pdf`, or the pool and a tool disagree.
2. **Different name, same content** — the same skill adopted twice under two directory names.

For each conflict Nooki shows both sides: source directory, `SKILL.md` description, file list with
differing files marked, size, and modified time. The person chooses keep pool copy, keep incoming
copy, or keep both — the second entering the pool under a name the person supplies. Nothing is
written until the choice is made, and skipping a conflict leaves both sides untouched.

### Distribute

A selection matrix of pool skills by detected tool, everything selected by default. Applying it
writes missing mirrors, refreshes stale ones, removes mirrors the person deselected, and updates each
Mirror Receipt. A `modified` mirror is never overwritten without an explicit confirmation that names
the files that would be lost.

Writes are staged in a temporary directory inside the same tool directory and moved into place, the
pattern the developer integration already uses, so an interrupted write cannot leave a half-copied
skill where a tool would read it.

### Delete, meaning uninstall

Deleting a Pool Skill is an uninstall on every platform that holds it, not a file removal in one
place. For each tool Nooki removes the Skill Mirror, drops its entry from the Mirror Receipt, and
removes any reference Nooki added to that tool's configuration, so the tool stops offering the skill
instead of failing to load it. Only then is the pool copy moved to
`~/.agents/.nooki-trash/<name>-<timestamp>`, so a mistake is recoverable from Finder.

The confirmation names every tool the skill will be uninstalled from. A `modified` mirror is reported
and kept unless the person confirms that one too. A tool that reads the pool directly loses the skill
as soon as the pool copy moves to trash; the confirmation says so.

### Developer skill through the pool

`workbench-capability-dev` stops being written separately into each tool directory. The Developer
Center installs it into the Skill Pool, and distribution is the same mechanism every other pool skill
uses. Its bundled version, update detection, and preservation of local edits survive the move: a
developer skill the person has edited is still reported rather than overwritten.

## Project Structure

```
src-tauri/src/skill_pool.rs                → scan, adopt, duplicate resolution, mirror write, delete
src-tauri/src/lib.rs                       → Tauri command registration and managed state
src-tauri/tests/skill_pool_test.rs         → filesystem behaviour against a temporary HOME
src/features/skills/skill-pool.ts          → tool and skill models, selection state, conflict shaping
src/features/skills/SkillPoolPage.tsx      → the Skill Pool interface
src/shared/i18n.ts                         → English and Simplified Chinese strings
tests/skill-pool.test.ts                   → model and selection logic
docs/skill-pool-sandbox.sh                 → manual rehearsal against a throwaway HOME
docs/spec-skill-pool.md                    → this spec
docs/adr/0004-platform-owned-skill-pool.md → the decision record
```

Filesystem work stays in Rust. The interface holds no path logic beyond display.

## Commands

```
Build:            npm run build
Platform tests:   npm run test:platform
Capability tests: npm run test:capabilities
Rust tests:       cd src-tauri && cargo test -- --test-threads=1
Desktop dev:      npm run desktop:dev
```

The Skill Pool writes outside Nooki's own data directory, so the automated suites run against a
temporary `HOME` and never touch a real one. Before releasing a change to adoption, duplicate
resolution, or deletion, rehearse it by hand the same way:

```sh
./docs/skill-pool-sandbox.sh reset    # a machine with coding tools but no skill pool
./docs/skill-pool-sandbox.sh open     # launch the installed app with HOME set to the sandbox
./docs/skill-pool-sandbox.sh add      # drop in a skill, as an agent would
./docs/skill-pool-sandbox.sh status   # show what the sandbox holds
./docs/skill-pool-sandbox.sh clean    # delete the sandbox
```

The sandbox seeds the conflicts worth seeing by hand: a skill only Claude Code has, one name held by
two tools with different content, a non-skill file inside a tool directory, and a custom tool
directory. Your real `~/.agents`, `~/.codex`, `~/.claude`, and Nooki data are never read or written.

## Testing Strategy

- Rust tests drive a temporary `HOME` with fabricated tool directories and cover: scan
  classification, adoption without data loss, name and content conflicts, mirror write and refresh,
  deselection removal, modified-mirror protection, deletion with trash, and refusal to touch entries
  outside the Mirror Receipt.
- TypeScript tests in `tests/` cover selection defaults, conflict shaping, and the disabled state for
  pool-reading tools, with no filesystem access.
- Manual check in the desktop build against the person's real machine, which currently holds 48 pool
  skills and a fully linked `~/.claude/skills`.

## Boundaries

- Always: verify a copy before removing its source; write through a staging directory; keep a Mirror
  Receipt for every directory Nooki writes; move deletions to trash.
- Ask first: overwriting a `modified` mirror; resolving any duplicate; deleting a pool skill;
  converting an existing link into a copy.
- Never: touch a directory absent from the Mirror Receipt; follow a link out of a managed directory;
  read tool credentials or configuration beyond the skills directory; execute a tool binary; delete a
  skill the person did not name.

## Success Criteria

1. With Codex, Claude Code, and pi installed, the Skill Pool lists exactly those three tools; with
   only Codex installed, it lists one.
2. Every skill under `~/.agents/skills` is listed with its name and description read from `SKILL.md`.
3. A skill present only in `~/.claude/skills` is adopted into the pool and served back as a copy, and
   the tool still loads it.
4. Two skills with the same name but different content stop at Duplicate Review, show what differs,
   and enter the pool only after a choice.
5. Deselecting a skill for one tool removes that mirror and leaves the pool and other tools intact.
6. A skill installed into `~/.agents/skills` by a coding agent appears after a rescan and can be
   distributed without any further copying by hand.
7. Deleting a skill removes it from the pool and from every tool holding a mirror, and the pool copy
   is recoverable from trash.
8. A skill directory Nooki did not write is never modified or deleted without an explicit choice.
9. `npm run build`, `npm run test:platform`, and `cargo test` pass.

## Open Questions

None blocking. Resolved during review: the developer skill moves into the pool, the Skill Pool sits
between Document Library and Conversations in navigation, mirrors sync automatically, and deletion
uninstalls from every tool.
