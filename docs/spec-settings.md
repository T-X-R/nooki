# Spec: Settings as the substrate's configuration surface

Status: draft, awaiting review.

Follows [ADR 0005](adr/0005-nooki-is-the-agent-substrate.md).

## Objective

Settings becomes the place where a person configures **this machine's shared agent setup**, clearly
separated from Nooki's own preferences. Two claims the page currently makes stop being made, because
neither is true.

**"AI Provider" reads as the model Nooki uses.** It is not. It governs Capability `ai.invoke` and
nothing else. Conversations run on Codex regardless of what is selected there, so a person who
configures Claude on that page and then opens a Conversation is silently talking to a different
vendor.

**Three options read as three services.** They are two: one endpoint Nooki calls itself, and Codex —
listed twice, once per way of signing into it. Whether Codex holds a subscription or an API key is
recorded in `~/.codex/auth.json` and reported by its app-server through `account/read`. Codex
already knows. Asking the person to declare it is asking them to maintain a copy of a fact that is
maintained better elsewhere.

Both corrections have the same shape, and the same one ADR 0005 states: **things that belong to a
tool stop being configured in Nooki.** What is left is a single question — which installed agent
serves Capability invocations — and the answer is chosen from the agents actually detected.

The vocabulary was never wrong. `CONTEXT.md` already defines the **Model Gateway** as "the single
model invocation interface exposed to Capabilities" and warns that "a Codex subscription session is
not a general-purpose AI Provider". The interface drifted from the language; this spec pulls it back.

### Not in scope for this version

- Distributing anything new. MCP servers and conventions files are named here only so the structure
  does not need rearranging when they arrive.
- The session ledger, handoffs, or any change to Conversations.
- Letting a Capability request a specific model. The agent reports its models; the need has not
  arrived.

## Language

Terms added to `CONTEXT.md` when this spec is approved.

**Agent Substrate**: The shared layer Nooki maintains for the coding agents installed on this
machine — the assets they all read, the record of what they all did. Nooki is that layer and is not
one of the agents.

**Shared Asset**: A thing a person keeps once and every Agent Tool should see: a skill today; an MCP
server and a conventions file later. Every Shared Asset is authored in Nooki and reaches a tool by
the Skill Pool's distribution mechanism — a copy, a Mirror Receipt, and no silent overwrite. A model
endpoint is deliberately not one; see ADR 0005.

**Agent Access**: The choice of which Agent Tool serves Capability `ai.invoke`. It selects an agent,
never a credential and never a model. It has no effect on Conversations.
_Avoid_: AI Provider, model settings, capability model access

**Agent Sign-in**: The state Nooki detects and displays for an Agent Tool — signed in, and by what
method, as the tool reports it. It is shown and never enforced: an agent with no login of its own is
still selectable. Nooki never collects, stores, or forwards a credential, and sends a person to the
tool itself to sign in.

Terms removed from `CONTEXT.md` when this spec is approved: **AI Provider**, **Compatible Endpoint**,
**Credential Broker**. Nooki no longer calls a model service or resolves a credential, so nothing is
left for them to name. **Model Gateway** stays exactly as written.

## Decisions

| Question | Decision |
|---|---|
| What Settings is | One list of what Nooki itself uses. Not a console for the machine: Nooki does not own the agents, so it only says which one it reaches |
| Nooki's own model client | Removed. `compatible_provider.rs`, the HTTP invocation path, the endpoint list, the stored key, and the `api.config.toml` reader all go |
| What serves `ai.invoke` | A one-shot turn on the selected Agent Tool, over the resident app-server connection rather than a fresh process per call |
| How agents are listed | One entry per detected agent. Never one entry per way of signing into one |
| Sign-in and model choice | Detected and shown read-only, never a condition for selection. Installed is the condition |
| The `AI Provider` heading | Becomes **Agent access**, and says in one line that Conversations do not use it |
| Agent Tools registry | Stays on the Skill Pool page, with the distribution matrix it exists to serve |
| Skills, MCP, conventions | Not in Settings. Skills have a page, and a reserved empty section is a promise rendered as furniture |
| No agent installed | Stated plainly, with no control that cannot succeed. Documents, skills, and tasks keep working |
| Conversation archives | Leaves Settings. Archived conversations are Conversation data and belong on that page |
| Existing endpoint configuration | Migrated, not deleted underneath the person. See Migration |

### Why the agent, and not the endpoint

An installed agent is a better model client than Nooki will ever write: streaming, retries, vendor
quirks, structured output through `outputSchema`, and a model list it keeps current. It also already
holds the credential, which means Nooki can stop holding one.

