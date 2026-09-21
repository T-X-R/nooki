# Spec: Skills in a Conversation

Status: implemented.

## Objective

A person keeps every skill in the Skill Pool. Until now that skill was usable in Codex, Claude Code
and pi, but not in the Conversation Nooki hosts on top of those same CLIs. This closes that gap
without Nooki learning anything about skills: typing `$` or `/` in the composer lists the pool, and
the chosen skill reaches the agent as the agent's own skill invocation.

Nooki stays a bridge. It does not read, copy, quote, summarise or rank a skill, and it adds no
wording of its own to the turn. What a skill does is between that skill and the CLI running it.

### Not in scope

- Running skills that need `bash`. A Conversation allows file tools only, which each CLI enforces.
- Project-level skills. The pool is the list.
- Slash commands other than skills. Text Nooki does not recognise passes through untouched, so a
  CLI's own commands keep working exactly as they did.

## Language

**Attached Skill**: A Pool Skill the person names in a Conversation message with `$` or `/`. Nooki
resolves the name against the pool and passes the reference on; the agent loads it.

## Decisions

| Question | Decision |
|---|---|
| Trigger | Both `$` and `/`, because a person arrives with one CLI's habit. `/skill:name`, pi's own spelling, is understood too |
| The list | The Skill Pool, minus entries the pool reports as unreadable |
| What is sent | The skill's identity only: directory name, declared name, pool path |
| The typed text | Left exactly as typed. The mention stays in the message the agent receives |
| Codex | A native `skill` input element on `turn/start`: `{"type":"skill","name":…,"path":…}` — the same thing Codex's own composer sends for `$skill` |
| pi | The message is led by `/skill:name`, which pi's RPC transport expands before the turn starts |
| Claude Code | The message is led by `/name`, and `Skill` joins the allowed tools so Claude Code can dispatch it |
| Several skills at once | Every skill reaches Codex. pi and Claude Code expand one leading command and treat the rest of the message as its argument, so the first leads and the others stay in the text as typed |
| A skill missing from the pool | The turn stops before any agent is started |

### Why each CLI's own form

Nooki hosts three CLIs that already ship skills, each with its own loader, its own budget for skill
descriptions, and its own progressive disclosure. Injecting `SKILL.md` into the prompt would make
Nooki a fourth implementation that is worse than all three and drifts from them at every release. A
reference costs nothing to keep correct.

Codex needs no mirror because the element carries an absolute path into the pool. pi reads
`~/.agents/skills` itself. Claude Code loads from `~/.claude/skills`, so a skill has to be
distributed to it by the Skill Pool before `/name` resolves — the same condition as in Claude Code
itself.

## Project Structure

```
src-tauri/src/conversation_skills.rs          → resolution and each CLI's invocation form
src-tauri/src/skill_pool.rs                   → SkillPool::locate, skill_pool_list
src-tauri/src/codex_conversations.rs          → skill input elements on turn/start
src-tauri/src/native_agent_sessions.rs        → leading command for pi and Claude Code
src-tauri/tests/conversation_skills_test.rs   → resolution against a temporary pool
src/features/conversation/conversation-skills.ts → mention parsing and menu matching
src/features/conversation/ConversationPage.tsx   → the composer menu
tests/conversation-skills.test.ts             → mention behaviour, no filesystem
```

## Testing Strategy

- Rust tests resolve names against a temporary pool: order kept, repeats dropped, a declared name
  preferred over the directory, and a missing, hidden or escaping name refused.
- A transport test drives both native CLIs with a fake binary and asserts the prompt they actually
  receive starts with `/skill:pdf` and `/pdf`.
- TypeScript tests cover mention detection, insertion and recognition with no filesystem access.
- By hand, in the desktop build: `$` in the composer lists the pool, and the chosen skill is visibly
  loaded by the agent in each of the three runtimes.

## Boundaries

- Always: resolve a mention against the pool before a turn starts; keep the person's text as typed.
- Never: read, copy or quote a skill's content; add instructions of Nooki's own to a turn; rewrite a
  slash command Nooki does not recognise.
