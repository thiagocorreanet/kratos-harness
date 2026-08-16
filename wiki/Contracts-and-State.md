# Contracts and state

Kratos treats persisted data and cross-host messages as public compatibility
surfaces. Version selection happens before payload validation or mutation.

## Contract families

The repository maintains version identities for:

- plugin runtime;
- universal result envelope;
- reason catalog;
- project and workflow state;
- host adapter messages and operations;
- legacy state accepted only for migration;
- differential scenarios and observations.

Current runtime state and host contracts are version `1.0.0`. Legacy `0.9.0`
and `go-v3@0.6.5` state are migration-only and are never treated as current
project state.

## Schema boundary

The registry:

1. selects a known contract identity;
2. creates an inert representation of unknown input;
3. rejects proxies, accessors, cycles, sparse arrays, exotic prototypes, and
   unsupported values;
4. validates against a closed registered schema;
5. returns typed values or stable diagnostics.

Canonical JSON sorts object keys by Unicode code point while preserving array
order. Digests, events, manifests, approvals, and persisted results depend on
those stable bytes.

## Project state

```text
.brain/
├── 00-business/
├── 01-architecture/
├── 02-features/
│   └── <feature>/
│       ├── objective.md
│       ├── objective-history.jsonl
│       └── runs/<run-id>/
│           ├── events.jsonl
│           └── state.json
├── 03-memory/
├── approvals/
├── evidence/
├── locks/
├── migrations/
├── transactions/
└── config.json
```

The exact initialized surface is an allowlist. The runtime owns no arbitrary
directory under the project.

## Event history

Each event records its prior and resulting revision, operation, policy, reason,
effect, content references, observed host/model identity, predecessor hash, and
event hash.

Integrity rules include:

- one revision per event;
- canonical JSONL with a final newline;
- contiguous revision and hash ancestry;
- maximum 64 KiB per event;
- maximum 64 MiB and 100,000 events per stream;
- replay only after full verification.

The hash chain detects rewritten history. It is not a cryptographic signature
and does not prove who authored an event.

## Snapshots

`state.json` is a cache and operational view, not a competing authority. Replay
materializes it from verified events and binds it to the last cursor, hash,
policy version, and timestamp.

Reducers and materializers are evaluated twice to reject mutation or hidden
nondeterminism. A snapshot that cannot be reproduced is corrupt and must be
audited or repaired explicitly.

## Universal results

The reason catalog determines:

- success, failure, or blocked status;
- process exit code;
- retryability;
- recovery guidance;
- required, optional, or forbidden evidence;
- whether state change may be claimed.

Automation should consume `--json`, never scrape the human renderer.

## References

- [Contract versioning](../docs/compatibility/contract-versioning.md)
- [Schema registry](../docs/architecture/schema-registry.md)
- [Event-store integrity](../docs/architecture/event-store.md)
- [Universal result contract](../docs/compatibility/result-contract.md)
- [Schema index](../schemas/README.md)
- [Fixture index](../fixtures/README.md)
