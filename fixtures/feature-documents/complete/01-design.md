# Design: Centralize feature documents

> Written by spec-planner (spec phase) — the HOW. Diagrams and contracts, no code.

## Architecture overview

One pure domain module owns feature document definitions and inspection.

## Data model

Each definition carries an identifier, title, section depth, required sections, and template bytes.

## API surface

Initialization reads definitions; composition passes an inspection fact to the gate.

## Integration points

The existing durable filesystem port reads the active PRD during observation.

## Trade-offs considered

| Option | Pros | Cons | Chosen? |
| --- | --- | --- | --- |
| Embedded templates | Pure deterministic generation | Longer source literals | Runtime template file reads |

## Risks

Fenced examples could look like headings, so inspection ignores fenced blocks.
