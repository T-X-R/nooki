# Capability Codex component

This is the pinned native source integration for Nooki capability Agent runs. It extends Codex's
configuration/admission boundary; Codex still owns authentication, models, tools, sessions and
cancellation. It neither replaces the user's Codex CLI nor adds another model runner.

**Status: development integration.** The application does not enable or bundle this component yet.
Lifecycle stop propagation, runtime questions, authentication acceptance and component distribution
remain in the active toolbox delivery. The remaining broad compatibility matrix is final acceptance
work; incompatible managed configuration is refused, never ignored.

`source.json` pins the upstream archive/revision, the complete source patch and each changed file.
`nooki.patch` applies directly to that archive, including its original Cargo.lock. It incorporates the
previous native input/control-plane work and protocol revision 2 policy binding. Historical protocol 1
receipts remain in the evidence directory; they are not authority to launch this component.

## Policy and authority

The Host supplies the exact approved input and policy JSON through inherited descriptor 3. The
component verifies its own binary digest and both approved digests. The policy includes the complete
Host configuration template and component identity. Run-local paths are derived independently from
its private home. Expected configuration merges that template with the pinned component's embedded
defaults; later machine, project or RPC configuration cannot add authority.

The native bootstrap and common configuration loader compare effective configuration before use,
including session reloads. Resolved model/provider, approval policy and semantic filesystem/network
permissions must also match. This fixed local profile rejects managed requirements rather than
silently overriding them. Thread start/resume reject instruction, environment, history and other
unapproved overrides before dispatch. Existing source-file, one-time turn claim and retained native
provenance checks continue to apply.

The Host serializes the final authority check and bounded native submission with the same fences as
installation changes, document revocation and restore. An uncertain acknowledgement keeps its
submission claim. Cancellation before a claim is atomic; after a claim, only native observation can
confirm a terminal result. Complete lifecycle cancellation propagation remains pending.

## Build and focused validation

Extract the pinned archive, verify `sourceArchiveSha256`, and apply the patch from the extracted root:

```sh
git apply /absolute/path/to/nooki/native/codex/nooki.patch
cd codex-rs
cargo build -p codex-app-server --bin codex-app-server --locked \
  --config 'profile.dev.package.sha2.opt-level=3'
```

Use the upstream pinned Rust toolchain and platform prerequisites. The local development build uses
Rust 1.98.0, an external Cargo cache/target directory, four build jobs and no dev debug symbols. Its V8
archive/bindings are supplied through the upstream `RUSTY_V8_ARCHIVE` and
`RUSTY_V8_SRC_BINDING_PATH` build variables. No compiled binary or dependency cache is committed.
A distribution build must pin its own actual binary digest; rebuilding is not assumed bit-identical.

The Nooki integration tests take that actual binary through `NOOKI_CAPABILITY_NATIVE_BIN`, compute
its identity, approve synthetic input and use a local Responses fixture. They never enable the
component in the installed application or make authenticated model calls:

```sh
NOOKI_CAPABILITY_NATIVE_BIN=/absolute/path/to/codex-app-server \
  cargo test --manifest-path src-tauri/Cargo.toml --offline --lib capability_ -- --ignored
```

The task checklist records current results and remaining work. The patch replay check establishes
source identity, not complete platform, containment, authentication or installed acceptance.
