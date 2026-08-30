# Task 3 report: doctor readiness, host parity, documentation, and evidence

Date: 2026-08-29
Status: GREEN; ready for Task 4 full verification
Baseline: `98fcad09942c2997abdcb108b511feda65d48762`
Commit: `feat(runtime): diagnose and relay project profiles` (Task 3 commit)
Review fix: `fix(runtime): harden profile diagnosis and relay verification`

## Delivered behavior

- Workflow observation now reads the generated stack-profile destination,
  validates authoritative project configuration, renders expected bytes from
  typed state and root-entry stack evidence, and lists unresolved profile keys.
- Doctor emits one `stack-profile` check. Matching complete or entirely
  not-applicable state passes; unresolved keys, missing bytes, and drift warn;
  unreadable or non-file destinations and invalid authority fail. Missing or
  drifted documents do not hide unresolved-key recovery details.
- Doctor renders actionable details for both orientation and corrupt results.
  Corrupt evidence references are deduplicated before result validation.
- Both host packages receive one shared ten-question project-profile relay.
  The relay shapes keyed answers without inference, validation, Markdown
  parsing, or command execution.
- Package verification imports and executes each packaged relay, pins the
  question order and text, and verifies exact value mapping independently of
  the host-assets digest.
- The new distribution test uses a unique temporary build root, and the shared
  package-test helper now scopes its root by process and Vitest worker. Parallel
  test processes can no longer delete one another's staged runtime.

## TDD evidence

### RED

- Doctor focus: 15 expected failures showed the missing readiness classifier,
  missing workflow observation, and real command cases still reporting the old
  result. The cases covered matching, unresolved, missing, drifted,
  not-applicable, unreadable, non-file, invalid-authority, and command-inert
  behavior.
- Host parity: packaged-relay tests failed because neither package contained
  `project-profile-relay.mjs`; the package-verifier tamper case also failed
  because recomputing the host-assets digest let changed interview behavior
  pass.
- Correction RED: a missing generated document with unresolved typed state
  initially omitted the unresolved key from diagnostic details.

### GREEN

- Doctor classifier and command: 2 files, 20 tests passed.
- Profile, initialization, migration, doctor, and contract-documentation slice:
  10 files, 231 tests passed.
- Packaged host relay: 1 file, 3 tests passed, including both embedded runtimes
  producing identical persisted profile values and rendered bytes.
- Package verifier: 1 file, 6 tests passed, including a tampered relay rejected
  for the precise `project-profile questions are invalid` reason.
- Runtime distribution: 1 file, 8 tests passed.
- `contracts:check`: 37 schemas and 14 legacy profiles verified; generated
  declarations are current.
- `build` followed by `package:verify`: Codex and Claude Code package flows
  passed.
- `format:check`, `spellcheck`, `english:check`, `lint`, and `typecheck` passed.

## Review fix round 1

### Reviewer findings reproduced as RED

- Real JSON doctor-command regressions loaded each published predecessor
  configuration (`1.0.0`, `1.1.0`, and `1.2.0`). All three initially returned
  `runtime.state_corrupt` instead of `profile.config_migration_required`.
- A Node-filesystem regression wrote a rendered U+FFFD byte sequence and
  replaced its valid UTF-8 bytes (`EF BF BD`) with invalid byte `FF`. Both
  decoded strings were equal and doctor incorrectly passed the altered file.
- A package-verifier regression conditionally corrupted only array-shaped
  answers. The previous scalar-only relay probe allowed the recomputed package
  to pass.

### Corrections

- Workflow observation now preserves the configuration observer's
  migration-required classification and reason. Doctor reports the stable
  profile migration reason with `.brain/config.json` evidence for all three
  predecessors; the existing init refusal remains unchanged.
- Stack-profile comparison now uses the inspected file's raw byte size and
  SHA-256 against the UTF-8 renderer output's byte size and SHA-256. Decoded
  text is no longer an equality authority.
- Package verification now probes distinct valid scalar, array,
  not-applicable, and unresolved answers. It passes the actual relay result
  into installed initialization, then checks the persisted typed values and
  rendered stack-profile content.
- Runtime distribution prose now attributes cross-host equality to
  `tests/project-profile-relay-distribution.test.ts`.

### Review-fix GREEN commands

- `npx --yes npm@11.16.0 test -- --run tests/diagnostics.test.ts tests/doctor-command.test.ts tests/init-command.test.ts --reporter=verbose`:
  3 files, 50 tests passed.
- `npx --yes npm@11.16.0 test -- --run tests/package-verifier.test.ts tests/project-profile-relay-distribution.test.ts --reporter=dot`:
  2 files, 10 tests passed.
- `npx --yes npm@11.16.0 run contracts:check`: 37 schemas and 14 legacy
  profiles verified; generated types current.
- `npx --yes npm@11.16.0 run build && npx --yes npm@11.16.0 run package:verify`:
  Codex and Claude Code package flows passed.
- `npx --yes npm@11.16.0 run format:check`, `spellcheck`, `english:check`,
  `lint`, and `typecheck` passed.
- Post-lint fingerprint-branch check:
  `npx --yes npm@11.16.0 test -- --run tests/diagnostics.test.ts --reporter=dot`:
  1 file, 13 tests passed.

The complete reproducible acceptance map is in
`docs/verification/issue-142-stack-profile-evidence.md`. Task 4 will append the
final full `npm run verify` outcome there.

## Documentation corrections

- `docs/compatibility/contract-versioning.md` now links manifest v1.3, v1.2,
  and v1.1 as published predecessors and names state/host 1.3, project profile
  1.3, manifest 1.4, and reason catalog 1.9 accurately.
- Architecture and user guides now describe the full configuration migration
  chain, `profile.config_migration_required`, typed profile authority,
  deterministic regeneration, doctor recovery, and inert commands.
- Runtime distribution documentation records the shared behavioral relay and
  package-verifier enforcement.

## Self-review

- The diagnostic path consumes only typed configuration, root entry names, and
  renderer output; it never parses generated Markdown for answers.
- The command sentinel test persists `touch doctor-command-ran` and proves no
  file is created by doctor. Existing init tests retain the same no-execution
  boundary.
- `not-applicable` produces no unresolved key; all ten unresolved keys retain
  stable actionable paths.
- Host equality is demonstrated through imported packaged modules and real
  initialization behavior, not a source-text grep.
- Tampering the relay and recomputing its manifest digest is still rejected by
  semantic package verification.
- `git diff --check` is clean; changed repository-authored prose is English and
  contains no unresolved work marker.

## Remaining concern

The complete `npm run verify` gate is intentionally reserved for Task 4. No
Task 3 implementation blocker remains; Task 4 should append its final outcome
to the issue evidence document.
