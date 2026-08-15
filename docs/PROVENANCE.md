# Kratos provenance and reconstruction policy

## Source

Kratos was reconstructed from the public source, documentation, tests, and all
open and closed issues of:

- repository: `thiagocorreanet/mestre-yoda`;
- source branch inspected: `main`;
- source commit cloned: `a3b75940a684f760ccedd66812dd1160f1729f41`;
- issue snapshot date: 2026-08-15;
- observed issue count: 77;
- observed closed issues: 32;
- observed open issues: 45;
- source license: MIT.

## Interpretation rules

1. A closed issue is a delivered contract candidate. Its code, tests, schemas,
   architecture notes, and verification evidence must agree before Kratos
   claims the capability.
2. An open issue is a requirement or research item. It belongs in the Kratos
   backlog and must not be described as accepted merely because source code or
   design work exists; its required evidence remains explicit.
3. Epic state alone does not override child evidence. Several source epics
   remain open after some or all implementation children were closed.
4. Source compatibility artifacts remain historical evidence. Kratos product
   names, package namespaces, runtime filenames, and commands use `Kratos` and
   `kratos`.
5. Public contracts are changed deliberately. A rename that changes a schema
   identifier, command, runtime file, or environment variable requires tests
   and a compatibility note.

## Preserved architecture

- a host-neutral deterministic core;
- ports and adapters with dependency direction toward the domain;
- versioned state, host, result, and plugin contracts;
- project-local `.brain` state;
- effect plans separated from effect application;
- atomic managed filesystem transactions;
- hash-linked append-only event history;
- locks, leases, fencing, and explicit recovery;
- content-bound approvals and evidence before completion;
- thin Claude Code and Codex adapters around one embedded runtime.

## Deliberate identity changes

| Source identity | Kratos identity |
| --- | --- |
| Mestre Yoda | Kratos |
| `yoda` command | `kratos` command |
| `runtime/yoda.mjs` | `runtime/kratos.mjs` |
| `@mestre-yoda/*` | `@kratos/*` |
| `YODA_*` environment variables | `KRATOS_*` environment variables |
| Mestre Yoda managed markers | Kratos managed markers |

Source repository URLs in backlog references are intentionally retained so
that every inherited requirement can be audited.
