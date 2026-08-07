# Command Routing and Structured Output Rendering Design

Issue [#17](https://github.com/thiagocorreanet/mestre-yoda/issues/17) (`RUN-02`).
Epic [#15](https://github.com/thiagocorreanet/mestre-yoda/issues/15).
Depends on [#11](https://github.com/thiagocorreanet/mestre-yoda/issues/11) (`CMP-03`)
and [#16](https://github.com/thiagocorreanet/mestre-yoda/issues/16) (`RUN-01`).

## Problem

The runtime dispatches commands with a positional chain of conditionals in
`packages/runtime/src/cli.ts`. `--expect` is honored only when it occupies the
first argument. The help text is a hand-written constant that no parser reads.
The single failure path writes one unstructured English sentence to stderr and
returns exit 2 without a reason code, evidence, or recovery instruction.

Every command issue that follows would extend that chain. Each would carry its
own idea of how a flag is parsed, what an unknown operand does, which stream a
diagnostic lands on, and what a usage failure looks like to a caller. That
drift is the failure this issue exists to prevent, and it is far cheaper to
prevent before thirty commands exist than to reconcile afterwards.

The universal result contract already specifies the outcome envelope, the exit
classes, and both rendering modes. Nothing in the runtime produces one.

## Goal

One validated invocation pipeline that every command shares. Parsing, usage
text, and help all derive from a single declarative table, so they cannot
disagree. Every outcome renders through the universal result contract in either
JSON or human form, and no command writes to a stream on its own.

## Non-goals

- Any workflow command: `init`, `objective`, `start`, `continue`, `done`, and
  the rest belong to `SDD-*`, `MIG-*`, and `OBS-*`.
- Project discovery and `.brain` configuration resolution (`RUN-03`).
- The schema registry and validation boundary (`RUN-04`).
- Transactions, the event store, and leases (`RUN-05` through `RUN-07`).
- The host adapter protocol (`ADP-01`).
- Byte parity with the frozen Go v3 help text. The help output is generated
  from the registry, so it matches only once the registry is complete.
- The `--require-contract` global flag. The inventory records that it runs a
  compatibility check before dispatch, and its only legacy reference is
  `cmd/yoda/contrato.go`, whose provenance is hash-only. Which contract family
  it pins is not derivable from the frozen evidence, and `CMP-04` does not
  answer it either. Implementing it would mean inventing a public contract, so
  it stays an unknown flag and returns a usage failure until an authorized
  oracle observation settles the behavior.

## Decisions

### D1: A command is data, not a class

Each command is a specification value:

```ts
interface CommandSpec {
  readonly path: readonly string[]; // ["ac", "check"] covers "ac check" and "ac.check"
  readonly summary: string; // one line; help is generated from it
  readonly flags: readonly FlagSpec[];
  readonly positionals: { readonly min: number; readonly max: number };
  readonly jsonContract: JsonContractId;
  readonly handler: CommandHandler;
}
```

One generic parser consumes the specification. Help output, usage lines, and
flag validation are functions of the same table, so a new flag appears in the
help because it exists in the specification rather than because someone
remembered to document it.

The alternative, a class per command with its own `parse` method, gives every
command a private parser. That is precisely how commands drift in flag
handling and usage text, and it leaves the help text as a second, unverified
description of the surface.

### D2: Five pure stages, effects only at the edge

```text
argv -> parseGlobals -> resolveCommand -> parseCommand -> checkContracts -> dispatch
                                                                              |
                                       any stage may end the run with a result |
                                                                              v
                                            composition: applyPlan(ports) -> render -> exit
```

Every stage is a pure function in `domain`, testable in isolation. The handler
returns a `Decision { result, plan }` and performs nothing. The composition root
applies the effect plan through ports and only then renders.

This ordering is what makes the "no state change on a usage error" criterion
structural. A usage result is produced before any `applyPlan` call exists, so a
malformed argument cannot reach an effect. It is not a rule a reviewer has to
remember to check.

### D3: Global flags are parsed at any position

`--expect`, `--json`, `--help`, `-h`, and `--version` are extracted from
anywhere in `argv` before the command token is resolved.

`--help`, `-h`, and `--version` are normalized into the `help` and `version`
commands rather than handled as flags with their own output path. They are
spellings of a command, so they resolve to one handler, one rendering, and one
place where their behavior is defined.

The `CLI-GLOBAL-EXPECT` inventory row requires the compatibility check to apply
"regardless of argument order", which the current first-position handling does
not satisfy.

Compatibility checking runs after parsing and before dispatch. A pinned version
that does not match therefore fails even for an unknown command, and it always
fails before a handler has begun.

### D4: JSON mode is one global flag

Go v3 exposed `--json` only on `dashboard`. The acceptance criterion requires
every command to produce schema-valid JSON, so the flag becomes global.
`dashboard --json` stays valid as a consequence of that rule rather than as a
special case.

This is an additive difference from the predecessor and is documented as one. No
environment variable selects the mode. A host adapter controls the argument
vector it invokes, so a second source of truth with a precedence rule would buy
nothing.

### D5: JSON mode emits one object whose schema the command declares

The result envelope has ten fixed fields and no payload field, and its schema
rejects unknown properties. A command that must return data has nowhere to put
it. The shipped `handshake` command already emits an `AdapterMessageV1`, which
is not a result envelope and has its own published schema.

So JSON mode emits exactly one object, and the specification declares which
contract it satisfies. `handshake` declares `adapter-message@1.0.0`, which makes
explicit what already ships. Everything else declares `result@1.0.0`.

Because the declaration is data, it is verifiable: a test walks the registry,
asserts every declared contract has a schema file, and validates real output
against it. A shape decided inside a handler cannot be checked that way.

Command data is referenced, never embedded, which is the rule the contract
already applies to evidence. That is what stops `status` from becoming a second
unversioned payload channel.

### D6: Failure always renders the result envelope

The declared contract applies to success only. Any failure or blocked outcome
renders the universal result envelope regardless of what the command declared.
A caller needs one rule: a non-zero exit means a result envelope.

### D7: No new reason code

Catalog revision 1.2 already covers this pipeline. `trail.uso` is the frozen
usage reason, with exit 2, forbidden evidence, and the recovery text already
written. It covers an unknown command, an unknown flag, a missing flag value,
and wrong arity. The `contract.plugin_version_*` reasons cover `--expect`, and
are what `classifyExpectedVersion` already returns. An unanticipated throw
becomes `runtime.internal_failure` at the edge.

Adding a reason code would mean a catalog revision, and this issue introduces no
outcome the catalog cannot already name.

### D8: The runtime owns a second renderer, proven equivalent

`scripts/lib/result-contract.mjs` renders the contract today using Ajv and
schema files read from disk. The embedded bundle can do neither: it is
self-contained and its published inventory is three files.

The runtime therefore validates against the reason catalog already bundled
through `@mestre-yoda/contracts`, which imports it as a JSON module. An
equivalence test requires byte-identical output from both renderers across the
six canonical fixtures and generated permutations. This is the shape `RUN-01`
used for ports: two implementations, one suite, and any divergence fails
immediately.

Making the script consume the built bundle instead would remove the duplication
but couple contract verification to the build and invert the current order of
`npm run verify`.

### D9: Rendering returns text; only the composition root writes

`renderResult` is a pure function returning `{ stdout, stderr, exitCode }`. The
composition root passes that text to the `Output` port. Nothing in `domain`
holds a stream, so a rendering test asserts returned strings instead of
capturing process output.

### D10: `handshake` has no human rendering

Every other command renders a summary line in human mode. `handshake` emits its
adapter message in both modes, because it is a machine operation with no human
form and its message is already published that way. It is the single exemption,
tested as one rather than left as an accident.

The alternative, rendering the summary its payload already carries, would be
more uniform and would change a shipped surface for a consumer that does not
exist yet. `ADP-01` owns the adapter protocol and may revisit it with the
protocol in hand.

### D11: The registry holds only implemented commands

It starts with `help`, `version`, and `handshake`, plus the `-h` and `--help`
aliases the inventory names. Each later issue registers its own command.

Reserving the thirty Go v3 names now would publish a surface that does nothing,
which the repository's honesty rule rejects. An unregistered name is an unknown
command and returns `trail.uso`.

## Components

| Unit | Responsibility |
| --- | --- |
| `domain/cli/spec.ts` | `CommandSpec`, `FlagSpec`, and registry types |
| `domain/cli/parse.ts` | Global flags, command resolution, and flag parsing |
| `domain/cli/help.ts` | Help and usage text generated from the registry |
| `domain/cli/dispatch.ts` | Registry lookup and handler invocation |
| `domain/result/render.ts` | JSON and human rendering of the result contract |
| `domain/result/validate.ts` | Envelope and catalog agreement without Ajv |
| `composition/cli.ts` | Stage wiring, plan application, and exit code |
| `packages/runtime/src/cli.ts` | Thin entry point over the composed pipeline |

## Error handling

Expected failures are values, not exceptions. Every stage returns either its
output or a result, so the pipeline has one exit path per outcome class.

An unexpected throw is caught at the composition edge and rendered as
`runtime.internal_failure`, which the catalog already defines as sanitized. No
stack trace, no message text from the original error, and no argument value
reaches a stream.

Arguments are never echoed. The current entry point already refuses to echo, for
the reason its comment gives: a misordered `--expect` is exactly how a supplied
version value or an absolute path would reach public output. The design keeps
that rule and makes it a test rather than a comment.

## Testing

| Level | Proves |
| --- | --- |
| Parsing table | Every exit category, alias, nested form, and flag error |
| Help snapshot | Generated help stays stable and matches the registry |
| Schema validation | Every registered command validates against its declared contract |
| Renderer equivalence | Both renderers emit identical bytes for every fixture |
| Non-mutation | Usage failures invoke no writing port |
| Output safety | No argument value reaches stdout or stderr in either mode |
| Determinism | Two runs of one argument vector emit identical bytes |

The output-safety test feeds an argument vector containing an absolute path, a
credential-shaped token, and control characters, then asserts none of it appears
in either stream.

The help snapshot must be proven non-vacuous. Registering an extra command in a
test registry has to break it, because a snapshot that passes for any registry
proves nothing. This mirrors the non-vacuity proof `RUN-01` required of the
architecture test.

## Compatibility impact

Parity remains `0 / 400 (0.00%)`. No inventory row moves.

`CLI-HELP` is the row it would be tempting to claim. It requires the frozen Go
v3 help sections, and the generated help lists the three commands that exist. It
will match when the registry is complete. Recording it as an intentional
difference would credit the row in the parity count, which would be false.

One observable behavior changes: `--expect` is now accepted at any position
rather than only the first. That moves toward `CLI-GLOBAL-EXPECT`, which asks
for exactly that, and accepting more input than before breaks no existing
caller.

## Open decisions recorded rather than deferred

**Where the registry lives.** Inside `packages/runtime/src/domain/cli/` rather
than a new package. The only consumer is the runtime, and `ADP-01` may extract
it when a second consumer genuinely exists.

**Coverage.** The parser, help generator, dispatcher, renderer, and validator
join the 100% coverage gate. They are pure, small, and fully reachable, so the
gate costs nothing artificial.

**The `-h` alias.** Implemented now, because `CLI-ALIAS-H` names it and the cost
is one entry in the alias table. `help` as a bare command word is registered
alongside it, so all three spellings resolve to one path.
