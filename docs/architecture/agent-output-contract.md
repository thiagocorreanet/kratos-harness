# Agent output contract

Issue [#129](https://github.com/thiagocorreanet/kratos-harness/issues/129)
defines what a phase agent produces, so an agent reply enters the runtime as
typed, validated data instead of prose somebody has to scrape.

Issue [#113](https://github.com/thiagocorreanet/kratos-harness/issues/113)
covers the other direction: what the host tells the runtime about a session.
This contract follows its envelope conventions and adds nothing to them.

## The machine block

An agent reply is Markdown written for a person. Exactly one machine block is
appended to it, delimited by two lines that have no meaning in Markdown:

```text
===KRATOS-AGENT-OUTPUT-V1===
{ "contractVersion": "1.0.0", "hostContract": "1.0.0", ... }
===END-KRATOS-AGENT-OUTPUT-V1===
```

The rules the extractor enforces:

- each delimiter is recognized only as a whole line with no indentation;
- exactly one opening and one closing delimiter may appear in a reply;
- the closing delimiter is the last thing in the reply, and only whitespace may
  follow it;
- between them is one JSON object.

The delimiter is deliberately not a Markdown fence. A reply may contain fenced
examples, including fenced JSON, and a fence-shaped delimiter would make the
extractor's answer depend on what the surrounding prose happened to illustrate.
A reply that repeats a delimiter, for instance inside an example of this very
contract, is refused rather than guessed at.

Line endings are normalized before the delimiters are matched, so a host that
writes CRLF and a host that writes LF extract the same block.

## Envelope

Every block fixes:

- `contractVersion` and `hostContract`, validated before the payload;
- `agent`, one of `prd`, `spec`, `plan`, `code`, `review`, `acceptance`;
- `outcome.status`, one of `completed`, `awaiting-input`, `blocked`;
- `outcome.next`, the routing hint: `proceed`, `wait`, `retry`, `finish`, or
  `stop`;
- `outcome.questions`, the blocking questions, as objects a host renders;
- `outcome.blockers`, why the agent stopped;
- `artifacts`, the specification documents the agent wrote;
- `changedFiles`, the source and test files it touched, each with its change;
- `payload`, chosen by `agent`.

The routing hint is a hint. The runtime decides; an agent that says `proceed`
past a failing gate is describing its own view, not authorizing a transition.

Status and hint have to agree, and the schema enforces it: `completed` routes
to `proceed` or `finish` and carries no questions and no blockers;
`awaiting-input` routes to `wait` and carries at least one question;
`blocked` routes to `retry` or `stop` and carries at least one blocker.

`artifacts` and `changedFiles` stay separate fields. The scope check reads the
difference between a document the agent wrote and a source file it edited, and
a block that claims one path as both is refused.

A question is an object, not a formatted string: a `questionId`, a `prompt`, a
`kind` of `free-text`, `single-choice`, or `multiple-choice`, and `options`
carrying an identifier and a label each. A choice question requires at least
two options; a free-text question carries none. Every host renders the same
object into whatever prompt widget it has.

## Payloads

One closed payload per phase agent, selected by the `agent` discriminator, each
with `additionalProperties: false`. The document validates as one closed object
rather than as a union of six, so a refusal names the offending path instead of
the document root.

| Agent | Payload |
| --- | --- |
| `prd` | `objective`, `requirementIds`, `gapIds` |
| `spec` | `requirementIds`, `gapIds`, `approvalRequired` |
| `plan` | `steps`, each with `stepId`, `summary`, `dependsOn` |
| `code` | `stepId`, `testsAdded`, `testsPassed` |
| `review` | `verdict`, `findings` with severity and reference |
| `acceptance` | `verdict`, `criteria` with outcome and evidence reference |

## Extraction, validation, recording

`kratos agent record REF` runs three steps in this order and never reorders
them:

1. **Extract.** Three exits: no block found, a block found that is not usable
   before parsing, or a block. The second exit names which rule broke, from
   `duplicate-open` to `invalid-json`.
2. **Validate.** The extracted document is checked against
   `host.agent-output@1.0.0` through the schema registry, then against the
   agreements the schema cannot state: a path claimed as both artifact and
   changed file, a repeated question, option, or step identifier, a dependency
   on a step the plan does not contain, a review that passes while carrying a
   high finding, a repeated acceptance criterion identifier, and an acceptance
   that accepts while a criterion did not pass. Acceptance identifiers use the
   canonical `AC-<work-unit>.<task>.E?<criterion>` schema dependency.
3. **Record.** The validated block is written verbatim to
   `runs/RUN/agent-output/AGENT.json` and one `run.agent.recorded` event is
   appended. During acceptance the same atomic plan also writes one immutable
   verdict per criterion and reconciles task-document checkboxes. Recording a
   fact does not move the run through its phases.

Every refusal reports `trail.output_invalido` and names its cause. A reply with
no block, a malformed block, or a schema-invalid block all fail closed and
leave the run exactly where it was.

Extraction and validation perform no model call and no network access. The
extractor is a pure function of the reply text, and the module reaches nothing
but the published contracts and the schema types.

## Reading it back

A derived view reads `agent-output/AGENT.json` through the same contract that
admitted it, so it reads typed data rather than re-reading the reply. A
recorded document that no longer satisfies the contract fails closed rather
than reading as nothing recorded.
