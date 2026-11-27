# C06c2 checkpoint: Deliver the exact approved input to native admission

Date: 2026-11-27. Follow-up to `39319e6`, on the existing feature branch and PR #38.

## Change and boundary

The Host now exports `NativeLaunchInput` from its existing approved/pending run journal under the
same installation, restore and data fences. It contains the binding plus the exact serialized
input whose bytes produce the retained input digest: domain, instructions, complete selected
snapshots, output schema and Agent identity. Exporting it does not recapture current Library data,
change the journal, claim another submission or expose a renderer/SDK endpoint. The transport
object deliberately has no `Debug` derivation because it contains source bodies.

The disposable native component validates these exact UTF-8 bytes before configuration startup.
It retains the approved text/schema in memory and checks the actual first `turn/start` input and
output schema before recording the one-time claim. Only the exact single text input containing
the approved JSON is admitted; changed/missing/extra content is refused. Non-null optional turn
parameters are refused, including additional context and model overrides, so another request field
cannot introduce unapproved input or replace the selected configuration. Null/omitted optional
fields retain the native session defaults. This private transport representation does not define
the public package API, document UX, or the final scoped-file materialization format.

A definitive input/parameter mismatch leaves submission unclaimed. The same native process can
then accept the correct approved input exactly once. Repeating that identical input live or after
restart remains an unknown prior submission, rather than a second model request.

Using a real Host-generated fixture found a previous interoperability bug: `InvocationContext`
serializes nested installation fields as `capability_id` and `capability_version`, while the earlier
hand-written native probe used camelCase. The component now follows the existing Host wire format;
no stored Host schema is migrated. The new process controls use exports made by the actual Rust
journal tests, including Unicode, quotes and newlines, rather than independently recreating a
matching-looking binding.

## Verification

The initial Host test fails because `native_launch_input` does not exist. After implementation,
all 25 top-level ledger tests plus four child-process executions pass. The
new tests check exact serialization/hash, retained body/schema/Agent content, durable replay without
another claim, preclaim refusal, installation authority, revocation and imported-history refusal.
The fixture exporter can retain a 1.1 MB synthetic source without truncation.

A real process control against the previous bound-run binary accepts changed text and sends it to
the loopback fixture. Final input controls compare the old and new binaries:

| Case | Previous component | New component |
| --- | --- | --- |
| Exact Host input/schema | One completed local turn | One completed local turn; exact text and schema observed in the native Responses request |
| Changed text or retained source body | Accepted; request sent | Refused before request; approved retry succeeds |
| Extra text or omitted input | Accepted; request sent | Refused before request; approved retry succeeds |
| Changed output schema | Accepted; request sent | Refused before request; approved retry succeeds |
| Model override or additional context | Accepted; request sent | Refused before request; approved retry succeeds |
| Changed launch bytes with unchanged digest | Old launch protocol has no input bytes | New startup refuses the hash mismatch |
| Approved 1.1 MB source | Not claimed tested on old component | Explicit native input-limit refusal; zero requests and submission remains unclaimed |

The previous component requires its historical camelCase installation shape and has no `inputJson`
launch field. The control's explicit `--legacy-launch` option performs only that wire adaptation;
it does not change input content/digest or disable an old runtime check. This is a behavioral control,
not a byte-identical launch-protocol compatibility claim. The final old controls complete eight
synthetic turns and have zero fixture errors. The omitted-input fixture intentionally permits a
marker-free request only in that named isolated test, so acceptance of an empty turn is observable.

## Integration limits

This closes the tested text-input substitution path; C06c2 and C06c remain open. The exporter is
called by a test-created Host journal, not yet by the production native launcher. Actual policy
materialization/verification, Host/native turn reconciliation, write/crash faults, authentication,
approval/question/cancellation and component distribution still need qualification. No real model
is used, and no experimental component is bundled with Nooki or replaces the ordinary CLI.

