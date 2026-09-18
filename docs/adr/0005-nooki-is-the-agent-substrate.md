# ADR 0005: Nooki is the shared substrate for the agents on this machine

- Status: accepted
- Date: 2026-09-18

## Context

Nooki started as a host for installed capabilities. It then grew three things that pull in three
different directions.

The **Skill Pool** treats the coding agents on the machine as peers to be supplied. It owns one copy
of each skill and distributes it to Codex, Claude Code, and anything else the person registers.

The **Conversation** treats one of those agents — Codex — as Nooki's own engine. It speaks the Codex
app-server protocol directly and depends on that protocol staying still.

The **Compatible Endpoint** treats Nooki as a model client in its own right. It keeps a private list
of endpoints, stores API keys on disk, builds its own HTTP stack, and translates three vendor wire
formats by hand.

Only the first of those describes a product no one else is building.

A person running this machine already has Codex, Claude Code, pi, workbuddy, Cursor, and more
arriving each quarter. Every one of them is a complete agent: its own loop, its own sandbox, its own
approval model, its own session store, its own skills directory, its own MCP configuration, its own
conventions file. Every one of them is also blind to the others. They duplicate the person's skills,
duplicate their tool configuration, and scatter the record of what was actually done across four
incompatible log formats.

The missing product is not a sixth agent. It is the layer that makes the five they already have
behave like one coherent workspace.

## Decision

**Nooki is the shared substrate for the agents installed on this machine. It owns what they share
and never owns what they do.**

Four commitments follow.

**Nooki manages shared assets and distributes them.** A skill, an MCP server definition, a
conventions file, a model endpoint definition — each is authored once in Nooki and mirrored into
every tool that can read it. The Skill Pool already proves the mechanism: one pool directory, a
Mirror Receipt per target, copies rather than links, nothing overwritten without a decision. Every
further asset reuses that mechanism rather than inventing a second one.

**Nooki reads sessions; it does not run them.** Each agent keeps its own history in its own format.
Nooki parses those stores read-only to build one timeline across all of them. A reader is not a
protocol adapter: it holds no state, drives no execution, and degrades to showing less when a format
changes. Nooki never becomes the thing that has to keep up with five vendors' protocols.

**Nooki owns the ledger.** What was approved, which skills were used, what was produced, what it
cost — these facts are cross-tool and belong to no single vendor. The agents each see a fraction;
only Nooki can see the whole. The ledger is Nooki's data, and the verbatim transcript stays with the
tool that produced it.

**Nooki keeps exactly one execution surface of its own.** The Conversation exists because work on
Library documents has no home inside a code-native agent. It is the document-native agent, not the
unified entry point for agents. It stays a single, deep integration, and it is the only place Nooki
speaks an agent's protocol.

And three refusals. Nooki does not implement an agent loop, does not implement a model client, and
does not implement a sandbox. Every one of those is maintained by a vendor spending more on it each
quarter than this project will in its lifetime.

### Nooki lists agents, not authentication modes

A corollary worth stating separately, because Nooki got it wrong twice.

Whether Codex is signed in with a ChatGPT subscription or an API key is recorded in
`~/.codex/auth.json` and reported by the app-server through `account/read`. Which models it may use
comes from `model/list`. What quota remains comes from `account/rateLimits/read`. Every one of those
facts belongs to the tool, is maintained by the tool, and is already correct in the tool.

So Nooki offers **one entry per installed agent**, never one entry per way of authenticating it.
Sign-in state, credentials, and model choice are detected and displayed read-only; a person who is
not signed in is sent to that tool to sign in. Nooki reads no credential and stores none.

The Agent Tool the Skill Pool already detects is that entry. One detection, reused everywhere: skill
distribution, Capability model access, and later the session ledger and asset distribution.

### The test

Before any feature enters Nooki, three questions:

1. **Is it shared between agents?** If it belongs to one tool, it belongs in that tool.
2. **Does something already do it better?** If so, Nooki distributes or indexes it; Nooki does not
   rebuild it.
