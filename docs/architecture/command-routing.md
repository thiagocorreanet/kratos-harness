# Command Routing and Structured Output

Every implemented command enters one pipeline. A command does not parse its own
flags, write a stream, apply an effect, or choose a private failure shape.

The registry currently contains `handshake`, `help`, `init`, `objective`, and
`version`, plus the eight retired phase names below. Workflow commands remain
absent until their owning issues implement them.

## Pipeline

```text
argv
  -> parse global flags
  -> check the pinned plugin contract
  -> resolve the registered command
  -> parse declared flags and positionals
  -> dispatch a pure handler
  -> validate the decision
  -> apply its effect plan
  -> render and publish
```

Parsing produces either a validated invocation or a universal result that ends
the run. Unknown commands, unknown flags, missing values, and invalid arity
therefore stop before dispatch. No effect plan exists on those paths, so a usage
failure cannot change state.

The embedded entry point validates the Node interpreter before the bundle
loads. The routing pipeline then validates the optional plugin-version pin
before interpreting a command. The current read-only registry declares no
project or host environment prerequisite and reads no ambient environment.

A handler returns a result and an ordered effect plan. The composition root
validates the result before applying that plan. It is the only routing code that
may apply effects or write output.

## Command registry

One declarative command specification owns:

- its token path and one-line summary;
- accepted flags and positional arity;
- the JSON contract its successful output satisfies;
- its pure handler.

The parser, usage lines, and complete help text read that same specification.
Adding a flag to a private parser while forgetting the help text is therefore
not possible.

Only implemented commands are registered. Reserving workflow names with empty
handlers would publish a capability the runtime does not have.

## Retired phase commands

`auto`, `code`, `eval`, `next`, `prd`, `review`, `run`, and `spec` once selected
a phase directly. Mestre Yoda v3 drives one agent trail and the runtime selects
each phase from persisted state, so none of them selects anything now.

They are registered anyway. A script, a habit, or an agent still spells them,
and answering "not registered in this runtime" tells that caller nothing about
where the capability went. Refusing under the name that was asked for does.

Each one refuses with `trail.uso` and exit 2, names itself, and states that
phases are not chosen by invoking a command. It plans no effect and reports no
state change, so a retired name cannot become the manual phase control it
exists to refuse. The refusal declares no prerequisite: it does not depend on
where the caller stands, so it is the same answer inside a project and outside
one.

Help publishes them under a separate `Retired commands:` heading. Listing them
beside the working commands would advertise the phase control they refuse;
omitting them entirely would leave the caller back at the generic answer.

This is not a parity claim about the legacy text. The frozen inventory records
the eight names and nothing else about them -- no flags, no message, no exit
code -- so a name that once took flags now fails on an unknown flag before the
refusal is reached, with the same `trail.uso` reason and a different cause. What
the legacy runtime printed needs a differential capture, which is `CMP-05`.

## Global flags and aliases

`--expect <version>` and `--json` are global and may occur anywhere in the
argument vector. A conflicting repeated version pin is a usage failure. A pin
that does not match the installed plugin fails before command resolution, and
its supplied value is never echoed.

`--help`, `-h`, and `--version` are normalized into the `help` and `version`
commands. They do not own separate rendering paths. When no command is supplied,
the router selects `help`.

`--require-contract` remains deliberately absent. Frozen evidence proves the
legacy flag existed but does not establish which independent contract family it
pinned. Accepting it would invent a compatibility rule.

## Result and output rules

JSON mode emits exactly one newline-terminated object. Each command declares
the schema of its successful object:

| Command | Success contract |
| --- | --- |
| `help` | `result@1.0.0` |
| `version` | `result@1.0.0` |
| `handshake` | `adapter-message@1.0.0` |

A non-zero exit always emits `result@1.0.0`, regardless of the command's success
contract. JSON output uses stdout and leaves stderr empty.

Human success output uses stdout. Human failure output leaves stdout empty and
writes concise labeled lines to stderr: summary, causes, reason, evidence,
state-change claim, retry policy, and recovery action.

`handshake` is the one human-mode exemption. It is a machine operation and emits
its adapter message in both modes.

The router can publish these reason families:

- `runtime.orientation_ok` for successful read-only orientation;
- `trail.uso` for command and argument usage failures;
- `contract.plugin_version_invalid` and
  `contract.plugin_version_unsupported` for a rejected version pin;
- `runtime.internal_failure` for an unexpected condition caught at the
  composition boundary.

Catalog revision `1.3.0` added `runtime.orientation_ok`. No frozen reason
truthfully described successful read-only output: `trail.ok` requires evidence
and represents a committed mutation.

## Safety and determinism

Public result text is validated before publication. Paths, URLs, credentials,
stack traces, control characters, and non-canonical envelopes are refused.
Unexpected exceptions use fixed catalog-owned prose; the caught message never
reaches either stream.

Tests prove that hostile argument values reach neither stream, every registered
command satisfies its declared JSON schema, repeated invocations emit identical
bytes, and usage failures apply no filesystem effect. The embedded renderer is
byte-equivalent to the published contract verifier for every canonical fixture
and generated cause/evidence permutations.

## Compatibility

The generated help lists only the commands implemented today, so it does not yet
satisfy the frozen Go v3 `CLI-HELP` surface.

The eight `CLI-RETIRED-*` rows move to `in_progress` with unit evidence. None
moves to `parity`: the inventory establishes that these names exist and are
retired, not what the legacy runtime answered when one was invoked. Parity
remains `0 / 400 (0.00%)` until executable differential, integration, and
end-to-end evidence proves a complete predecessor surface.
