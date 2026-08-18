# Command reference

All commands accept `--json` for the stable result envelope. Project commands
also accept `--root PATH` where shown by `kratos help`.

| Command | Purpose | Mutates state |
| --- | --- | --- |
| `help`, `version`, `handshake` | Usage and contract orientation | No |
| `adapters` | Report supported host package manifests | No |
| `init` | Create or reconcile managed project surfaces | Yes |
| `objective TEXT` | Record or replace the active objective | Yes |
| `start` | Start or idempotently resume a run | Yes |
| `continue` | Resume, reject, or complete one phase | Conditional |
| `approve GATE` | Record digest-bound approval or rejection | Yes |
| `evidence record ID REF` | Register classified, digest-bound evidence | Yes |
| `agent record REF` | Extract, validate, and record one agent reply | Yes |
| `gaps record REF` | Receive proposed gaps and derive the gate facts | Yes |
| `gaps resolve ID` | Record the owner's verdict on one gap | Yes |
| `gaps waive ID` | Record proceeding over a gap nobody answered | Yes |
| `gates record` | Record measured stop-loss and partition facts | Yes |
| `done` | Request accepted final completion | Conditional |
| `status`, `stats`, `budgets` | Derive active-run views | No |
| `doctor`, `explain CODE` | Diagnose state and explain recovery | No |
| `handoff` | Derive a phase handoff | No |
| `hook` | Accept one versioned host operation from standard input | Conditional |
| `migrate brain` | Preview or authorize a legacy migration | Conditional |
| `migrate rollback ID` | Restore files from a verified migration receipt | Yes |
| `audit` | Replay and compare materialized state | No |
| `repair` | Preview or explicitly authorize a safe repair | Conditional |
| `evidence bundle` | Write a privacy-reviewed evidence bundle | Yes |
| `dashboard` | Write a script-free local dashboard | Yes |

Unknown commands, missing flags, invalid transitions, stale revisions, and
failed gates return a stable nonzero exit code and a recovery description.
Never automate by scraping human output; use `--json`.
