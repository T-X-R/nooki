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

One row per agent, from the same detection the Skill Pool uses — promoted into `agent_tools.rs` so
both surfaces read one probe — extended with sign-in state:

```
Codex          READY      Signed in · ChatGPT              Skills directory  ~/.codex/skills
Claude Code    UNKNOWN    Sign-in is managed in that tool  Skills directory  ~/.claude/skills
pi             READY      Sign-in is managed in that tool  Skills directory  ~/.agents/skills
```

Sign-in state is read, never entered. For Codex it comes from `~/.codex/auth.json`. Claude Code and pi
keep credentials where Nooki cannot look, so they report `unknown`: a badge that guessed would be
wrong about half the time with no way for a person to tell which half they were in. A tool that is not
signed in shows the command that signs it in, and nothing else.

Detection reads files. It never runs an agent binary — opening Settings should not start four
processes, and a state a file already records needs no subprocess to confirm.

Custom tool registration stays on the Skill Pool page for now. Moving it is a separate change and
would not be improved by being rushed into this one.

### Capability model access

```
Which agent serves Capability invocations?

  ● Codex          Signed in · ChatGPT
  ○ Claude Code    Sign-in is managed in that tool, and Nooki does not look
  ○ pi             Sign-in is managed in that tool, and Nooki does not look

  Conversations use the Codex CLI and its login session. This setting does not change them.
  Capability invocations spend the quota of the agent selected here.

  [ Run one invocation ]
```

Detected agents are selectable, including those reporting `unknown`: refusing to try would be a guess
dressed as a fact. An agent that reports itself signed out is shown and cannot be chosen. With none
available the section says a Capability cannot reach a model until an agent is installed, and offers
no control that would fail.

There is no health check separate from the work. The only honest check is one real invocation, so the
single button runs one, on the chosen agent, spending the same quota a Capability would.

A choice a person made is kept even while it is broken, so Settings can explain the problem rather
than quietly substituting something else. Only a default nobody chose gives way to an agent that is
actually here.

The note about Conversations does not move and cannot be dismissed. It sits where the wrong
conclusion is currently drawn, not in a document no one opens.

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
| 1 | Two groups, honest headings, the Conversation note, archives moved out | this version |
| 2 | Agent tools with sign-in state; Capability model access selects an agent; the model client, endpoint store, and `api.config.toml` reader are removed; migration notice | this version |
| — | Custom tool registration moves from the Skill Pool page into Machine Settings | deferred, unrelated to model access |
| 3 | MCP servers and conventions files become Shared Assets | later, separate spec |

## Project Structure

```
src/features/settings/SettingsPage.tsx        → the two groups and one renderer per section
src/features/settings/settings-sections.ts    → which section belongs to which group, as data
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

- `tests/settings-sections.test.ts` covers the rules as data, with no rendering: every section
  belongs to exactly one group, and the Conversation note is attached to the model selector rather
  than to a group.
- `tests/agent-standing.test.ts` covers preview, an agent detected but not signed in, one that cannot
  report, one signed in, a choice that stopped working, and which agents are offered — with no
  filesystem access.
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
