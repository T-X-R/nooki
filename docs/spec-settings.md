# Spec: Settings as the substrate's configuration surface

Status: draft, awaiting review.

Follows [ADR 0005](adr/0005-nooki-is-the-agent-substrate.md).

## Objective

Settings becomes the place where a person configures **this machine's shared agent setup**, clearly
separated from Nooki's own preferences. Along the way the page stops implying things that are not
true.

Today one page mixes three unrelated kinds of decision — what model Capabilities may call, what
colour the window is, and where the person's data lives — and puts the first of them under a heading,
`AI Provider`, broad enough to read as "the model Nooki uses". It is not. It governs Capability
`ai.invoke` and nothing else. Conversations run on Codex regardless of what is selected there, and a
person who configures Claude on that page and then opens a Conversation is silently talking to a
different vendor.

The vocabulary was never wrong. `CONTEXT.md` already defines the **Model Gateway** as "the single
model invocation interface exposed to Capabilities" and warns that "a Codex subscription session is
not a general-purpose AI Provider". The interface drifted from the language; this spec pulls it back.

### Not in scope for this version

- Changing how credentials are stored or how `managed_provider.rs` performs an invocation.
- Distributing anything new. MCP servers and conventions files are named here only so the structure
  does not need rearranging when they arrive.
- The session ledger, handoffs, or any change to Conversations.
- Removing the Compatible Endpoint. It is re-scoped and re-labelled, not deleted.

## Language

Terms added to `CONTEXT.md` when this spec is approved.

**Agent Substrate**: The shared layer Nooki maintains for the coding agents installed on this
machine — the assets they all read, the record of what they all did. Nooki is that layer and is not
one of the agents.

**Shared Asset**: A thing a person keeps once and every Agent Tool should see: a skill today; a model
endpoint, an MCP server, and a conventions file later. Every Shared Asset is authored in Nooki and
reaches a tool by the Skill Pool's distribution mechanism — a copy, a Mirror Receipt, and no silent
overwrite.

**Machine Settings**: The Settings group that configures the Agent Substrate. What is changed here
affects tools other than Nooki.

**Nooki Settings**: The Settings group that configures Nooki itself — appearance, language, and the
person's local data. Nothing here leaves Nooki.

**Model Endpoint**: A model service the person describes by hand with a base URL, a model, a request
protocol, and a credential reference. Previously called a Compatible Endpoint. Renaming it states
what changes: it is on its way to being a Shared Asset rather than a private setting, and the
credential is a reference, never a copied key.
_Avoid_: Compatible endpoint, custom model, third-party provider

## Decisions

| Question | Decision |
|---|---|
| What Settings is | The configuration surface of the Agent Substrate, plus Nooki's own preferences, in two groups that never mix |
| The `AI Provider` heading | Becomes **Capability model access**, and says in one line that Conversations do not use it |
| Where the truth about Conversations goes | Next to the model selector, where the wrong conclusion is currently drawn — not in a document no one opens |
| Compatible Endpoint | Renamed Model Endpoint, kept working, re-scoped as a future Shared Asset. Storage and invocation are untouched in this version |
| Agent Tools registry | Moves to Machine Settings. Registering a tool is machine configuration; deciding which skills it receives is Skill Pool work |
| Future assets | MCP servers and conventions files get their place in Machine Settings now, empty, so the structure is decided once |
| Conversation archives | Leaves Settings. Archived conversations are Conversation data and belong on that page |
| Staging | Four stages, each independently shippable. This version is Stage 1 and Stage 2 |

### Why not simply delete the Compatible Endpoint

It works, a person has configured one, and `ai.invoke` needs some path to a model. The problem is not
that it exists; it is that it is scoped as a private Nooki setting and named as if it governed
everything. A model endpoint the person describes once and every tool on the machine can use is a
genuine Shared Asset — the same shape as a skill. Deleting it would throw away the definition that
is already correct in order to fix a label and a boundary.

## Structure

```
Settings
├── This machine  ·  shared with every agent on this computer
│   ├── Agent tools        detected tools, their skills directory, and custom registrations
│   ├── Skills             count and a link to the Skill Pool; the pool stays the place to distribute
│   ├── Model endpoints    the endpoints the person described, and where each may be used
│   ├── MCP servers        reserved, empty, states what will live here
│   └── Conventions        reserved, empty
└── Nooki  ·  this app only
    ├── Capability model access   how Capabilities reach a model; states that Conversations do not
    ├── Appearance
    ├── Language
    └── Local data
```

Two group headings carry the whole correction. A person reading "This machine · shared with every
agent on this computer" cannot mistake a setting under it for a Nooki preference, and a person
reading "Capability model access" cannot mistake it for what Conversations use.

