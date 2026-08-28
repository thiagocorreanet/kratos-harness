# Task 3 Report: Read-only host model routing

## Status

Completed: read-only `ModelRouting`, frozen adapter catalog descriptors, and
honest nullable execution observation are implemented.

## Delivered scope

- Added the runtime `ModelRouting.observe(host)` port, its deterministic
  `fixedModelRouting` fake, and an unavailable Node implementation that returns
  `null` rather than inventing a catalog.
- Added `RuntimePorts.modelRouting`; composition preserves injected routing
  across root anchoring, migration composition, and read-only projections.
- Updated adapters to speak the Task 1 `AdapterMessageV1_1` revision via
  `CONTRACT_VERSIONS["host.adapter-message"]`, report nullable `model` and
  `effort`, and expose an immutable, closed snapshot of their injected catalog.
- Mapped `claude-code` to configuration host `claude` and `codex` to `codex`.
  A mismatched catalog is rejected synchronously.
- Kept the adapter surface relay-only: `name`, `describe`, `translate`, and
  `relay`; the model-routing port exposes `observe` only.

## TDD evidence

### RED

Created the focused adapter and port contract cases before production changes,
then ran:

```text
npm test -- tests/host-adapter-contract.test.ts tests/ports-contract.test.ts
```

Observed 13 expected failures: `fixedModelRouting` was absent; descriptors had
no `configurationHost`, catalog, or observed `effort`; Claude Code did not map
to `claude`; and mismatched catalogs were accepted.

A second RED contract added frozen-catalog conformance. It failed for both fake
adapters because their catalogs were passed through mutable:

```text
2 failed: Object.isFrozen(modelRouting) expected true, received false
```

### GREEN

After the minimal port, snapshot, and transport implementation:

```text
npm test -- tests/host-adapter-contract.test.ts tests/ports-contract.test.ts tests/runtime-composition.test.ts tests/init-command.test.ts tests/read-only-ports.test.ts tests/package-boundaries.test.ts
Test Files  6 passed (6)
Tests  322 passed (322)

npm run typecheck
exit 0

npm run lint
exit 0

git diff --check
exit 0
```

## Files

- `packages/runtime/src/ports/model-routing.ts`
- `packages/runtime/src/infra/fake/model-routing.ts`
- runtime port, fake/node, and composition exports/composition updates
- `packages/adapters/src/index.ts` and its declared runtime type dependency
- adapter and port conformance support/tests, plus affected typed runtime test
  fixtures

## Self-review

- Catalog snapshots copy only contract fields, freeze all nested defaults,
  model entries, aliases, and efforts, and never retain caller-owned arrays.
- The model-routing port never has a mutation method; unavailable/missing facts
  remain `null` and cannot become a configured model or observed identity.
- Adapter request messages use the canonical configuration host, not the
  launcher label, and carry the same nullable observation reported by the
  descriptor.
- Searched shared runtime/domain and adapter sources for concrete model names:
  none were added.

## Initial concrete-default ownership concern (resolved in fix round 1)

No existing launcher-bound concrete catalog was present to preserve. The first
delivery therefore left catalog injection mandatory and the generic Node
runtime returned `null`; the review correctly identified that as unusable
out-of-the-box behavior. Fix round 1 moves concrete defaults into the adapter
surface and wires that provider into production composition, while shared
runtime/domain remains model-name neutral.

## Fix round 1/5 — packaged production defaults

### Finding and resolution

`createRuntime()` previously installed `unavailableModelRouting()`, so the
only production port returned `null`; adapter factories also required a
test-supplied catalog. The boundary was therefore fail-closed but not usable
out of the box.

Concrete, host-native catalog facts now live in `@kratos/adapters`:

- Claude Code uses its stable `sonnet` and `opus` aliases, with `opus` as the
  implementer and `sonnet` as the judge.
- Codex uses the adapter-supported `gpt-5.6-sol` and `gpt-5.6-terra` IDs, with
  Sol as the implementer and Terra as the judge.

The adapter package owns and freezes those facts; runtime composition imports
only the adapter's read-only provider and treats it structurally as the existing
`ModelRouting` port. The adapter no longer imports runtime/domain types, so
there is no adapter-to-domain direction violation. The build rewrites the
composition's adapter import to the compiled sibling module, ensuring installed
Claude Code and Codex artifacts include the same provider.

### TDD evidence

RED tests were added before the wiring:

```text
npm test -- tests/runtime-composition.test.ts tests/init-command.test.ts
FAIL: expected null not to be null
```

The tests construct production `createRuntime()` with no `modelRouting`
override, require non-null complete catalogs for both hosts, require different
canonical implementer/judge defaults, and run `init` with only its ordinary
output/input overrides.

GREEN verification:

```text
npm test -- tests/runtime-composition.test.ts tests/init-command.test.ts tests/host-adapter-contract.test.ts tests/ports-contract.test.ts tests/package-boundaries.test.ts
Test Files  5 passed (5)
Tests  303 passed (303)

npm run build
PASS: emitted Claude Code and Codex artifacts

npm run package:verify
Kratos package verification passed for Codex and Claude Code.

npm run typecheck
exit 0

npm run lint
exit 0

npx prettier --check [changed files]
exit 0

git diff --check
exit 0
```

### Verification notes

`tests/architecture.test.ts` now recognizes this task's two import additions;
its remaining failure is pre-existing in parent commit `90c6faa^`:
`packages/runtime/src/domain/schema/contract-version.ts` imports `node:util`.
The current task does not modify that module. The full repository
`npm run format:check` likewise reports only three pre-existing Task 2 files
(`model-roles/resolve.ts`, `model-role-resolution.test.ts`, and its support
builder); every file changed in this round passes Prettier.

### Self-review

- Runtime/domain remain free of concrete model identifiers; only the adapter
  capability surface contains them.
- Every bundled catalog contains all three roles and a different canonical
  implementer/judge identity. Missing injected catalogs still return `null` in
  the explicit unavailable Node helper and fake, with no fallback.
- The adapter-to-runtime package dependency was reversed into a
  composition-to-adapter dependency, which avoids the prohibited adapter →
  domain edge and bundles cleanly in both host artifacts.