Codex limits one turn's text input to 1,048,576 characters. The experiment preserves that limit and
checks it before claiming submission; it never truncates approved snapshots. The Host's existing
8 MB selected-document contract is unchanged. A scoped-file materialization path is still required
for the full document size range before product integration; a passing small text fixture does
not complete that acceptance. Request-schema delivery also does not prove final structured output
validation or artifact retention. The earlier startup/hooks/Skills policy probes still require
adaptation to the bound launch path; this checkpoint does not silently inherit their certification.

## Final receipts and delivery

The final candidate completes ten synthetic turns: eight in input checks and two in the original
binding/restart regression. It has 31 explicit refusals across those runs, zero mismatches and zero
fixture errors. The previous component completes eight control turns. Real model calls are zero.
The binding regression uses the identical approved input/schema for both duplicate attempts, so
input mismatch cannot mask a missing one-time claim. It also retains both pre-first-turn and
post-turn process recovery, changed semantic-scope refusal and transient-helper-path checks.

| Artifact | SHA-256 / receipt |
| --- | --- |
| Candidate component | `d0e1f0be629da2eaafd780202f0e7c6285900cc8f81dc88e47a2b19e25596adf` |
| Previous bound-run control | `410451f96663c283a34df8d0027e0fc102219d2dc36f966dc3b1dc8e213012a6` |
| Updated probe | `9273cc51861b3e3e8d3b87d661e42dd286be6a76ba8ff0a56d32f9c528de5a8f` |
| Complete eleven-file patch | `37451fdec8b60bcd47721b017639fd8553a43f22592646cf958099394b615508` |
| Exact-input candidate | `/private/tmp/nooki-profile-qe1ECp/native-binding-probe.json` |
| Large-source candidate | `/private/tmp/nooki-profile-S1yryY/native-binding-probe.json` |
| Final binding/restart regression | `/private/tmp/nooki-profile-GnINpM/native-binding-probe.json` |
| Exact-input control | `/private/tmp/nooki-profile-075AG3/native-binding-probe.json` |

The aggregate `/tmp/nooki-c06c-native-prototype/input-matched-result-20261127.json` records every
case receipt and artifact identity. The [complete patch](C06c-native-approved-input.patch) replays
exactly using `patch -p1` or `git apply --unidiff-zero` against the same pinned, normalized source
and compiler/V8 inputs as the [binding checkpoint](C06c-native-run-binding.md). The final build
retains SHA-256 dependency optimization and completes in 1m 49s. Existing native linker/helper
advisories remain. No platform support beyond this macOS qualification is claimed.

Preliminary failures remain available and are not counted as passing: the real Host installation
wire mismatch (`input-valid.log`), the initial omitted-input fixture rejecting its own deliberate
marker-free control, and the binding fixture accidentally replacing the Host's `a*64` installation
generation with the same value. The latter now uses a different value and asserts every binding
mutation actually differs. Candidate logs and the prior failed binding receipts remain under the
same temporary directory; the final corrected run is the receipt listed above.

Host regression passes 314 top-level native tests plus five child executions, with two existing
live-Agent tests ignored; 203 platform and five capability JavaScript tests pass. Logs:
`/tmp/nooki-c06c-input-native-all.log`, `/tmp/nooki-c06c-input-host-{red,green}.log`, and
`/tmp/nooki-c06c-input-js.log`. The actual Host fixture exports also pass with both component hashes
and the 1.1 MB body. This is an internal Host change; contract 0.12.0 and kit 0.11.0 remain unchanged,
while app and kit platform metadata advance to 0.12.3.

Desktop build (native release: 41.38s), normal reinstall/task-worker handoff and strict deep signing
pass. Installed Nooki 0.12.3 executable SHA-256:
`0f0c1faf4c9a3653d06a098cf4f49f7f01a668cf0505db4484ba517305ea6ac4`.
Logs: `/tmp/nooki-c06c-input-desktop-{build,install}.log`. Existing frontend chunk-size advisories
remain. The native experimental executable is kept separately and no new UI acceptance is claimed.

Probe syntax, all 135 local file links in the changed documents, exact patch replay and diff checks
pass. No native fixture process remains running after the final checks.