### Capability model access

The three options keep their behaviour and gain honest descriptions:

| Option | Description |
|---|---|
| Managed API key | Reads the model, endpoint, and credential source from `~/.codex/api.config.toml` |
| Codex subscription | Runs a single `codex exec` through the local Codex CLI and its login session |
| Model endpoint | Calls an endpoint from **This machine → Model endpoints** with your own key |

Below them, one line that does not move and cannot be dismissed:

> Conversations use the Codex CLI and its login session. This setting does not change them.

### Model endpoints

The existing editor moves under Machine Settings unchanged: label, base URL, model, request protocol,
credential. Each endpoint gains a read-only **Used by** line stating where it is available today —
`Capabilities` for every endpoint — which is the slot Stage 3 fills with the tools it reaches.

An endpoint whose protocol is `responses` additionally shows that it is a candidate to become a
Codex model provider, because that is the only wire protocol Codex accepts; `chat` was removed in
Codex 0.155 and Anthropic's Messages format was never accepted. Stating the constraint next to the
field is what stops a person configuring an endpoint that can never be distributed and wondering why.

### Agent tools

The tool registry — detected tools, their skills directory, and the custom tools a person added —
renders in Machine Settings from the same `skill_pool_overview` data it renders from today. The
Skill Pool page keeps the distribution matrix and links to Settings for registration. No Rust change:
one command feeds two surfaces.

## Stages

| Stage | Content | State |
|---|---|---|
| 1 | Two groups, honest headings, the Conversation note, Model Endpoint renamed, archives moved out | this version |
| 2 | Agent tools registry rendered in Machine Settings | this version |
| 3 | A Model Endpoint becomes a distributed Shared Asset: written into a tool's configuration through a Mirror Receipt, credential by reference only | later, separate spec |
| 4 | MCP servers and conventions files become Shared Assets | later, separate spec |

Stage 3 is where the credential rule bites: Nooki writes `env_key` or a keychain reference into
another tool's configuration and never a key. That is worth its own spec and its own review.

## Project Structure

```
src/features/settings/SettingsPage.tsx          → the two groups and their sections
src/features/settings/MachineSettings.tsx       → agent tools, skills summary, model endpoints
src/features/settings/CompatibleEndpointSettings.tsx → the endpoint editor, re-labelled
src/features/settings/provider-labels.ts        → option labels and scope descriptions
src/features/settings/settings-sections.ts      → which section belongs to which group, as data
src/shared/i18n.ts                              → English and Simplified Chinese strings
tests/settings-sections.test.ts                 → grouping and scope rules
docs/spec-settings.md                           → this spec
docs/adr/0005-nooki-is-the-agent-substrate.md   → the decision this follows
```

No Rust change in Stages 1 and 2. `compatible_provider.rs` and `managed_provider.rs` are untouched.

## Commands

```
Build:            npm run build
Platform tests:   npm run test:platform
Desktop dev:      npm run desktop:dev
```

## Testing Strategy

- `tests/settings-sections.test.ts` covers the rules as data, with no rendering: every section
  belongs to exactly one group, no Machine section is reachable in browser preview, and the
  Capability scope note is attached to the model selector rather than to a group.
- The existing provider tests keep passing unchanged, which is the evidence that Stages 1 and 2
  changed presentation and not behaviour.
- Manual check in the desktop build: with a Model Endpoint selected, a Capability invocation uses it
  and a Conversation still starts on Codex.

## Boundaries

- Always: state which tools a setting affects, in the group heading and again where a person could
  draw the wrong conclusion.
- Ask first: nothing in this version writes outside Nooki's data directory. When Stage 3 does, it
  follows the Skill Pool's rules — staged write, Mirror Receipt, no silent overwrite.
- Never: write a credential into another tool's configuration; imply that one model selection
  governs both Capabilities and Conversations; move a person's configured endpoint without keeping
  it working.

## Success Criteria

1. Settings shows two groups, and every section sits in exactly one of them.
2. A person who selects a Model Endpoint sees, without scrolling or hovering, that Conversations do
   not use it.
3. An endpoint configured before this change still works for Capability invocations afterwards, with
   no re-entry of its key.
4. The agent tools detected on the machine are listed in Settings, and a custom tool registered there
   appears in the Skill Pool.
5. An endpoint whose protocol is not `responses` is marked as unavailable for distribution, with the
   reason.
6. Archived conversations are reachable from Conversations, not from Settings.
7. `npm run build` and `npm run test:platform` pass.

## Open Questions

None blocking. Deferred by decision: whether Capability model access should eventually be served by a
Model Endpoint only — dropping the two Codex-specific options — is left until Stage 3 shows what
distribution actually costs.
