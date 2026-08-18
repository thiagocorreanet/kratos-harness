# Design

## Architecture summary

One pure domain module owns feature document definitions and inspection.

## Data model

Each definition carries an identifier, title, section depth, required sections, and template bytes.

## Interface surface

Initialization reads definitions; composition passes an inspection fact to the gate.

## Integration points

The existing durable filesystem port reads the active PRD during observation.

## Trade-offs

| Decision | Benefit | Cost | Rejected alternative |
| --- | --- | --- | --- |
| Embedded templates | Pure deterministic generation | Longer source literals | Runtime template file reads |

## Risks

Fenced examples could look like headings, so inspection ignores fenced blocks.
