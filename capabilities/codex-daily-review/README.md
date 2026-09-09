# Codex Daily Review Capability

Codex Daily Review is an independent Capability Package. Only when the user selects **Scan and summarize** does it read Codex session files created on the current local date, extract top-level user tasks and their final Codex responses, and ask the Nooki-selected AI Provider for a concise daily review.

Session parsing, task extraction, prompt construction, and presentation are package-owned. Nooki only supplies the permission-checked `host.codex.sessions.readTodayFiles()` source adapter and the existing `host.ai.invoke` model interface. Child-agent sessions are ignored because they duplicate work already represented by their parent user session.

The package declares a daily-review job and uses the platform task runner for progress, cancellation, checkpoints and explicit retries. It persists the latest completed review for the current local date through Capability-scoped storage. It also submits each completed daily review through the Document Gateway under the stable `daily-reviews/<date>` identity. A manually started review continues across Nooki navigation. Completed results survive restart; unfinished runs become interrupted and require explicit retry. Publishing can be retried without regenerating a completed summary. Opening the Capability never starts a new scan or AI invocation.

The package requests:

- `codex.sessions.read`: read raw session JSONL files from today's active and archived Codex partitions.
- `ai.invoke`: send compact task evidence to the selected AI Provider.
- `storage`: retain today's generated review and its parsed source metadata across app restarts.

No historical date partition is scanned. Raw session files are not persisted by the Capability, and a saved review from an earlier local date is discarded instead of displayed.