The cost is real and is accepted in ADR 0005: with no agent installed, Nooki has no AI. That is the
honest shape of a product that sits above the agents rather than beside them.

## Structure

```
Settings
├── Agent access   which agent runs Capability invocations
├── Appearance
├── Language
└── Local data
```

One list, because Settings answers one question: what does Nooki itself use. An earlier draft of this
spec split it into "This machine" and "Nooki", which was wrong in a way worth recording. Nooki does
not own the agents on this machine, so it has no business presenting them as a machine it configures.
It only gets to say which one it reaches. Splitting the page implied a second kind of authority Nooki
does not have, and cost a heading, a subtitle, and a grouping rule to imply it.

Skills are not here either. They have a page, and a page beats a section that links to a page. MCP
servers and conventions files are not here until they exist; a reserved empty section is a promise
rendered as furniture.

### Agent access

Every agent Nooki knows how to detect, installed ones first, as one list:

```
 ●  Codex                                          Signed in · ChatGPT   ✓
 ●  Claude Code                                              Installed
 ●  pi                                                       Installed
 ○  kimi                                                 Not installed
 ─────────────────────────────────────────────────────────────────────
    Run one invocation    Really runs, and spends quota
```

One line per agent in a single bordered list, 460px wide, with the action in the same box. One agent
does not look lost and ten do not turn into a wall; nothing reflows between those two cases.

The proportions follow the current convention for this shape of list (shadcn's `Item` at `size="sm"`,
which is the same anatomy: media, content, actions): a name and a state that differ by colour rather
than by size, and a row tall enough to touch and no taller. An earlier version stacked a 12px name
over a 10px sentence in a 63px row, which is how a list ends up looking loose and cramped at once.

A dot carries availability instead of a badge repeating the words beside it. The check column is
always reserved, so no name shifts when the choice moves.

**Installed is the only condition.** Sign-in is shown and never enforced. pi has no login — an API key
in its own config is enough — and Claude Code keeps credentials where Nooki cannot look. Gating on a
state read from the outside would block working setups to pre-empt an error message the agent itself
delivers better. An agent that is not installed is listed, greyed, and cannot be selected, so a person
can see what Nooki is able to use.

**A row says only what Nooki knows, and never the same sentence twice.** That an agent holds its own
credentials is true of every row, so it is said once in the section intro. Repeating it down the list
put one identical sentence on consecutive lines, where the second occurrence carried nothing. The row
states what differs: `Signed in · ChatGPT`, `Installed`, `Not installed`.

The intro also carries the scope correction — Conversations always use the Codex CLI and are
unaffected — and the fact that invocations spend the selected agent's quota. These were a bulleted
list under the control. Two bullets restating the section in a heavier shape is not emphasis, and the
facts fit the sentence that was already there. A consequence worth recording: the correction is no
longer a piece of data a test can assert against, only a string, so `settings-sections.ts` lost its
scope-note registry. A rule that exists in one sentence does not need a registry to hold it.

What a row states is a statement, not a warning. An agent holding its own credentials is the
arrangement Nooki wants, not a problem to fix. Only Codex has a sign-in Nooki can read, from
`~/.codex/auth.json`; when it reports itself signed out, the row repeats that tool's own command and
offers nothing else.

Detection reads files. It never runs an agent binary — opening Settings should not start four
processes, and a state a file already records needs no subprocess to confirm.

There is no health check separate from the work. The only honest check is one real invocation, so the
single button runs one, on the chosen agent, and says plainly that it spends quota.

A choice a person made is kept even while it is broken, so Settings can explain the problem rather
than quietly substituting something else. Only a default nobody chose gives way to an agent that is
actually here.

## Migration

A person may have an endpoint configured and a key stored. Nothing is deleted underneath them.

1. Preferences that still name a Provider are migrated once. The person is told, once, that Nooki no
   longer calls a model service and that Capability invocations now run on an agent installed here.
2. The notice names where the old settings are: `compatible-endpoints.json` in the Nooki data folder,
   left unread and undeleted. Nooki does not display the key, and no longer contains code that could
   read it. A person who needs it back opens that file themselves.
3. The persisted `selectedProvider` value is read through an alias, so a settings file written before
   this change still loads. All three old values — `codex-api`, `codex-subscription`,
   `compatible-api` — land on Codex, which is what each of them actually reached or replaced.
4. The notice is shown exactly once and never again.

One constraint worth recording for anyone tempted to bridge the gap: Codex accepts only
`wire_api = "responses"`. `chat` was removed in Codex 0.155 and Anthropic's Messages format was never
accepted. An endpoint configured in Nooki often could not be handed to Codex at all.

