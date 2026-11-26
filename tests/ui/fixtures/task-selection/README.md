# Task selection UI fixture

Run `npm run dev -- --host 127.0.0.1` and open `/tests/ui/fixtures/task-selection/`.
This imports the production picker, selection client, dialog and CSS with explicitly simulated native
services and synthetic task revisions. It does not install packages or prove native authorization.
Scenarios cover success/dismissal, empty/loading/error/reload, frozen confirmation retry, revoke
failure/retry, cancellation, and delayed issuance/cleanup with a temporarily disabled keyboard opener.
Switch language/theme and inspect narrow/wide layouts. The result area records confirmed task IDs
and revisions; retries must repeat them exactly. C04c3 owns independent archive/native acceptance.
