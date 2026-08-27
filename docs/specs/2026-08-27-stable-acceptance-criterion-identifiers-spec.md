# Objective Spec: Stable Acceptance Criterion Identifiers

Date: 2026-08-27
Status: APPROVED
Approval source: GitHub issue #132 and the user's approved brainstorming design

## 1. Problem and desired outcome

- **Context:** Acceptance is currently reduced to `GateContext.finalAcceptance`
  and an overall approval. The runtime cannot identify, count, partially report,
  or replay the individual criteria declared in `02-tasks.md`.
- **Outcome:** Every criterion has one stable `AC-*` identifier. The runtime
  validates declarations before accepting the task document, freezes them when
  the plan completes, records criterion verdicts with evidence, updates
  checkboxes only from the acceptance phase, and exposes partial acceptance in
  the gate and event history.

## 2. Scope

### In scope

- Publish one host-neutral identifier grammar and validator:

  ```text
  AC-<work-unit>.<task>.<criterion>
  AC-<work-unit>.<task>.E<criterion>
  ^AC-\d+\.\d+\.E?\d+$
  maximum length: 128 characters
  ```

- Give `02-tasks.md` an explicit work-unit and task hierarchy.
- Parse criterion declarations and checkbox state without I/O in the domain.
- Reject missing, malformed, duplicate, misplaced, or coordinate-mismatched
  identifiers when the task document becomes contractual.
- Freeze the ordered declarations when the accepted `plan` transition advances
  to `code`.
- Permit only `acceptance` to append new unchecked declarations at the end.
- Permit only the runtime, while recording an acceptance verdict, to change
  criterion checkboxes.
- Persist immutable declaration snapshots and per-criterion verdict records.
- Put the exact identifier in each verdict artifact path referenced by
  `EventV1.artifactRefs`.
- Report ordered per-criterion status in the acceptance gate.
- Bootstrap an older run only when its recorded plan artifact digest proves the
  current task-document bytes.
- Add stable reason codes, fixtures, public documentation, and issue evidence.

### Out of scope