## Stages

| Stage | Content | State |
|---|---|---|
| 1 | One honest list, the Conversation note on the control, archives moved out | this version |
| 2 | Agent tools with sign-in state; Capability model access selects an agent; the model client, endpoint store, and `api.config.toml` reader are removed; migration notice | this version |
| — | Custom tool registration stays on the Skill Pool page | decided, not deferred |
| 3 | MCP servers and conventions files become Shared Assets, with their own home | later, separate spec |

## Project Structure

```
src/features/settings/SettingsPage.tsx        → the section order and one renderer per section
src/features/settings/settings-sections.ts    → what Settings shows and where a correction lands
src/features/settings/agent-standing.ts       → how an agent stands, in one word, as pure functions
src/platform/agent-tools.ts                   → the detected-agent model shared by settings and today
src/platform/preferences.ts                   → drops `providerKind`; arms the one-time notice
src/shared/i18n.ts                            → English and Simplified Chinese strings
src-tauri/src/agent_tools.rs                  → detection, sign-in state, and the one-shot turn
src-tauri/src/capability_runtime.rs           → the chosen agent, with the old key read by alias
src-tauri/src/skill_pool.rs                   → detection delegated to `agent_tools`
src-tauri/src/lib.rs                          → `ai.invoke` served by an agent turn
tests/settings-sections.test.ts               → grouping and scope rules
tests/agent-standing.test.ts                  → standing, notes, and which agents are selectable
docs/spec-settings.md                         → this spec
docs/adr/0005-nooki-is-the-agent-substrate.md → the decision this follows
```

The migration notice is one line in `App.tsx` rather than a component: it is a sentence shown once,
and a component would have been scaffolding around a string.

Removed: `src-tauri/src/compatible_provider.rs`, `src-tauri/src/managed_provider.rs`,
`load_codex_api_profile`, their tests, `src/platform/ai-provider.ts`,
`src/features/settings/CompatibleEndpointSettings.tsx`,
`src/features/settings/provider-labels.ts`, the `ProviderKind` enum, and every endpoint and
credential string in `i18n.ts`.

## Commands

```
Build:            npm run build
Platform tests:   npm run test:platform
Rust tests:       cd src-tauri && cargo test -- --test-threads=1
Desktop dev:      npm run desktop:dev
```

## Testing Strategy

- `tests/settings-sections.test.ts` covers the rules as data, with no rendering: what Settings covers,
  what a browser preview hides, and that both corrections sit on the agent choice rather than
  floating in a heading.
- `tests/agent-standing.test.ts` covers preview, an agent with no login of its own, one reporting a
  sign-in, one reporting itself signed out, a choice that stopped working, and the listing order —
  with no filesystem access.
- Rust tests in `agent_tools.rs` cover sign-in detection against a temporary `HOME`, a machine with no
  agent, a custom tool that is listed but cannot be invoked, each agent's output shape, refusal
  before a process starts, and a real one-shot turn against a stub agent installed behind a Node
  launcher with a stripped `PATH`.
- Manual check in the desktop build: a Capability invocation succeeds with Codex selected, and still
  works after signing Codex out and selecting another agent.

## Boundaries

- Always: state which tools a setting affects, in the group heading and again where a person could
  draw the wrong conclusion; read sign-in state, never collect it.
- Ask first: nothing here writes outside Nooki's data directory. When Stage 3 does, it follows the
  Skill Pool's rules — staged write, Mirror Receipt, no silent overwrite.
- Never: store, read, or forward a credential; write a credential into another tool's configuration;
  imply that one selection governs both Capabilities and Conversations; delete a person's configured
  endpoint in the same release that stops using it.

## Success Criteria

1. Settings shows one list, and everything in it is something Nooki itself uses.
2. Codex appears once, with its sign-in method shown as detected, and cannot be configured in Nooki.
3. A person who selects an agent sees, without scrolling or hovering, that Conversations do not use
   it.
4. A Capability that invoked a model before this change still invokes one after it, through the
   selected agent, with no key entered.
5. An agent with no login of its own is selectable. On a machine with no agent at all, Settings
   explains the situation and offers no control that fails; the Library, Skill Pool, and tasks are
   unaffected.
6. A previously configured endpoint produces exactly one migration notice, its file is not deleted,
   and its key is never displayed.
7. Nooki's source contains no HTTP client for a model service and no credential store.
8. `npm run build`, `npm run test:platform`, and `cargo test` pass.

## Open Questions

None blocking. Deferred by decision: whether a Capability may request a specific model, and whether
Capability invocations should report their cost, wait until the ledger exists to record them.
