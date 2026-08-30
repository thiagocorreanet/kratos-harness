# Installing Kratos

Kratos is source-first and does not keep a generated `dist` directory in its
repository. A build creates three temporary, installable packages: one for Codex,
one for Claude Code, and one for Google Antigravity. The plugin runtime stays outside the project that uses
Kratos.

## Prerequisites

- Git;
- Node.js 24.18 or later within major version 24;
- npm 11.16.0 for repository development and the full verification suite.

The plugin runtime itself carries no `node_modules` and does not require a
global Kratos binary.

## Build and verify

Choose an absolute output directory outside the checkout:

```bash
git clone <your-kratos-repository-url> kratos
cd kratos
npm ci
export KRATOS_BUILD_OUTPUT=/absolute/temporary/path/kratos-plugin-build
npm run build
npm run package:verify
```

If `KRATOS_BUILD_OUTPUT` is not set, Kratos uses
`<operating-system-temp>/kratos-plugin-build`. The build refuses to write
inside the source repository.

The output contains three independent packages and local marketplace manifests:

```text
kratos-plugin-build/
  .agents/plugins/marketplace.json
  .claude-plugin/marketplace.json
  codex/
  claude-code/
  antigravity/
```

Each package contains its thin host adapter and a private `runtime/` directory.
Neither package is copied into an application repository.

## Run the temporary build

The repository helper defaults to the Codex package:

```bash
npm run kratos -- help
npm run kratos -- version
npm run kratos -- handshake --json
```

Select the Claude Code package with `KRATOS_HOST=claude-code` or Antigravity with `KRATOS_HOST=antigravity`.

## Install in Codex

Add the temporary build as a local marketplace:

```bash
codex plugin marketplace add "$KRATOS_BUILD_OUTPUT"
```

Open `/plugins` in Codex, select the `Kratos Open Source` marketplace, install
Kratos, and start a new session. The package follows the official
`.codex-plugin/plugin.json` and `skills/<name>/SKILL.md` layout.

## Install in Claude Code

Add the same temporary build as a Claude Code marketplace and install Kratos:

```bash
claude plugin marketplace add "$KRATOS_BUILD_OUTPUT"
claude plugin install kratos@kratos-open-source
```

Alternatively, validate a development package directly with
`claude --plugin-dir "$KRATOS_BUILD_OUTPUT/claude-code"`.

The host-managed installation receives the motor, contracts, schemas, and thin
adapter. The application project does not.

## Install in Antigravity

Add the Antigravity package or reference the temporary build in your Antigravity
configuration or CLI:

```bash
agy plugin install "$KRATOS_BUILD_OUTPUT/antigravity"
```

The Antigravity package provides the Kratos skill, workflow hooks, and thin
pre-tool-use write guards for Google Antigravity.

## Direct atomic staging

`scripts/install-plugin.mjs` is available for release assembly and controlled
deployments that need verified atomic activation at an explicit directory. It
does not register that directory with a host marketplace:

```bash
node scripts/install-plugin.mjs install \
  --host antigravity \
  --source "$KRATOS_BUILD_OUTPUT" \
  --target /absolute/plugin/staging/directory/kratos
```

## Initialize a project

Invoke the runtime from its installed plugin location. Feed the answers
contract through standard input, or place an answers file inside the target
project and pass its project-relative path:

```bash
/absolute/host/plugin/directory/kratos/runtime/kratos.mjs \
  init --host antigravity --root /path/to/project \
  < fixtures/contracts/v1/init-answers.json
```

Initialization creates or reconciles only project-facing material such as
`.brain/`, `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, and the selected bounded host surfaces.
It never copies runtime code, package sources, internal engine skills,
`node_modules`, TypeScript, or source maps into the project.

Record an objective and start a run:

```bash
KRATOS=/absolute/host/plugin/directory/kratos/runtime/kratos.mjs
"$KRATOS" objective "Implement the customer authentication API" \
  --root /path/to/project
"$KRATOS" start --root /path/to/project --run-id run-001 --host codex
"$KRATOS" status --root /path/to/project
"$KRATOS" handoff --root /path/to/project
```

The normal trail continues through artifact and evidence recording, phase
gates, content-bound approval, and `done`. Run `kratos help` through the same
installed runtime for the exact command contract.

## Update, rollback, and uninstall

The installer supports `update`, `rollback`, `commit`, and `uninstall` with the
same `--host` and `--target` arguments. `uninstall` quarantines the plugin
installation instead of deleting it immediately. None of these operations
touches project-owned state.

See [Atomic plugin installation](distribution/atomic-installation.md) and
[Installation boundary](architecture/installation-boundary.md) for the exact
separation of responsibilities.
