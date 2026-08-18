# Issue #129 Agent Output Contract Evidence

Issue [#129](https://github.com/thiagocorreanet/kratos-harness/issues/129)
(`ADP-01b`) records verification for the agent output contract: the machine
block a phase agent appends to its reply, its extraction, its validation, and
its recording as run state. This record claims no compatibility parity credit.

## Environment

| | |
| --- | --- |
| Date | 2026-08-18 |
| Platform | Linux 7.0.0-28-generic |
| Node.js | v24.18.0 |
| npm | 11.16.0 |

## Verification commands

```bash
npx vitest run tests/agent-output-contract.test.ts
npx vitest run tests/agent-output-recording.test.ts
npx vitest run tests/contract-schemas.test.ts tests/contract-manifest.test.ts
npx vitest run tests/schema-registry-fixtures.test.ts
npx vitest run tests/contract-documentation.test.ts
npm run contracts:check
npm run verify
```

`npm run verify` exits 0 on this branch: 148 test files, 3992 tests, contract
families verified at 17 schemas, and package verification passing for Codex and
Claude Code.

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| A reply with no machine block is reported as such and does not advance the run | `agent-output-recording`: "reports a reply with no machine block without advancing the run" asserts exit 3, `trail.output_invalido`, `stateChanged: false`, no recorded document, and no `run.agent.recorded` event |
| A reply with a malformed block fails closed and names the parse failure | `agent-output-recording`: "names the parse failure of a malformed block" asserts the reported cause is "The machine block is not a single JSON document."; `agent-output-contract` covers all ten malformations |
| A reply with a schema-invalid block is refused, and the reason names the offending path | `agent-output-recording`: "names the offending path of a schema-invalid block" asserts the reported cause contains `outcome.status` |
| A reply containing an ordinary fenced example plus one machine block extracts the machine block | `agent-output-contract`: "ignores an ordinary fenced example and extracts the machine block" reads `replies/decoy.md`, whose fence claims `blocked` while the block reports `completed` |
| Extraction and validation perform no model call and no network access | `agent-output-contract`: "performs no model call and no network access" asserts the whole `domain/agent` module imports nothing but `@kratos/contracts`, the schema types, and its own files |
| The same reply extracts identically under both hosts | `agent-output-recording`: "reads the same reply identically whichever host relayed it" records the same reply as `claude-code` with LF and as `codex` with CRLF and compares the persisted bytes |

## Required tests and evidence

| Requirement | Evidence |
| --- | --- |
| A valid and an invalid fixture for every agent payload type | `fixtures/agent-output/v1/valid` and `fixtures/agent-output/v1/invalid`, six files each, asserted exhaustive against `AGENTS` |
| A fixture with no block, a malformed block, and a decoy | `fixtures/agent-output/v1/replies/absent.md`, `malformed.md`, `decoy.md`, plus `trailing.md` and `invalid.md` |
| Round-trip test proving the persisted block equals the validated block | `agent-output-recording`: "persists exactly the block the validator accepted" re-validates the recorded file through the registry and compares both the value and the bytes |

## Compatibility, state, and security

Compatibility: additive. `host.agent-output@1.0.0` is a new registered
contract; no existing schema, reason code, or command changed shape. The
manifest bound moves from 16 to 17 registered schemas.

State: additive. A run gains `runs/RUN/agent-output/AGENT.json` and a
`run.agent.recorded` fact event. Recording a fact does not move the run through
its phases, and a run that never records one is unchanged.

Security: the extractor is a pure function over untrusted model output with a
bounded block size, no platform imports, and no network reach. Every reference
the contract accepts is project-relative: absolute paths, drive letters,
backslashes, parent traversal, and URL schemes are refused by the schema, and
every text field refuses control characters.