3. **Can Nooki do it by reading files and writing configuration?** If it instead requires tracking
   someone else's protocol, loop, or sandbox, the answer is no until that changes.

| Belongs in Nooki | Does not |
|---|---|
| One pool of skills, distributed | A better skill runtime |
| One MCP configuration, distributed | An MCP client |
| One timeline across every agent's sessions | A session synchroniser |
| The record of approvals, skill use, and artifacts | The verbatim transcript |
| Handing work from one agent to the next | Migrating a model's context |
| Documents, and an agent that is native to them | A general-purpose agent |
| One entry per installed agent | One entry per way of signing into one |

## Consequences

**Nooki stops making model requests.** The Compatible Endpoint gave Nooki a private credential store,
an HTTP stack, and hand-written knowledge of three vendor wire formats — around 1,375 lines
duplicating what every installed agent already ships, and unable to keep up: no streaming, no tools,
no second turn. It is removed, along with the endpoint list, the credential store, and the reader for
`~/.codex/api.config.toml`.

Capability `ai.invoke` is instead served by a one-shot turn on an installed agent. That is not a
reduction: it inherits streaming, retries, vendor quirks, and structured output through the
agent's own `outputSchema`, none of which Nooki would have written. The **Model Gateway** stays
exactly as `CONTEXT.md` defines it, so no Capability changes; only what sits behind it changes.

**Nooki keeps no credentials at all.** `AI Provider` and `Credential Broker` cease to be concepts.
An architecture change that removes concepts rather than adding them is the signal that the boundary
was drawn in the right place.

**Model endpoints are not a shared asset.** Of the four candidates, model configuration is the worst:
its payload is a secret, the per-tool schemas differ most, and a person changes it once a year. It
stays where each vendor maintains it and where the person already sets it. MCP servers and
conventions files prove the distribution machinery first, on payloads that are not keys.

**A machine with no agent installed has no AI in Nooki.** This is the cost of the decision and it is
accepted deliberately rather than worked around. Nooki is the layer above the agents; with none
beneath it, documents, skills, and tasks still work and nothing pretends otherwise. The interface
says so plainly instead of offering a control that cannot succeed.

**Capability invocations spend the person's agent quota.** Previously they spent an API key the
person had entered for that purpose. A Capability says which agent it is about to spend before it
spends it.

**Settings becomes the configuration surface of the substrate**, not a preferences panel. The
machine's shared configuration and Nooki's own preferences are different things and stop sharing a
page.

**Supporting a new agent costs a session reader and a distribution target**, not a runtime adapter.
That is the difference between a weekend and a quarter, and it is why this decision is worth making
before the second agent arrives rather than after.

**Nooki writes outside its own data directory**, as the Skill Pool already established. That
responsibility now extends to every distributed asset, and the Mirror Receipt discipline extends
with it: Nooki touches only what it wrote.

**Secrets are never written into another tool's configuration.** A distributed endpoint definition
carries a reference — an environment variable or a keychain entry — and never a key.

**The Conversation's dependence on an experimental protocol is accepted and contained.** It is one
integration, in one module, for one tool, with a stated reason. It is not a template for the others.

## Not decided here

- The session ledger's schema and the reader for each tool's format.
- The handoff format that carries work from one agent to the next.
- How MCP servers and conventions files are modelled as distributed assets.
- Whether the Conversation gains an approval surface and per-session skill loadouts. That work is
  compatible with this decision but is specified separately.
- Whether a Capability may request a specific model rather than accepting the agent's default. The
  agent reports its models through `model/list`, so the option exists; the need does not yet.
- Windows. Paths and detection target macOS first, as in ADR 0004.

See [the Settings spec](../spec-settings.md) for the first change this decision forces, and
[ADR 0004](0004-platform-owned-skill-pool.md) for the distribution mechanism every shared asset
reuses.
