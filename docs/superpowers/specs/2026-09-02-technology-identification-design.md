# Technology Identification From a Bounded, Name-Only Scan Design

Date: 2026-09-02
Status: APPROVED
Issue: `ADP-07`
Dependencies: `ADP-04a` (initialization interview, scoped rules, permission provenance), `ADP-08` (project profile)

## Problem and outcome

`kratos init` could not tell what a project was written in unless the project
was one of thirteen recognized shapes, and only when the deciding file sat
directly at the repository root. Elixir, Swift, Dart, Scala, Clojure, Haskell,
C, C++, Zig, Lua, R, Julia, Perl, Deno, and Bun all reported no stack with
their manifest in plain sight; a `.NET` solution under `src/Api/` reported
nothing at all. Growing the marker list moves the boundary and leaves the next
language exactly as invisible.

The narrowness was deliberate and its reasoning stands: reading file contents
would make detection depend on parsing every manifest format the world has, and
a wrong parse is worse than an unrecognized project, because it names a stack
confidently and gets it wrong. Detection stays offline, deterministic, total,
and based on names rather than contents. This design does not add manifest
parsing.

It also states the constraint plainly: there is no detection without a table.
Something always maps evidence to a technology name. What changes is how wide
that table is, and what happens when it misses.

## Two layers, two questions

**Layer 1, a language census.** Source files are counted by extension across
the scanned tree and reported as languages ordered by file count. `.cs` is C#,
`.ex` and `.exs` are Elixir, `.swift` is Swift. The mapping is a large public
table, it reads no file contents, and it answers what the project is written
in — including for a project with no build system at all.

**Layer 2, toolchain markers.** The existing marker approach, extended with the
manifests the first list omitted (`mix.exs`, `pubspec.yaml`, `Package.swift`,
`build.sbt`, `deps.edn`, `CMakeLists.txt`, `deno.json`, `bun.lockb`,
`setup.py`, `Pipfile`, `settings.gradle`, and the rest of the common set). It
answers how the project is built, tested, and installed, which is what
generates rules files and derives toolchain permissions.

The two are not the same question. A repository can have a language with no
recognized toolchain, such as loose scripts, or a toolchain with no source yet,
such as a freshly scaffolded project. `StackProfile` reports `languages` and
`stacks` as separate fields so it can say either.

**When neither matches**, the profile reports the evidence instead of nothing:
the extensions the scan saw and the entries at the root, bounded in count.
`unrecognized` stays a valid, non-failing answer, and it stops being an empty
one.

## The scan

`observeRepositoryEvidence` (composition) walks breadth-first from the project
root through `SCAN_MAX_DEPTH` directory levels with a `SCAN_MAX_ENTRIES`
budget, listing names and asking only whether each entry is a directory.
`SCAN_EXCLUDED_DIRECTORIES` — `.git`, `.brain`, `node_modules`, `vendor`,
`target`, `dist`, `build`, `bin`, `obj`, `.venv`, and their peers — are never
entered, so a vendored dependency tree cannot be reported as the project's own
language. Breadth-first is what makes a spent budget degrade honestly: the
shallow part of the tree is complete, and the profile says it is partial rather
than implying a language is absent when the walk never reached it.

Evidence is a project-relative path, so a reader can check any verdict. A root
marker is preferred over a nested one for the same technology; ties break on
depth, then on the path itself, in a locale-neutral order.

`profileStack` stays pure: it is handed a listing and reaches no disk, no
clock, and no network. The same tree yields the same profile on any machine,
and the exclusion rule is applied again inside it, so a listing that arrived
from somewhere else cannot smuggle a dependency tree into the census.

## What the change preserves

- Rules files and permissions remain keyed by toolchain identifier, and every
  identifier the marker tables can name has an entry in both tables. The
  provenance rule in `permissions.ts` is unchanged: no permission exists
  without a detected marker or an explicit answer.
- `kratos init` and `kratos doctor` observe the same evidence, so the rendered
  `stack-profile.md` and doctor's fresh rendering still compare byte for byte.
- Adding a language to the census requires adding a row to the extension table
  and nothing else; the classifier never asks what is in it.
