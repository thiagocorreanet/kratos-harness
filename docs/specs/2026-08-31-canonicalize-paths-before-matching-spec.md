# Objective Spec: Canonicalize Every Path Before Matching

Date: 2026-08-31
Status: DONE
Approval source: GitHub issue #146 and approved plan

## 1. Problem and outcome

A path pattern rule or security guard is only as strong as the agreement between
the spelling the rule was written in and the spelling the caller supplies. Any
rewritten path containing `/./`, doubled separators `//`, or `..` parent segments
can produce relative paths that bypass configured globs, allowlists, or denylists.

Every path is reduced to one canonical spelling through pure lexical normalization
before it is matched against any rule, guard, or policy. A path that resolves outside
the project root is refused immediately with a stable reason code rather than falling
through to pattern matching.

## 2. Published rule and single canonicalizer function

The canonical path form is defined by:
- A slash-separated, project-relative path.
- No leading `./`, no duplicate slashes `//`, no `.` or `..` segments.
- Empty string `""` represents the project root itself.
- Rejection of Windows drive letters (`C:`), URL schemes (`file:`, `http:`, etc.),
  backslashes (`\`), and control characters (0x00-0x1F, 0x7F).

The single canonicalizer function used across all surfaces is:
`canonicalizeProjectPath(target: string, options?: CanonicalizeOptions): CanonicalPathResult`
located in `@kratos/runtime/domain/paths`.

## 3. Lexical normalization guarantees

- **Zero filesystem access:** Normalization performs no filesystem operations and
  gives identical answers regardless of whether the path exists on disk.
- **Process independence:** The result does not depend on `process.cwd()`.
- **Root containment:** Paths that climb above the project root with `..` segments
  or point outside via absolute paths are refused with reason code `guard.path_escape`
  and report the resolved path in the refusal.
- **Invalid characters and encodings:** Control characters, null bytes, backslashes,
  and uninspectable structures are refused with reason code `guard.target_uninspectable`.

## 4. Case-sensitivity rule

Glob and path matching across Kratos rules and feature scope are **case-sensitive**
by design. For filesystem collision detection on case-insensitive filesystems,
the transaction manager maintains distinct case-insensitive collision keys
(`collisionKey` / `managedPathCollisionKey`).

## 5. Scope and surfaces

The following surfaces strictly canonicalize paths before evaluation:
1. `decideWriteTarget` in `@kratos/runtime/domain/write-guard`
2. `isManagedPathShape` in `@kratos/runtime/domain/transactions/surface.ts`
3. `nodeTargetInspector` in `@kratos/runtime/infra/node`
4. Structural enforcement in `tests/architecture.test.ts` ensuring path-matching
   surfaces import and invoke the canonical path normalizer.

## 6. Verification and test evidence

- Property tests proving idempotency (`canonicalize(canonicalize(p)) === canonicalize(p)`).
- Property tests proving identical rule decisions for all equivalent spellings.
- Unit and regression tests for `/./`, `//`, `..`, URL schemes, outside roots,
  and control characters.
- Architectural boundary tests asserting that matching surfaces import the normalizer.
