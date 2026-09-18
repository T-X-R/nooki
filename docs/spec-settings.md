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

**Machine Settings**: The Settings group that configures the Agent Substrate. What is changed here
affects tools other than Nooki.

**Nooki Settings**: The Settings group that configures Nooki itself. Nothing here leaves Nooki.

**Capability Model Access**: The choice of which Agent Tool serves Capability `ai.invoke`. It selects
an agent, never a credential and never a model. It has no effect on Conversations.
_Avoid_: AI Provider, model settings

**Agent Sign-in**: The state Nooki detects and displays for an Agent Tool — signed in, and by what
method, as the tool reports it. Nooki never collects, stores, or forwards a credential, and sends a
person to the tool itself to sign in.

Terms removed from `CONTEXT.md` when this spec is approved: **AI Provider**, **Compatible Endpoint**,
**Credential Broker**. Nooki no longer calls a model service or resolves a credential, so nothing is
left for them to name. **Model Gateway** stays exactly as written.

## Decisions

| Question | Decision |
|---|---|
| What Settings is | The configuration surface of the Agent Substrate, plus Nooki's own preferences, in two groups that never mix |
| Nooki's own model client | Removed. `compatible_provider.rs`, the HTTP invocation path, the endpoint list, the stored key, and the `api.config.toml` reader all go |
| What serves `ai.invoke` | A one-shot turn on the selected Agent Tool, over the resident app-server connection rather than a fresh process per call |
| How agents are listed | One entry per detected agent. Never one entry per way of signing into one |
| Sign-in and model choice | Detected and shown read-only, with a link to manage them in that tool |
| The `AI Provider` heading | Becomes **Capability model access**, and says in one line that Conversations do not use it |
| Agent Tools registry | Moves to Machine Settings. Registering a tool is machine configuration; deciding which skills it receives is Skill Pool work |
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
├── This machine  ·  shared with every agent on this computer
│   ├── Agent tools        detected agents, sign-in state, skills directory, custom registrations
│   ├── Skills             count and a link to the Skill Pool, which stays the place to distribute
│   ├── MCP servers        reserved, empty, states what will live here
│   └── Conventions        reserved, empty
└── Nooki  ·  this app only
    ├── Capability model access   which agent serves Capability invocations
    ├── Appearance
    ├── Language
    └── Local data
```

Two group headings carry most of the correction. A person reading "This machine · shared with every
agent on this computer" cannot mistake a setting under it for a Nooki preference, and a person
reading "Capability model access" cannot mistake it for what Conversations use.

### Agent tools

One row per detected agent, rendered from the same `skill_pool_overview` data the Skill Pool already
produces, extended with sign-in state:

```
Codex          ~/.codex/skills          Signed in · ChatGPT subscription     Manage in Codex ↗
Claude Code    ~/.claude/skills         Signed in                            Manage in Claude Code ↗
pi             ~/.agents/skills         Reads the pool directly              —
```

Sign-in state is read, never entered. For Codex it comes from `auth.json` and, when the app-server is
already connected, from `account/read`. A tool that cannot report its state says so rather than
guessing. A tool that is not signed in shows the command that signs it in, and nothing else: the
sign-in happens in that tool.

Custom tool registration moves here from the Skill Pool page, because registering a tool is machine
configuration. The Skill Pool keeps the distribution matrix and links here.

### Capability model access

```
Which agent serves Capability invocations?

  ● Codex          Signed in · ChatGPT subscription
  ○ Claude Code    Signed in
  ○ pi             Not detected

  Conversations use the Codex CLI and its login session. This setting does not change them.
  Capability invocations spend the quota of the agent selected here.
