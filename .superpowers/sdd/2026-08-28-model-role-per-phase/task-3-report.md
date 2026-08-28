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

## Concrete-default ownership concern

No existing launcher-bound concrete catalog was present to preserve. This task
therefore keeps catalog facts at the adapter boundary as a required injected,
adapter-versioned `HostModelCatalog`; the generic Node runtime returns `null`
when a launcher does not supply one, so later initialization fails closed.
No concrete model identifiers were invented from conversation or placed in the
shared runtime. A launcher/package owning production defaults must inject its
versioned catalog before the out-of-box initialization path is enabled.
