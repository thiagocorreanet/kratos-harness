# Embedded runtime distribution contract

Claude Code and Codex invoke a runtime owned by the installed Kratos plugin
against an arbitrary project working directory. There is no global executable,
project `node_modules`, or project-local copy of the motor.

## Build boundary

Kratos is an open-source, source-first repository. `scripts/build.mjs` requires
an absolute output outside the checkout and stages two independent packages:

```text
kratos-plugin-build/
  codex/
  claude-code/
```

The default output is the operating system temporary directory. The repository
never receives a generated `dist` tree.

## Host package layout

Each host package has its own manifest and adapter assets, plus the same
embedded runtime:

| Path | Role |
| --- | --- |
| `runtime/kratos.mjs` | small interpreter preflight and executable entry |
| `runtime/kratos.core.mjs` | stable import bridge to the modular motor |
| `runtime/source/` | emitted dependency-free JavaScript, contracts, catalogs, and schemas |
| `runtime/manifest.json` | host identity, versions, roots, and integrity digests |
| `runtime/THIRD-PARTY-NOTICES.txt` | explicit redistributed-code statement |

Codex assets live at the Codex package root. Claude Code assets follow its
`.claude-plugin/`, `agents/`, `hooks/`, and `skills/` conventions. A package
contains only one host's assets.

The host skill is deliberately thin. It locates `runtime/kratos.mjs` relative
to the installed plugin, performs the handshake, supplies an explicit project
root, and relays the runtime result unchanged. It does not implement workflow
policy, schemas, transitions, gates, approvals, or evidence rules.

Both packages also receive the same
`skills/kratos/scripts/project-profile-relay.mjs`. It exposes one canonical
ten-question initialization interview and shapes keyed leaf answers without
validating, defaulting, or inferring them. Package verification imports each
copy and exercises contract-valid scalar, array, not-applicable, and unresolved
answers through installed initialization. The cross-host equality proof lives
in `tests/project-profile-relay-distribution.test.ts`, which compares persisted
values and rendered bytes from both packages directly.

## Why the boot is split

`runtime/kratos.mjs` checks the Node.js interpreter before dynamically importing
`runtime/kratos.core.mjs`. A JavaScript module is parsed before its code runs;
keeping the preflight separate lets an older supported parser receive a
structured `runtime.node_unsupported` result instead of a bundle syntax error.

The supported floor is Node.js 24.0.0. The preflight does not search `PATH`,
re-execute itself, echo a rejected version, or expose a local path. An entirely
absent interpreter is the host adapter's responsibility because no runtime code
can execute in that case.

## Plugin root and project root

Two roots must never be confused:

| Root | Resolved from | Holds |
| --- | --- | --- |
| Plugin root | `import.meta.url` | motor, contracts, schemas, manifest, host adapter |
| Project root | explicit `--root` or validated discovery | project state, evidence, managed instructions |

One installed plugin can therefore serve any number of unrelated projects.
Paths with spaces and Unicode are part of the test surface.

## Project materialization boundary

Initialization may create `.brain/`, managed instruction sections, and bounded
host-facing project configuration. It must never create or copy:

```text
node_modules/
packages/
runtime/
*.ts
*.map
```

Internal engine skills remain in the installed host plugin. The project gets
only what its users and agents need to operate that project.

## Integrity manifest

`runtime/manifest.json` records the runtime core digest, the complete modular
runtime tree digest, the host-assets digest, the minimum Node version, and the
result, reason-catalog, state, and host contract versions. Codex and Claude Code
artifacts carry identical runtime content but distinct host identities and
host-assets digests.

The installer verifies these digests before staging, before activation, and
when inspecting an existing installation. Updates are atomic and retain one
verified rollback directory until the operator commits or rolls back.

## Version pinning and handshake

`--expect <version>` rejects malformed or unsupported plugin versions before
an operation runs. `handshake --json` reports the plugin, result, reason
catalog, state, and host contract versions. Host identity remains observed data
rather than a model-supplied guess.

## Verification

`npm run package:verify` performs the release-level black-box proof:

1. validate both package inventories, manifests, digests, and host runtime
   paths;
2. reject symbolic links, TypeScript, source maps, and dependency trees;
3. install each package through the actual atomic installer;
4. execute version and handshake from the installed package;
5. initialize a clean Git project per host;
6. assert that no motor or engine dependency reached either project;
7. execute the canonical project-profile relay and reject changed questions or
   value mapping;
8. record an objective, start revision 1, and read the resulting status.

This is the executable enforcement of the
[installation boundary](../architecture/installation-boundary.md).
