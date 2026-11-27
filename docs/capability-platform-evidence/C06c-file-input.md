# C06c2 checkpoint: Complete approved-source files and native read-only execution

Date: 2026-11-27. Follow-up to `72d7210`, on the existing feature branch and PR #38.

**An actual Host-approved 8,000,000-byte source now reaches a private native input file without
truncation and is read by a real sandboxed Codex tool.** This completes this file-input checkpoint;
production launch, complete policy binding and native outcome reconciliation remain open under C06c2.
No real model is called and no experimental Codex executable is installed into Nooki or the ordinary CLI.

## Host budget correction

The new boundary test first fails on the unchanged Host: instructions count toward its aggregate
8 MB input budget, so an empty journal cannot retain an exactly 8 MB selected document. The journal
now separately enforces at most 8,000,000 source bytes per run and reserves up to 80,000 additional
aggregate bytes for one maximum 20,000-character UTF-8 instruction. The 256-run and 12 MB serialized
journal limits remain. A source of 8,000,001 bytes is refused before journal creation. This is a
bounded quota correction; it does not remove aggregate capacity or encoded-size limits.

The regression retains exactly 8,000,000 source bytes, including Unicode, newline and an end marker.
It exports through the actual approved/pending Host journal, not a probe-written imitation. The
native input serialization is 8,000,367 bytes including metadata; every byte is retained.
The original selected Library content is not reread or recaptured during native materialization.

## Native materialization and permission checks

The [complete experimental patch](C06c-native-file-input.patch) retains prior policy, binding and
input checks. After private launch/hash/provenance admission and before configuration loading,
the native owner creates `CODEX_HOME/nooki-approved-input/approved.json` with mode 0400 inside a
new mode-0700 directory. Its content is the exact Host serialization matching `inputDigest`.
The file and relevant directories are synchronized. Fresh admission never overwrites an existing
input directory; partial preparation remains visibly uncertain and requires future reconciliation.

Recovery verifies the existing file rather than recreating it. Initialization, session admission
and first-turn admission check the exact bytes, length, regular-file type, mode, link count and
non-symlink parent. Input files are opened with `O_NONBLOCK | O_NOFOLLOW` before type validation,
so a substituted FIFO is refused rather than waiting for a writer. Missing, changed, symlinked,
hard-linked or nonregular materialization is refused. Source
IDs/titles never become filesystem paths. This is a derived execution copy of the existing Host
snapshot, not another approval store.

Session admission additionally asks the actual resolved native filesystem policy whether this
file can be read and whether the file, its directory or the native home can be written. Unreadable
or writable input scope is refused before thread admission. The fixture uses the previously audited
C06a named profile, granting the exact input file read access and a separate output directory write
access, with private/user/volume exclusions and no subprocess network access.

The model receives the original instruction plus a deterministic short file reference and approved
SHA-256, not an oversized inline copy. The native owner validates this exact first-turn text and the
approved output schema before claiming submission. The standard native text limit is unchanged.
File contents can be read in bounded tool operations as needed; this test proves byte availability
and access controls, not that a real model semantically processes all 8 MB in one context window.

## Native process and tool evidence

The [probe](../../scripts/probe-capability-agent-native-run-binding.mjs) accepts the Host export via
`NOOKI_NATIVE_INPUT_FIXTURE` and selects the new client wire representation with `--file-input`.
The component itself has no switch to disable file binding. `--file-case=tool` causes the static
localhost Responses fixture to request the advertised native `exec_command` tool. Codex owns tool
execution, sandboxing and the subsequent Responses request; the probe introduces no model runner.

The actual tool result must report exit code zero, the exact SHA-256 and 8,000,367-byte length, and
a completion marker. Assertions inspect the `function_call_output` for the exact call ID, so text
inside the prompt or requested command cannot masquerade as a tool result. The tool additionally:

- Fails to chmod, overwrite or delete the approved input.
- Fails to write a sibling in the input directory, create an input hard link in the output directory,
  or move the input directory into the writable output directory.
- Fails to read an existing unrelated synthetic file.
- Successfully writes a synthetic result in the designated output directory.

| Case | Final result |
| --- | --- |
| Exact full-size materialization and ordinary turn | Complete bytes retained; short approved prompt and schema delivered |
| Native shell tool read and mutation controls | Exact file digest/length returned; all input/foreign mutations denied; output write succeeds |
| Restart before first turn | Same native thread resumes and completes with the unchanged file |
| Unreadable / writable input policy | Explicit native policy refusal; no model request |
| Same-length content change / missing file, file symlink, hard link, directory symlink / FIFO | Submission and cold recovery both refused; submission remains unclaimed |
| First-turn text/path/schema/context/override substitutions | Refused; original approved input can then be submitted once |
| Existing bound-run regression | 22 refusals and two successful cold-recovery turns, including identical-input duplicate refusal |

