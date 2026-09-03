# Project Profile Derivation Design

Date: 2026-09-02
Status: APPROVED
Issue: `ADP-08` (#190)
Dependencies: `ADP-07` (#193), `SDD-17` (#142), `FND-08` (#138)
Approval source: the user's approved brainstorming dialogue

## Problem and outcome

`kratos init` previously refused to infer the project profile (commands for test,
lint, build, run; source, test, and configuration paths; and directory layout,
naming, and language conventions). When the host did not prompt or the user could
not answer immediately, the profile initialized with empty placeholders (`<UNRESOLVED: ...>`),
leading `kratos doctor` to report `stack-profile: fail` / `warn`.

Repositories already carry explicit, declarative manifests (`package.json` scripts,
`Makefile` targets, `pyproject.toml` tool tables, `Cargo.toml`, `go.mod`) and canonical
directory names (`src/`, `tests/`, `config/`). Discarding this evidence forced redundant
manual input.

This design introduces offline, deterministic, and declarative derivation of the
project profile. It adds a first-class `derived` status carrying the value and its
exact provenance evidence, records confirmation explicitly (`resolved` vs `derived`),
renders provenance in the stack profile, and ensures gates requiring operator decisions
do not advance on unconfirmed derived commands.

## Authority and contracts

The runtime remains the sole authority for profile resolution, validation, persistence,
and diagnostics.

`host.init-answers@1.6.0` (with `hostContract: "1.4.0"`) and `state.project-config@1.5.0`
(with `stateContract: "1.5.0"`) extend `ProjectProfileLeaf<T>` to accept four possible states:

1. `{ "status": "resolved", "value": T }` — explicitly stated or confirmed by a human operator.
2. `{ "status": "derived", "value": T, "evidence": string }` — inferred offline from declarative manifest or directory evidence with precise provenance.
3. `{ "status": "not-applicable", "reason": string }` — declared not applicable.
4. `{ "status": "unresolved" }` — no evidence or answer exists.

### Contract definitions

- `derivedCommand`: `{ "status": "derived", "value": string, "evidence": string }`
- `derivedPaths`: `{ "status": "derived", "value": string[], "evidence": string }`
- `derivedConvention`: `{ "status": "derived", "value": string, "evidence": string }`
- `derivedImplementationLanguages`: `{ "status": "derived", "value": string[], "evidence": string }`

`evidence` is a non-empty, single-line string of at most 256 characters naming the
exact source (e.g. `package.json#scripts.test`, `Makefile:test`, `directory:src`).

## Declarative derivation engine

A pure module `deriveProjectProfile` in `packages/runtime/src/domain/init/derive.ts`
inspects bounded repository evidence and declarative manifest contents without executing
any command, consulting the clock, or making network calls:

1. **Manifest commands**:
   - `package.json`: Reads the `scripts` object for `test`, `lint`, `build`, `start`/`run`.
     Evidence: `package.json#scripts.<name>`.
   - `Makefile`: Reads top-level target declarations matching `test:`, `lint:`, `build:`, `run:`.
     Evidence: `Makefile:<target>`.
   - `pyproject.toml`: Reads `[project.scripts]`, `[tool.poetry.scripts]`, `[tool.pytest.ini_options]`, `[tool.ruff]`.
     Evidence: `pyproject.toml#<section>`.
   - `Cargo.toml`: Derives `cargo test`, `cargo clippy`, `cargo build`, `cargo run`.
     Evidence: `Cargo.toml`.
   - `go.mod`: Derives `go test ./...`, `go vet ./...`, `go build ./...`, `go run .`.
     Evidence: `go.mod`.

2. **Directory paths**:
   - `source`: Scans for top-level or first-level directories `src`, `lib`, `app`, `packages`.
     Evidence: `directory:<name>`.
   - `tests`: Scans for `tests`, `test`, `spec`, `__tests__`.
     Evidence: `directory:<name>`.
   - `configuration`: Scans for `config`, `.config`, `etc`.
     Evidence: `directory:<name>`.

3. **Conventions and languages**:
   - `implementationLanguages`: Derived from detected languages in `StackProfile` having scanned files $> 0$.
     Evidence: `census:<languages>`.
   - Conventions without declarative manifest targets remain `unresolved` unless answered.

## Resolution and precedence

Each profile leaf resolves independently according to strict precedence:

1. **Explicit answer in init document**:
   - If user confirms a derived value or types an answer $\rightarrow$ `{ status: "resolved", value }`.
   - If user explicitly marks not-applicable $\rightarrow$ `{ status: "not-applicable", reason }`.
   - If user explicitly resets $\rightarrow$ `{ status: "unresolved" }`.
   - If host supplies an unconfirmed derivation $\rightarrow$ `{ status: "derived", value, evidence }`.
2. **Persisted configuration**:
   - Value existing in current `.brain/config.json`.
3. **Repository derivation**:
   - Derived from declarative manifests and repository scan $\rightarrow$ `{ status: "derived", value, evidence }`.
4. **Fallback**:
   - `{ status: "unresolved" }`.

## Relay and distribution skills

The shared `projectProfileQuestions` and `relayProjectProfileAnswers` in `distribution/shared/project-profile-relay.mjs`
and the host skills (`claude-code`, `antigravity`, `codex`) update their interview:

- Before asking, compute candidate derived values from offline repository evidence.
- Present derived values with evidence to the user for confirmation.
- Confirmed values are relayed as `{ status: "resolved", value }`.
- Unconfirmed values are relayed as `{ status: "derived", value, evidence }`.
- Keys with no evidence and no response are relayed as `{ status: "unresolved" }`.

## Stack profile rendering and diagnostics

1. **`stack-profile.md` Rendering**:
   - `resolved`: Rendered as plain command fence or table cell.
   - `derived`: Rendered with provenance annotation (e.g. `(derived from package.json#scripts.test)`).
   - `not-applicable`: `Not applicable: <reason>`.
   - `unresolved`: `<UNRESOLVED: <key>>`.

2. **`kratos doctor` (`deriveStackProfileCheck`)**:
   - `pass`: Byte-exact match and no `unresolved` keys. `derived` values count as present and do not fail or warn on their own.
   - `warn`: Present `unresolved` keys or content drift.
   - `fail`: Unreadable file or corrupt configuration.

3. **Operator gate invariants (`AC-8`)**:
   - When a gate requires an explicit operator decision before running a command, a `derived` (unconfirmed) command leaf is not treated as operator consent and refuses to advance until explicitly confirmed (`resolved`).

## Migration

Migration planner and upgrade handler support `state.project-config@1.4.0` to `1.5.0`.
Existing configurations are cleanly upgraded, updating `contractVersion` and `stateContract` to `1.5.0` while preserving all existing `commands`, `paths`, and `conventions`.

## Acceptance criteria mapping

- `AC-1`: Node project with `package.json#scripts.test` derives `projectProfile.commands.test` with evidence `package.json#scripts.test`.
- `AC-2`: Derived value recorded as `resolved` only upon human confirmation; record distinguishes `resolved` vs `derived`.
- `AC-3`: Keys with no evidence remain `unresolved` and initialization succeeds.
- `AC-4`: Derivation reads only declarative manifest sections and directory names, making no network, clock, or execution calls.
- `AC-5`: Rendered `stack-profile.md` visibly distinguishes `resolved`, `derived`, `not-applicable`, and `unresolved`.
- `AC-6`: Derivation is deterministic: identical repository $\rightarrow$ identical profile.
- `AC-7`: `kratos doctor` passes (`pass`) when profile is fully derived/confirmed without unresolved leaves.
- `AC-8`: Gates requiring operator consent fail closed on unconfirmed `derived` values with diagnostic reason.
