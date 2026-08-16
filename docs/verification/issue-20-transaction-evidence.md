# Issue 20 Transaction Verification Evidence

## Result

Issue [#20](https://github.com/thiagocorreanet/kratos-harness/issues/20)
(`RUN-05`) is verified as the runtime's internal durable filesystem transaction
boundary. The implementation provides typed execution, inspection, and explicit
recovery APIs; it does not add a public recovery command or claim a usable SDD
trail.

No pull-request URL was available when this local evidence was recorded, so this
document does not claim one.

## Toolchain and commands

Verification ran on Linux x86-64 with Node.js `24.18.0` and npm `11.16.0`.
Commands were run from the repository root with the pinned toolchain:

```text
npm test -- tests/transaction-fault-campaign.test.ts tests/transaction-process-recovery.test.ts tests/node-transaction-security.test.ts
npm test -- tests/architecture.test.ts tests/runtime-distribution.test.ts tests/package-verifier.test.ts
npm run build
npm run package:verify
npm run verify
npx prettier --check docs/verification/issue-20-transaction-evidence.md
npx cspell --no-progress --show-suggestions --no-gitignore docs/verification/issue-20-transaction-evidence.md
npx --yes markdownlint-cli2@0.23.2 --no-globs docs/verification/issue-20-transaction-evidence.md
git diff --check
```

The focused transaction command passed 3 files and 33 tests. The final package
boundary command passed 3 files and 83 tests. The complete repository command
passed 77 files and 1,374 tests in both the unit and coverage runs. Measured
coverage was 100%: 1,743 statements, 1,266 branches, 269 functions, and 1,594
lines.

The remaining complete-verification gates also passed:

- the Go v3 oracle verified 12 surfaces, 4 PRD anchors, and 3 binaries;
- parity discovery verified 402 keys and retained honest parity at
  `0 / 400 (0.00%)`;
- the result contract verified 76 reasons, 6 exit classes, and 6 examples;
- contracts verified 10 schemas, 14 legacy profiles, and current generated
  types;
- both differential self-test scenarios matched; and
- formatting, spelling, lint, strict type-checking, build, and package
  verification exited successfully.

## Fault and termination campaign

The deterministic two-write, one-delete plan enumerated all 13 durable
operation variants. Twelve variants were reachable during normal execution;
`read_text` was explicitly observed 0 times. The trace contained 110 durable
operation occurrences. Injecting both `before` and `after` at every occurrence
produced exactly 220 fault boundaries.

Every reached boundary records that its selected failure was consumed. A
durable phase before `publishing` recovers to `aborted`; `publishing` and later
phases recover to `committed`. Each case checks the exact three managed
destinations, exact retained receipt entries, and an identical second recovery
receipt. The named `permission` and `disk_full` probes return only
catalog-backed public results and exclude internal labels, absolute roots, and
staged bytes.

The real Node adapter process campaign uses 13 deterministic IPC barriers:

1. durable `begun`;
2. final staged-directory synchronization;
3. manifest synchronization;
4. durable `prepared`;
5. durable `publishing`;
6. first destination rename;
7. first publication-directory synchronization;
8. second destination rename;
9. second publication-directory synchronization;
10. destination delete;
11. delete-directory synchronization;
12. durable `committed`; and
13. terminal cleanup synchronization.

The worker is bundled into a temporary ESM artifact, receives its plan through
arguments rather than environment variables, and emits no plan or staged bytes
to stdout, stderr, or IPC. The parent stops the execution process at the exact
barrier and uses separate fresh processes for inspection, first recovery, and
idempotent retry.

File synchronization is mandatory. On the verified Linux platform, real and
fake transaction receipts recorded directory synchronization as `supported`.
The Node adapter keeps the explicit Windows directory-handle classification as
`unsupported`; that platform-specific outcome was not simulated or claimed as
locally executed evidence.

## Bundle and package evidence

The final boundary tests prove that transaction domain and durable port modules
import no Node.js builtins. Build metadata records both transaction schemas as
embedded inputs:

- `schemas/state/transaction-manifest.v1.schema.json`;
- `schemas/state/transaction-progress.v1.schema.json`.

The core also embeds the catalog-backed `runtime.recovery_required` policy and
contains no checkout-relative schema import. The built manifest remained
version-coherent: plugin `0.0.0-development`, result contract `1.0.0`, reason
catalog `1.3.0`, state contract `1.0.0`, and host contract `1.0.0`.

Package verification accepted exactly this three-file inventory:

```text
runtime/manifest.json
runtime/kratos.core.mjs
runtime/kratos.mjs
```

The core was 237,185 bytes with SHA-256
`e25ad21c8a1a236fb47f6ad29497a2fde7bbbce93d4fc21a3999b0e94f5070ef`.
An isolated copy containing only those three files ran `--help`, `help`,
`--version`, `version`, and `handshake` without a global Kratos installation.

## Explicitly out of scope

- `RUN-06` owns canonical event append and event-chain behavior. This issue does
  not implement `append_event`.
- `RUN-07` owns leases, fencing, and concurrent-writer locking. Hash
  preconditions do not replace that lock contract.
- Public recovery command routing remains owned by the command-facing workflow.
  This issue exposes typed internal inspection and recovery only.

No release, public command, event-store, or lock completeness claim is derived
from this evidence.
