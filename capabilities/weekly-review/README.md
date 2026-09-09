> Compatibility-only: Weekly Review is retired from the built-in installation catalog and navigation. Use platform Conversations for new work. This source remains to recover existing tasks; existing drafts, grants and published documents are retained.

# Weekly Review

An independent Capability that generates a cited review from explicitly authorized Library documents. It does not scan Capability storage, read all Library content, schedule work, or implement a separate task runner.

1. Install Weekly Review in Capability Center.
2. In Library, select this week's documents and authorize Weekly Review to read their snapshots.
3. Review the input list, confirm sending only those snapshots to the selected platform AI Provider, and select **Generate draft**.
4. Inspect the draft and follow its citations to the original snapshots.
5. Select **Confirm and publish to Library** to start the separate publication task.

Generation checkpoints source reads and validated AI output; the draft is retained as the task result. A failed or interrupted run resumes only after explicit retry. Publication takes the confirmed draft as durable task input and publishes with its stable ID; retrying publication never invokes AI. Updating the package requires a new grant and task, consistent with platform version fencing.

Build the independent package with `npm run capability:pack -- capabilities/weekly-review`. Requires Nooki 0.3 or newer. Package code accesses platform services only through CapabilityHost. AI output must be structured JSON with valid selected source IDs; malformed or fabricated citations fail generation and can be retried.