- The prompt that authors an acceptance verdict (#134).
- Changes to approval challenge fields or digest binding.
- A new state-contract, host-contract, event, approval, or snapshot version.
- Automatic adoption of an unverified task document from an older run.
- General enforcement of every post-approval edit outside criterion
  declarations and checkboxes.

## 3. Document contract

The first numeric component is named **work unit**. The task document uses this
canonical shape:

```markdown
## Ordered work

### Work unit 1: Runtime contract

#### Task 1.2: Parse declarations

##### Files

- `packages/runtime/src/domain/acceptance-criteria/`

##### Acceptance criteria

- [ ] AC-1.2.1: Reject duplicate identifiers.

##### Edge cases

- [ ] AC-1.2.E1: Reject a doubled E.
```

Only checkbox list items under `Acceptance criteria` and `Edge cases` declare
criteria. Each item starts with `[ ]` or `[x]`, one identifier, `:`, and
non-empty text. The identifier's first two components must lexically equal the
enclosing work-unit and task headings. Main-path sections reject `E`; edge-case
sections require it. Numbering may be non-contiguous and lexical spelling,
including leading zeroes, is preserved.

The parser returns ordered declarations containing the identifier, work-unit
and task coordinates, kind, text, ordinal, line number, and checked state. It
returns one closed failure for a missing document, malformed declaration, or
duplicate identifier. A duplicate failure names the valid identifier; malformed
content reports its line and the canonical grammar without echoing arbitrary
document text.

## 4. Persistence contracts

`state.acceptance-criteria-snapshot@1.0.0` is an immutable derived record with:

- contract and state identities;
- run, event, source reference, source digest, timestamp, and optional previous
  snapshot reference;
- no more than 256 ordered declaration entries;
- each entry's identifier, coordinates, kind, ordinal, and a digest of the
  declaration with its checkbox normalized to unchecked.

`state.acceptance-verdict@1.0.0` is one immutable record per criterion with:

- contract and state identities;
- run and event identifiers, criterion identifier, outcome, and timestamp;
- the declaration snapshot reference and digest;
- evidence identifier, project-relative reference, and SHA-256 digest.

Snapshots live at
`.brain/02-features/<feature>/runs/<run>/acceptance/criteria/<event-id>.json`.
Verdicts live at
`.brain/02-features/<feature>/runs/<run>/acceptance/verdicts/<event-id>/<AC-ID>.json`.
The task document remains the only declaration surface and its checkbox remains
the only current tracked state. Persisted records are immutable proof.

The canonical AC-ID JSON Schema is an embedded schema dependency. New persisted
schemas reference it, while the contracts package exports a matcher derived
from the same pattern and length. The unchanged host agent-output schema keeps
its generic identifier field; semantic validation applies the shared matcher.

## 5. Workflow and data flow

1. Composition observes `02-tasks.md` when completing `plan` and in every later
   phase, then passes a closed parse and history observation to the domain.
2. An accepted plan completion requires a valid document with every checkbox
   unchecked. It writes the initial snapshot in the same transaction as the
   transition event and includes the snapshot path in `artifactRefs`.
3. In `code` and `review`, the current ordered declarations must match the
   latest snapshot exactly and checkbox state must match the latest valid
   verdict history. Append, renumber, removal, reorder, text change, or checkbox
   mutation is refused before effects are applied.
4. In `acceptance`, the existing declaration sequence remains an exact prefix.
   New declarations may occur only at the tail and must be unchecked. A valid
   append creates the next immutable snapshot.
5. An acceptance output must cite every current declaration exactly once and no
   unknown declaration. `accepted` is valid exactly when every outcome is
   `passed`; otherwise the overall verdict is `rejected`.
6. Every criterion evidence reference must resolve to a valid `EvidenceV1`
   record whose referenced content matches its digest.
7. The runtime atomically writes verdict records, writes the latest agent
   output, sets checkboxes to `[x]` for passed criteria and `[ ]` for failed or
   not-run criteria, writes an appended snapshot when needed, and appends the
   fact event.
8. Re-delivery with the same correlation identifier is a no-op. A later verdict
   may reverse a prior criterion outcome and the runtime updates the checkbox
   accordingly while preserving both immutable verdict histories.
9. `GateContext` receives structured criterion observations instead of
   `finalAcceptance`. `GateDecision` exposes every criterion in document order
   with outcome, checkbox, evidence, and completion state. Partial results are
   reportable but block `done`.
10. Final completion still requires the existing final approval, valid evidence,
    passing gates, and artifact lineage in addition to every criterion being
    passed and checked.

## 6. Compatibility and legacy runs

- Compatibility is additive inside state contract `1.0.0`: two new schemas and
  a new reason-catalog revision. Published `1.0.0` schemas remain byte-identical.
- A run already beyond `plan` may bootstrap its first snapshot only if its
  recorded plan lineage names `02-tasks.md` and the lineage digest equals the
  current bytes. Parsing must also succeed.
- Bootstrap is performed only as part of an authorized mutating operation and
  is committed atomically with that operation. Read-only observation reports
  the missing baseline without changing state.
- Missing lineage, a different artifact, or digest drift returns a stable
  fail-closed reason. The runtime never treats the current document as
  historical truth merely because it exists.
- Codex and Claude Code use the same schemas, parser, decisions, reason codes,
  and effect plans. Host assets only relay and render results.

## 7. Failure policy

Reason catalog revision `1.5.0` appends fail-closed policies for:

- `gate.ac_document_missing`;
- `gate.ac_identifier_malformed`;
- `gate.ac_identifier_duplicate`;
- `gate.ac_baseline_unverifiable`;
- `gate.ac_declaration_changed`;
- `gate.ac_append_forbidden`;
- `gate.ac_checkbox_forbidden`;
- `gate.ac_verdict_mismatch`;
- `gate.ac_evidence_missing`;
- `gate.ac_evidence_invalid`;
- `gate.ac_incomplete`.

All failures are blocked exit-code-3 results, require project-relative evidence,
claim no state change, and are retryable after correcting the document,
evidence, phase, or baseline. Details identify the first valid affected AC ID
when available and otherwise identify the line and expected grammar.

## 8. Acceptance criteria

- [x] The first component is named work unit and one canonical schema publishes
  the grammar, regex, and maximum length.
- [x] The design makes `02-tasks.md` the only declaration and checkbox-state
  surface.
- [ ] Duplicate and malformed identifiers are rejected at document-read time
  with stable reasons and safe details.
- [ ] Plan completion freezes the ordered declarations.
- [ ] Renumbering after the freeze is refused; a tail append in acceptance is
  allowed and recorded.
- [ ] Code and review cannot change criterion checkboxes.
- [ ] A passed outcome without verified evidence cannot check a criterion.
- [ ] The acceptance gate reports partial per-criterion state.
- [ ] Every verdict event contains immutable artifact references carrying the
  exact identifier, and replay preserves them unchanged.
- [ ] Older runs bootstrap only from digest-proven plan lineage.
- [ ] Codex and Claude Code package and behave equivalently.
- [ ] Focused verification and `npm run verify` pass.

## 9. Test strategy and security

- Use deterministic property generators already established in the repository;
  add no dependency.
- Exercise valid, non-contiguous, leading-zero, duplicate, missing-`E`, doubled
  `E`, negative, coordinate-mismatched, and over-length declarations.
- Assert exact template bytes, immutable catalog prefixes, schema/type drift,
  transaction atomicity, retry idempotency, phase ownership, legacy bootstrap,
  partial acceptance, done readiness, and replay.
- Bound task documents to 256 criteria and AC IDs to 128 characters. Derive all
  persisted paths from validated run and criterion identifiers.
- Keep criterion text and evidence content out of events. Verdicts persist only
  bounded identifiers and digest-bound metadata.
- Introduce no network, process, host, clock, filesystem, or approval authority
  in the pure domain.
