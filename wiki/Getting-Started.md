# Getting started

This page covers source-first development. Kratos does not currently advertise
a public production release or a global package install.

## Prerequisites

- Git
- Node.js 24.18.0 or later within major version 24
- npm 11.16.0 for repository development

The current source snapshot pins its contributor toolchain more narrowly than
the distributed runtime minimum. Use the repository pins when developing.

## Build from source

From a clean checkout:

```bash
npm ci
npm run build
npm run kratos -- help
npm run package:verify
```

The build writes to `${KRATOS_BUILD_OUTPUT}` when set, otherwise to the
operating-system temporary directory. It refuses to create a generated `dist`
tree inside the source checkout.

Expected package layout:

```text
kratos-plugin-build/
├── .agents/plugins/marketplace.json
├── .claude-plugin/marketplace.json
├── codex/
└── claude-code/
```

Each host package includes an executable ESM runtime at
`runtime/kratos.mjs`. The application project does not receive TypeScript,
runtime source, `node_modules`, or internal build files.

## Run the built CLI

The repository helper selects the Codex package by default:

```bash
npm run kratos -- version
npm run kratos -- handshake --json
npm run kratos -- help
```

Set `KRATOS_HOST=claude-code` to exercise the Claude Code package.

## Full verification

The intended repository gate is:

```bash
npm run verify
```

The analyzed workspace is not currently a clean full-gate baseline. Known
contract-generation, CI-contract, workflow retry, and extension-test drift are
tracked in [Project status and roadmap](Project-Status-and-Roadmap.md). The
build, CLI help, and package verification pass independently.

## Install a temporary local package

Follow [Installing Kratos](../docs/INSTALLATION.md) for Codex marketplace,
Claude Code marketplace, direct plugin-directory, initialization, update,
rollback, and uninstall instructions.

Those instructions describe local development packages. A successful local
package check is not evidence that signed-in host E2E or a public release has
completed.

## Next steps

1. Read [Architecture](Architecture.md) to learn the runtime boundaries.
2. Read [Development trail](Development-Trail.md) before operating project state.
3. Use the exact [command reference](../docs/user/commands.md).
4. Review [Security model](Security-Model.md) before using a sensitive project.