```

Only detected, signed-in agents are selectable. With none available the section states that a
Capability cannot invoke a model until an agent is installed and signed in, and says which agents
Nooki can use. It offers no control that would fail.

The note about Conversations does not move and cannot be dismissed. It sits where the wrong
conclusion is currently drawn, not in a document no one opens.

## Migration

A person may have an endpoint configured and a key stored. Nothing is deleted underneath them.

1. On first run after the change, an endpoint that was configured is shown once, in Machine Settings,
   as a notice: the label, base URL, model, and protocol it held, and the sentence that Nooki no
   longer calls model services directly. The key is not displayed.
2. The notice names where to put it instead — the selected agent's own configuration — and records
   the constraint that decides whether that is even possible: Codex accepts only
   `wire_api = "responses"`. `chat` was removed in Codex 0.155 and Anthropic's Messages format was
   never accepted.
3. The stored file is left in place, unread, until the following release removes it. A person who
   needs the key back can still reach it in the meantime.
4. Dismissing the notice is remembered.

## Stages

| Stage | Content | State |
|---|---|---|
| 1 | Two groups, honest headings, the Conversation note, archives moved out | this version |
| 2 | Agent tools with sign-in state; Capability model access selects an agent; the model client, endpoint store, and `api.config.toml` reader are removed; migration notice | this version |
| 3 | MCP servers and conventions files become Shared Assets | later, separate spec |

## Project Structure

```
src/features/settings/SettingsPage.tsx        → the two groups and their sections
src/features/settings/MachineSettings.tsx     → agent tools, sign-in state, skills summary
src/features/settings/CapabilityModelAccess.tsx → the agent selector and its scope notes
src/features/settings/EndpointMigrationNotice.tsx → the one-time notice
src/features/settings/settings-sections.ts    → which section belongs to which group, as data
src/platform/agent-tools.ts                   → the detected-agent model shared by settings and skills
src/shared/i18n.ts                            → English and Simplified Chinese strings
src-tauri/src/agent_tools.rs                  → detection and sign-in state, promoted from skill_pool
src-tauri/src/lib.rs                          → `ai.invoke` served by an agent turn
tests/settings-sections.test.ts               → grouping and scope rules
tests/agent-tools.test.ts                     → selectable agents, sign-in shaping, empty machine
docs/spec-settings.md                         → this spec
docs/adr/0005-nooki-is-the-agent-substrate.md → the decision this follows
```

Removed: `src-tauri/src/compatible_provider.rs`, the invocation path in
`src-tauri/src/managed_provider.rs`, `load_codex_api_profile`,
`src/features/settings/CompatibleEndpointSettings.tsx`, and the `ProviderKind` enum.

## Commands

```
Build:            npm run build
Platform tests:   npm run test:platform
Rust tests:       cd src-tauri && cargo test -- --test-threads=1
Desktop dev:      npm run desktop:dev
```

## Testing Strategy

- `tests/settings-sections.test.ts` covers the rules as data, with no rendering: every section
  belongs to exactly one group, and the Conversation note is attached to the model selector rather
  than to a group.
- `tests/agent-tools.test.ts` covers selection with no agent detected, an agent detected but not
  signed in, and several signed in, with no filesystem access.
- Rust tests cover sign-in detection against a temporary `HOME`, including a machine with no agent,
  and `ai.invoke` returning a result through an agent turn.
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

1. Settings shows two groups, and every section sits in exactly one of them.
2. Codex appears once, with its sign-in method shown as detected, and cannot be configured in Nooki.
3. A person who selects an agent for Capability access sees, without scrolling or hovering, that
   Conversations do not use it.
4. A Capability that invoked a model before this change still invokes one after it, through the
   selected agent, with no key entered.
5. On a machine with no agent installed, Settings explains the situation and offers no control that
   fails; the Library, Skill Pool, and tasks are unaffected.
6. A previously configured endpoint produces exactly one migration notice, its file is not deleted,
   and its key is never displayed.
7. Nooki's source contains no HTTP client for a model service and no credential store.
8. `npm run build`, `npm run test:platform`, and `cargo test` pass.

## Open Questions

None blocking. Deferred by decision: whether a Capability may request a specific model, and whether
Capability invocations should report their cost, wait until the ledger exists to record them.