The final set has **44 explicit refusals, 12 completed synthetic turns and 13 local Responses
requests**, with no mismatches or fixture errors. One tool turn requires two Responses exchanges.
Real model calls are zero. Source data remains unchanged after native tool execution.

The initial tool fixture used `shasum`, whose Perl library is outside the allowed runtime roots;
it exited 134. That is retained as a failed setup, not passing file-read evidence. The final fixture
uses system OpenSSL with `OPENSSL_CONF=/dev/null`, preserving the same sandbox profile. The old
inline-only component cannot materialize the input file, reproducing the missing feature before
implementation. The initial Host quota test also fails before the budget correction. A later review reproduces
a FIFO replacement hanging both `turn/start` and recovery initialization; the final nonblocking
open fixes that case. The bounded probe terminates only its own child processes when a regression
hangs. The failed control remains in `files-fifo-red.log` and
`/private/tmp/nooki-profile-9kfQUD/native-binding-probe.json`.

## Identities and receipts

| Artifact | SHA-256 / local receipt |
| --- | --- |
| Native candidate | `6d87d83c7b8a80d32cb014e5de680e86d7df961f1233d328574d4020082883ca` |
| Complete eleven-file patch | `446332c3a600ac3562338313b517963a211ae58ded019cd852c3b77217b102e7` |
| Updated probe | `897589f38d0599ead495f923660c340029b420c23e24d71a4c5689171a8f61ea` |
| Full materialization | `/private/tmp/nooki-profile-WYEgqQ/native-binding-probe.json` |
| Final native tool and alias controls | `/private/tmp/nooki-profile-pGoYcz/native-binding-probe.json` |
| Pre-turn recovery | `/private/tmp/nooki-profile-tPuuja/native-binding-probe.json` |
| Bound-run regression | `/private/tmp/nooki-profile-sTOt9C/native-binding-probe.json` |
| FIFO refusal before submission and recovery | `/private/tmp/nooki-profile-9xY2fX/native-binding-probe.json` |
| Same-length content tampering | `/private/tmp/nooki-profile-Y7iUzQ/native-binding-probe.json` |
| Failed Perl-based tool fixture | `/private/tmp/nooki-profile-tnpPk0/native-binding-probe.json` |

`/tmp/nooki-c06c-native-prototype/files-result-20261127.json` contains every file/input/regression
receipt and identity. `files-host-full-final.json` is the synthetic export from the real Host test.
The complete zero-context patch replays exactly with `patch -p1` or `git apply --unidiff-zero`
against the same pinned official 0.170.0 source and normalized lock baseline as the
[previous checkpoint](C06c-approved-input.md). Compiler, V8 inputs and SHA-256 dependency build
optimization are unchanged. Native build completes in 1m 57s; existing helper/linker advisories remain.

## Remaining integration and delivery

The trusted production launcher must still choose and own one native state scope for each claimed
Host run, resolve/verify the complete approved policy and reconcile native thread/turn outcomes.
A private launch envelope can be copied by a trusted test harness into multiple isolated test homes;
this is not proof of global replay protection without the actual Host owner. This checkpoint does
not certify every native startup/managed/remote effect path or hostile same-user external mutation.
Crash/write-fault reconciliation, authentication, approvals/questions/cancellation, native component
distribution and public Agent/installed acceptance remain open. The broader startup/hooks/Skills
regression harnesses still need the bound-launch setup. C06c2 and C06c are not marked complete.

Full Host regression passes 315 top-level native tests plus five child executions, with two existing
real-Agent tests ignored; 203 platform and five capability JavaScript tests pass. Focused ledger
coverage is 26 top-level tests plus four child executions. Logs are
`/tmp/nooki-c06c-files-host-{red,green}.log`, `/tmp/nooki-c06c-files-native-all.log` and
`/tmp/nooki-c06c-files-js.log`. The actual full-size Host export passes separately.

App and kit platform metadata advance to 0.12.4; public contract 0.12.0 and kit 0.11.0 are unchanged.
Desktop build (native release: 36.31s), reinstall/task-worker handoff and strict deep signing pass.
Installed executable SHA-256:
`bac705ecb1344b9c8a497d20e4bb66a16fd899dd8eaf6769f7b4042c505cd8f2`.
Logs: `/tmp/nooki-c06c-files-desktop-{build,install}.log`. Existing frontend chunk-size advisories
remain. The current npm audit reports four advisories (three high, one moderate: Vite, nanoid,
source-map-js and fast-uri); dependency versions are unchanged by this slice, and these are not
claimed resolved. Details: `/tmp/nooki-c06c-files-npm-audit.json`.

Probe syntax, all 138 local file links in the changed documents, exact patch replay and diff checks
pass. No native fixture process remains running after verification.
