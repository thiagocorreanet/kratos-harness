# Gates, approvals, and evidence

Gate evaluators are pure functions. They receive a closed context and perform
no filesystem, clock, Git, process, or network I/O. Failures are aggregated in
stable priority order. `shadow` records findings while passing, `warn` reports
findings without blocking, and `enforce` blocks.

## Requirement document facts

The composition layer reads the active `00-prd.md` through the durable
filesystem port and passes one closed observation to the pure gate evaluator.
The evaluator never reads the file itself. Its `prd-present` gate distinguishes
four states in order:

| Observation | Gate result |
| --- | --- |
| File is missing | `gate.prd_ausente` |
| Bytes equal the generated PRD template | `gate.prd_untouched` |
| A canonical heading is absent | `gate.prd_section_missing`, with that heading in `detail` |
| Every canonical heading is present | Pass |

Heading inspection accepts ATX headings outside fenced code blocks. This keeps
a Markdown example from satisfying a document requirement accidentally. The
required names and the untouched bytes come from `FEATURE_DOCUMENTS`, the same
definition initialization renders.

## Identified acceptance criteria

The first coordinate is named a **work unit**, matching the hierarchy in
`02-tasks.md`. The canonical grammar and validation expression are published
once in `schemas/contracts/acceptance-criterion-id.v1.schema.json`:

```text
AC-<work-unit>.<task>.<criterion>   main-path criterion
AC-<work-unit>.<task>.E<criterion> edge case
^AC-\d+\.\d+\.E?\d+$
```

Identifiers are at most 128 characters. The task document is the only
declaration surface and its Markdown checkbox is the only current-state
surface. Completing `plan` freezes ordered declaration digests in an immutable
`state.acceptance-criteria-snapshot@1.0.0` artifact referenced by the same
transition event. Existing entries may never be removed, reordered,
renumbered, reused, or edited. Acceptance alone may append an unchecked tail;
the appended snapshot points to its predecessor.

An acceptance agent reports every declared identifier exactly once and cites
digest-valid evidence. The runtime writes one immutable
`state.acceptance-verdict@1.0.0` artifact per identifier, carries those paths in
the unchanged `EventV1.artifactRefs`, and reconciles checkbox bytes. Code and
review can report evidence but cannot change checkbox state. The gate returns
the ordered `criteria` states and blocks on the first identifier that is not
passed, checked, and evidence-valid, so partial acceptance remains explicit.

Snapshots use `acceptance/criteria/<event-id>.json`; verdicts use
`acceptance/verdicts/<event-id>/<AC-ID>.json`. The event carries each actual
artifact path followed by its `<path>#sha256=<digest>` anchor, so generic
consumers can resolve the path and the runtime can verify its immutable bytes.
Task documents are bounded to 126 criteria: the largest acceptance transaction
then uses exactly `EventV1`'s existing 256-reference envelope, including output,
task document, appended snapshot, and its anchor. Each verdict also binds the
snapshot path and digest it judged. Editing historical JSON makes the acceptance
context unreadable instead of rewriting replayed history.

## Repeated-rejection stop facts

The workflow reducer contributes ordered active repair stops to the gate
context. For every such stop, the gate emits
`blocked.stop_loss_rejections` with its immutable stop-artifact reference. The
reason is distinct from `blocked.stop_loss_budget` (token exhaustion) and
`blocked.stop_loss_flag` (the existing host-observed latch). The three reasons
may coexist and retain their stable aggregation order; clearing one does not
clear either of the others.

The artifact binds the run ID, AC identifier, attempt, frozen ceiling,
classification, bounded diagnosis, and record time. Public gate and handoff
views expose only typed, digest-bound facts. Events carry references and
classifications rather than diagnosis text, source documents, prompts, or
absolute paths. A missing, unreadable, changed, or mismatched artifact fails
the context closed.

Repair classification is supplied by the acceptance verdict when a criterion
reaches the ceiling and is not inferred later. The explicit resolution command
records the human identity and bounded, non-whitespace observation in another
digest-bound artifact. A code resolution selectively resets one criterion in
the existing run. Every code stop must be resolved before a specification
resolution can create a new run at `spec` from a restart ticket. The ticket
retires source AC identifiers, so a new specification approval and new
identifiers remain required. Observation verifies all recovery artifact
digests, source/target bindings, and successor cross-links before treating the
run as readable.

## Gap facts

`gates.json` under the run directory carries the facts the gates read:
`openGaps`, `stopLoss.tripped`, `stopLoss.exhausted`, `partitionRequired`, and
`partitionApproved`. It is published as `state.gates@1.0.0`. A missing file
means nothing has been recorded yet and yields the declared defaults: no open
gaps, no tripped budget, no partition to approve. A file that cannot be read as
its contract, or whose count disagrees with the identifiers it lists, fails
closed as unreadable context rather than reading as zero open gaps.

Only the runtime writes it. `kratos gaps record` receives a proposal validated
against `host.gap-proposal@1.0.0`, writes one `state.gap@1.0.0` record per new
gap, appends one event, and derives `gates.json` from the resulting record set.
`kratos gaps resolve` and `kratos gaps waive` answer a recorded gap and derive
the facts again. `kratos gates record` records the host-observed stop-loss and
partition facts. The model proposes, the command receives, and the gate
decides.

A gap is one of four things and nothing else: a rule that admits two readings
which produce different code, a decision only the owner can make, a
contradiction between two passages of the documents, or an external dependency
nobody has confirmed. The schema closes that set, so a fifth kind is refused at
validation with the contract, pointer, and keyword that rejected it. Every gap
carries a description, a recommendation, the reasoning behind it, and a weight
of high, medium, or low; the weight says where the argument is worth having.

Detection is confined to the `prd` and `spec` phases and stops at
specification approval. After approval the derived count is zero by
construction and the records stay on disk, so a gap raised late is visible in
history without stopping a run whose remaining questions are technical.

An owner answers a gap as accepted, adjusted, or rejected, and records
separately whether a document actually changed as a result. An owner may also
proceed over a gap nobody answered; the waiver is recorded, the gap stops
blocking, and it stays on record as unanswered.

The rollout axis is the existing `GateMode`. Under `enforce` an open gap blocks
with `gate.gaps_abertos`. Under `warn` and `shadow` the same gap is recorded,
reported by `kratos handoff` and `kratos doctor`, and the run continues. The
project configuration selects `enforce` with `policyMode: "strict"` and `warn`
otherwise; `shadow` is available to the evaluator for staged rollout.

An approval binds the run, gate, PRD digest, specification digest, policy
version, approver, decision, observation, challenge, decision time, and expiry.
The challenge is the SHA-256 digest of canonical binding data. A changed
artifact, expired approval, repeated approval identifier, or altered challenge
cannot authorize the current operation.

Evidence metadata binds a project-relative reference to its content digest,
classification, and redaction policy. Restricted evidence cannot be declared
unredacted. Handoff manifests sort their evidence and hash the complete
manifest, so input order cannot change the package.

`kratos handoff` is a read-only operational view. It renders the active feature
and objective digest, run state, current phase, gate outcome, blockers, and next
host action without copying user-authored objective text into a public stream.

Final acceptance requires every identified criterion to pass, complete steps,
no gate failures, a valid
`final-acceptance` approval, verified evidence, and artifact lineage bound to
the same run and policy.
