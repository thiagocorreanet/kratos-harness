# Project Initialization Consolidated Interview, Scoped Rules, and Provenance-Backed Permissions Design

Date: 2026-08-31
Status: APPROVED
Issue: #38a (`ADP-04a`)
Dependencies: #38 (`ADP-04`), #136 (`FND-07`), #138 (`FND-08`), #133 (`SDD-14`), #128 (`SDD-12`), #144 (`SDD-07a`), #142 (`SDD-17`)
Approval source: the user's approved brainstorming dialogue

## Problem and outcome

Initialization previously generated a minimal skeleton with empty permission allowlists (`{ permissions: { allow: [], deny: [] } }`), an uninformative managed instructions block, and zero stack-specific project rules. This forced developers to manually grant permissions one interruption at a time and lacked critical project-scoped guidelines for AI agents.

Furthermore, several features (#136 model roles, #138 language policy, #133 write-block globs, #128 gap mode, #144 token budget) each require initialization parameters. Without a unified interview, asking users isolated questions creates fatigue and redundant prompts.

This design establishes:

1. A **consolidated, deterministic interview pipeline** where detection answers first and the user is prompted only for what detection could not determine, using concrete choices with recommended defaults.
2. **Provenance-backed permission allowlists** in `.claude/settings.json` and host configurations derived deterministically from detected toolchains and explicit profile commands, strictly refusing any unverified or guessed permissions.
3. **Stack-scoped project rules** (`.claude/rules/<stack>.md`, `.codex/rules/<stack>.md`) generated concisely for recognized stacks only.
4. A **tightly budgeted managed instructions block** in `CLAUDE.md` and `AGENTS.md` (bounded to <= 50 lines / 2,000 characters) tailored with detected stack and project facts, while strictly preserving user content outside the managed markers.
5. A **safe re-initialization protocol** that guarantees idempotency (zero writes and "nothing to do" report on rerun) and asks before touching modified project surfaces.

## Authority and contracts

The Kratos runtime is the single authority for interview resolution, permission provenance verification, rule content synthesis, and skeleton effects generation. Host adapters (Claude Code, Codex, Antigravity) only relay answers and render the canonical artifacts.

### 1. Schema & Contract Versioning (`init-answers.v1.5`)

- `host.init-answers@1.5.0` and `state.project-config@1.5.0` consolidate all inputs:
  - `language`: `LanguagePolicyV1` (7 fields from #138).
  - `modelRoles`: Phase model assignments per host from #136.
  - `writeGuard`: Block and allow globs from #133.
  - `gateModes`: Policy modes per gate (`shadow` | `warn` | `enforce`) from #128.
  - `tokenBudget`: Feature token ceilings and `acceptanceAttemptCeiling` from #144.
  - `projectProfile`: Typed commands, paths, and conventions from #142.
  - `hosts`: Selected host platforms (`claude`, `codex`, `antigravity`).
  - `policyMode`: `standard` | `strict`.
  - `snapshots`: boolean.

### 2. Strict Permission Provenance Engine

Every generated permission in `.claude/settings.json` (or host security configuration) must map to an explicit provenance record:

- **`GitProvenance`**: Derived when `.git` is detected at repository root -> allows read-only inspection commands:
  - `Bash(git status)`
  - `Bash(git diff)`
  - `Bash(git log)`
- **`StackToolchainProvenance`**: Derived when specific stack manifests are detected:
  - `node` (`package.json`): `Bash(npm test)`, `Bash(npm run lint)`, `Bash(npm run build)` (or corresponding `yarn` / `pnpm` based on lockfile evidence).
  - `rust` (`Cargo.toml`): `Bash(cargo test)`, `Bash(cargo check)`, `Bash(cargo clippy)`.
  - `python` (`pyproject.toml` | `requirements.txt`): `Bash(pytest)`, `Bash(python -m unittest)`.
  - `go` (`go.mod`): `Bash(go test ./...)`, `Bash(go vet ./...)`.
- **`ExplicitProfileProvenance`**: Derived from explicit answers in `projectProfile.commands` (e.g. custom test or lint runner).

**Contract Invariant**: The function `derivePermissions` is pure. Any permission entry without a proven detection or explicit user answer triggers a contract failure assertion during tests and builds (`PERMISSION_WITHOUT_PROVENANCE`). No guessed allowances are ever generated.

### 3. Scoped Project Rules Engine

For each detected stack in `StackProfile`, the runtime generates targeted markdown rules files into the enabled hosts' native rules directories:

- For Claude Code: `.claude/rules/<stack>.md`
- For Codex: `.codex/rules/<stack>.md`
- Unrecognized stack (`unrecognized: true`): Generates 0 rules files.
- Each rule document is compact (under 35 lines), focused on coding style, testing invocation, and stack idioms.

### 4. Managed Instructions Budget & User Content Preservation

`CLAUDE.md` and `AGENTS.md` managed blocks:

- Bounded strictly to <= 50 lines and <= 2,000 characters.
- Structured with:
  - Detected project stack and primary execution commands.
  - Language policy summary.
  - State locations (`.brain/01-architecture`, `.brain/02-features`, `.brain/03-memory`).
  - Guardrails & Write-guard rules summary.
- User content outside `<!-- KRATOS:MANAGED:BEGIN -->` and `<!-- KRATOS:MANAGED:END -->` is preserved verbatim.

### 5. Idempotent Execution & Safe Re-initialization

- `skeletonEffects(answers, stackProfile)` produces a deterministic `readonly Effect[]` plan.
- If existing files match the plan byte-for-byte, `init` exits cleanly reporting no changes required.
- If existing files exist with unmanaged content or divergent configuration, `init` preserves unmanaged sections and prompts the user before modifying state in interactive mode.
- Post-initialization reporting summarizes configured hosts, detected stacks, generated rules, and granted permissions.

## Required tests and verification

1. **Greenfield, Recognized Stack, and Unrecognized Projects**: Byte-for-byte assertion of all generated files across Claude and Codex hosts.
2. **Strict Provenance Assertion**: Negative tests asserting that attempting to grant an unproven permission fails with an explicit reason code.
3. **Idempotence Assertion**: Verifying that running `init` twice consecutively produces zero diffs and exits with a "nothing to do" status.
4. **User Content Preservation**: Asserting that user text outside the managed markers in `CLAUDE.md` / `AGENTS.md` is preserved exactly after re-initialization.
5. **Instruction Budget Enforcement**: Unit test asserting that the managed instruction block length and line count do not exceed limits.
