# Quickstart

## Requirements

- Node.js 24.18.0
- npm 11.16.0
- Git
- Claude Code, Codex, or direct runtime use

Build a clean checkout:

```sh
npm ci
export KRATOS_BUILD_OUTPUT=/absolute/temporary/path/kratos-plugin-build
npm run build
npm run package:verify
```

Add the built packages as a local Codex marketplace:

```sh
codex plugin marketplace add "$KRATOS_BUILD_OUTPUT"
```

Install Kratos from `/plugins`, then start a new session. For Claude Code, use
`claude plugin marketplace add "$KRATOS_BUILD_OUTPUT"` followed by
`claude plugin install kratos@kratos-open-source`.

Inside a Git project, initialize the managed surfaces and start a trail:

```sh
"$KRATOS_BUILD_OUTPUT/codex/runtime/kratos.mjs" init --host codex --root .
"$KRATOS_BUILD_OUTPUT/codex/runtime/kratos.mjs" objective "Add auditable invoice approval"
"$KRATOS_BUILD_OUTPUT/codex/runtime/kratos.mjs" start --run-id invoice-approval --host codex
"$KRATOS_BUILD_OUTPUT/codex/runtime/kratos.mjs" status
```

Advance only after recording the artifacts and evidence requested by the
current phase:

```sh
"$KRATOS_BUILD_OUTPUT/codex/runtime/kratos.mjs" evidence record evidence-1 ./test-results.json --kind test --classification internal --redaction none
"$KRATOS_BUILD_OUTPUT/codex/runtime/kratos.mjs" continue --complete --artifact ./spec.md --evidence evidence-1 --expected-revision 1
"$KRATOS_BUILD_OUTPUT/codex/runtime/kratos.mjs" doctor
"$KRATOS_BUILD_OUTPUT/codex/runtime/kratos.mjs" explain gate.aprovacao_spec
```

The exact `done` inputs depend on the active run and final approval. Ask the
installed Kratos skill to report status, run doctor, and show help before
completing it.
