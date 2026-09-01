# Installing Kratos

Kratos ships as three independent host packages built from one embedded
runtime: one for OpenAI Codex, one for Claude Code, and one for Google
Antigravity. The runtime lives inside the host-managed plugin directory and is
never copied into the project that uses Kratos.

There are two ways to obtain those packages:

- install the published archives from a GitHub release, which is what a user
  does;
- build them from a checkout, which is what a contributor does.

Both are documented below. Every host command on this page comes from that
host's own documentation; where a host publishes no command for an operation,
this page says so instead of inventing one.

## Prerequisites

- Node.js 24.18 or later within major version 24;
- `tar` and a SHA-256 checksum tool (`sha256sum`, or `shasum -a 256` on macOS);
- the [GitHub CLI](https://cli.github.com/) to download and verify release
  assets;
- Git and npm 11.16.0 only for the from-source path.

The plugin package carries no `node_modules` and needs no global Kratos binary.

## Release assets

A tagged release publishes six assets:

| Asset | Contents |
| --- | --- |
| `kratos-marketplace.tgz` | The whole build: `codex/`, `claude-code/`, `antigravity/`, and both local marketplace manifests |
| `kratos-codex.tgz` | The Codex package alone |
| `kratos-claude-code.tgz` | The Claude Code package alone |
| `kratos-antigravity.tgz` | The Antigravity package alone |
| `SHA256SUMS` | SHA-256 of each archive |
| `sbom.cdx.json` | CycloneDX software bill of materials |

Every archive is built twice inside the release job and compared byte for byte
before publication, and each one carries a GitHub build-provenance attestation.

## Download and verify

The commands below use the release tag and repository as variables so the same
block works for any version.

```bash
KRATOS_VERSION=v0.2.0
KRATOS_REPO=thiagocorreanet/kratos-harness
KRATOS_HOME=~/.kratos/releases/$KRATOS_VERSION
mkdir -p "$KRATOS_HOME/download"
cd "$KRATOS_HOME/download"

gh release download "$KRATOS_VERSION" --repo "$KRATOS_REPO" \
  --pattern 'kratos-*.tgz' --pattern 'SHA256SUMS'
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify kratos-marketplace.tgz --repo "$KRATOS_REPO"
```

`sha256sum --check` proves the bytes match what the release job measured;
`gh attestation verify` proves those bytes were produced by this repository's
release workflow. Run the attestation check against each archive you intend to
install. On macOS, replace the checksum line with
`shasum -a 256 --check --ignore-missing SHA256SUMS`.

Extract the marketplace archive once; it contains all three host packages:

```bash
mkdir -p "$KRATOS_HOME/marketplace"
tar -xzf "$KRATOS_HOME/download/kratos-marketplace.tgz" \
  -C "$KRATOS_HOME/marketplace"
```

The extracted tree is a local marketplace root for both Codex and Claude Code:

```text
marketplace/
  .agents/plugins/marketplace.json
  .claude-plugin/marketplace.json
  claude-code/
  codex/
  antigravity/
```

Before handing a package to a host, confirm the runtime inside it answers:

```bash
"$KRATOS_HOME/marketplace/claude-code/runtime/kratos.mjs" version
"$KRATOS_HOME/marketplace/claude-code/runtime/kratos.mjs" handshake --json
```

`version` prints the plugin version; `handshake --json` prints the contract
versions the package carries. Repeat for `codex/` and `antigravity/`.

## Install in Claude Code

Claude Code installs a plugin from a marketplace, and accepts a local directory
as a marketplace source.

```bash
claude plugin marketplace add "$KRATOS_HOME/marketplace"
claude plugin install kratos@kratos-open-source
```

Confirm the result with `claude plugin marketplace list` and the `/plugin`
picker inside a session. `/reload-plugins` reloads without restarting.

### Update

Download and verify the new release into its own `KRATOS_HOME`, then repoint
the marketplace. The marketplace name is the same in both releases, so the old
entry is removed first:

```bash
claude plugin uninstall kratos@kratos-open-source
claude plugin marketplace remove kratos-open-source
claude plugin marketplace add "$KRATOS_HOME/marketplace"
claude plugin install kratos@kratos-open-source
```

### Roll back

Rolling back is the same sequence pointed at the previous release directory,
which is why each release is extracted under its own version. Keep the previous
`~/.kratos/releases/<version>` tree until the new one is accepted.

### Uninstall

```bash
claude plugin uninstall kratos@kratos-open-source
claude plugin marketplace remove kratos-open-source
```

## Install in Codex

Codex adds a marketplace from a local directory:

```bash
codex plugin marketplace add "$KRATOS_HOME/marketplace"
codex plugin marketplace list
```

Codex publishes no CLI command for installing an individual plugin. Open the
plugin browser and install Kratos there:

```bash
codex /plugins
```

Select the `Kratos Open Source` marketplace, open `kratos`, install it, and
press Space to enable it. Start a new session afterwards.

### Update

```bash
codex plugin marketplace remove kratos-open-source
codex plugin marketplace add "$KRATOS_HOME/marketplace"
```

Then reinstall Kratos in `codex /plugins`. Codex also documents
`codex plugin marketplace upgrade kratos-open-source`, which refreshes a
marketplace in place.

### Roll back

Remove the marketplace, add the previous release's `marketplace` directory, and
reinstall from `codex /plugins`.

### Uninstall

Uninstall Kratos from `codex /plugins`, then drop the marketplace:

```bash
codex plugin marketplace remove kratos-open-source
```

## Install in Antigravity

Antigravity installs a plugin from a local directory rather than from a
marketplace, so use the host-specific archive:

```bash
mkdir -p "$KRATOS_HOME/antigravity"
tar -xzf "$KRATOS_HOME/download/kratos-antigravity.tgz" \
  -C "$KRATOS_HOME/antigravity"
agy plugin install "$KRATOS_HOME/antigravity"
agy plugin list
```

Antigravity stages the package under its own plugin directory and reads the
`plugin.json` marker at the package root for the plugin name, `kratos`.

### Update

```bash
agy plugin uninstall kratos
agy plugin install "$KRATOS_HOME/antigravity"
```

### Roll back

```bash
agy plugin uninstall kratos
agy plugin install ~/.kratos/releases/<previous-version>/antigravity
```

`agy plugin disable kratos` suspends the plugin without removing it, and
`agy plugin enable kratos` restores it. Prefer disabling while diagnosing a
problem, and roll back only when the previous release is the answer.

### Uninstall

```bash
agy plugin uninstall kratos
```

### What is not claimed for Antigravity

Antigravity's documented plugin manifest carries `name`, `description`, and
`$schema` and no version field, so the Antigravity package records its version
in `runtime/manifest.json` rather than in `plugin.json`. Antigravity's hook
configuration is also read from a `hooks.json` at the package root, and the
events it documents are `PreToolUse`, `PostToolUse`, `PreInvocation`,
`PostInvocation`, and `Stop`. The Kratos hook definition does not match that
shape yet, so this release does not claim working Antigravity hooks; the skill
and the runtime are what the Antigravity package delivers.

## Build from a checkout

Contributors build the same packages locally. The build refuses to write inside
the source repository, so choose an absolute output directory outside it:

```bash
git clone https://github.com/thiagocorreanet/kratos-harness.git kratos
cd kratos
npm ci
export KRATOS_BUILD_OUTPUT=/absolute/temporary/path/kratos-plugin-build
npm run build
npm run package:verify
```

If `KRATOS_BUILD_OUTPUT` is not set, the build writes to
`<operating-system-temp>/kratos-plugin-build`. The output has the same layout
as the extracted `kratos-marketplace.tgz`, so every install command above works
against it by substituting `"$KRATOS_BUILD_OUTPUT"` for
`"$KRATOS_HOME/marketplace"`.

Run the temporary build directly, which defaults to the Codex package:

```bash
npm run kratos -- help
npm run kratos -- version
npm run kratos -- handshake --json
```

Select another package with `KRATOS_HOST=claude-code` or
`KRATOS_HOST=antigravity`. Claude Code also loads a development package
directly with `claude --plugin-dir "$KRATOS_BUILD_OUTPUT/claude-code"`.

## Direct atomic staging

`scripts/install-plugin.mjs` performs verified atomic activation at an explicit
directory. It is for release assembly and controlled deployments; it does not
register anything with a host:

```bash
node scripts/install-plugin.mjs install \
  --host antigravity \
  --source "$KRATOS_BUILD_OUTPUT" \
  --target /absolute/plugin/staging/directory/kratos
```

The same script supports `update`, `rollback`, `commit`, and `uninstall` with
the same `--host` and `--target` arguments. It refuses a downgrade, keeps the
replaced version as a rollback copy until `commit`, and `uninstall` quarantines
the installation instead of deleting it. None of these operations touches
project-owned state.

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
`.brain/`, `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, and the selected bounded
host surfaces. It never copies runtime code, package sources, internal engine
skills, `node_modules`, TypeScript, or source maps into the project.

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

## Removing project state

Uninstalling a host package and deleting project state are separate decisions.
Every command above removes only the plugin. See
[Uninstall and state preservation](user/uninstall.md) for what to do with
`.brain/` and the managed host sections.

See [Atomic plugin installation](distribution/atomic-installation.md) and
[Installation boundary](architecture/installation-boundary.md) for the exact
separation of responsibilities.
