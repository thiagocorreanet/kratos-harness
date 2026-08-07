# Frozen Go v3 Oracle Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze Go v3 release `v0.6.5` as a reproducible, provenance-safe behavioral oracle without publishing private predecessor content.

**Architecture:** A public JSON catalog stores immutable Git identities, SHA-256 digests, counts, build outputs, PRD anchors, and provenance decisions. An original Node.js verifier validates the catalog offline on every pull request and can recompute hashes from explicit authorized private paths. Public evidence documents the two-build and complete legacy-suite campaign.

**Tech Stack:** Node.js 24.18.0, TypeScript/Vitest, Git, SHA-256, Go 1.23.4, Python 3.12.3.

## Global Constraints

- Freeze annotated tag `v0.6.5`, tag object `720f0a35074451208a0673324d223803add249e0`, and commit `632f1e9bb283cf83412ef3e9e0b642daefdb0784`.
- Publish no private source, prompt, schema, fixture, help prose, binary, clone URL, credential, internal path, or customer data.
- Represent every private artifact with origin, visibility, license status, publication decision, count/size, and SHA-256.
- Preserve PRD behavior as a P0 compatibility boundary with individual researcher, schema, discovery, and template anchors.
- Read private checkouts only from explicit command-line paths; never infer a home-directory location.
- Keep public CI fully offline and independent of private repository access.

---

### Task 1: Specify the public oracle catalog contract

**Files:**

- Create: `tests/go-v3-oracle-contract.test.ts`
- Create later: `compatibility/oracles/go-v3/v0.6.5/manifest.json`

**Interfaces:**

- Consumes: the approved design and issue #9 acceptance criteria.
- Produces: executable assertions for immutable identity, required captures, provenance, PRD anchors, release matrix, test evidence, and publication safety.

- [x] **Step 1: Write the failing manifest contract**

Parse the future JSON manifest and assert exact tag/commit/toolchain identity,
all required surface IDs, 64-character lowercase SHA-256 values, positive counts,
three release targets, two command outputs, four PRD anchors, complete provenance
fields, and successful Go/Python/build evidence. Recursively reject URLs,
credentials, local absolute paths, copied content, and unresolved decisions.

- [x] **Step 2: Confirm RED**

```bash
npm test -- tests/go-v3-oracle-contract.test.ts
```

Expected: FAIL because the manifest does not exist.

- [x] **Step 3: Commit the failing contract**

```bash
git add tests/go-v3-oracle-contract.test.ts
git commit -s -m "test: specify frozen Go v3 oracle catalog"
```

### Task 2: Implement the catalog and offline verifier

**Files:**

- Create: `compatibility/oracles/go-v3/v0.6.5/manifest.json`
- Create: `scripts/verify-go-v3-oracle.mjs`
- Create: `tests/go-v3-oracle-verifier.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: immutable identifiers and hashes measured from the authorized private release.
- Produces: `npm run oracle:verify` and the canonical metadata-only catalog.

- [x] **Step 1: Add the measured metadata-only manifest**

Record source/dist identities, deterministic archive groups, command-output
hashes, all three release binary hashes, installed plugin projection evidence,
PRD anchors, environment, test results, and a provenance object on every private
artifact. Store no private payload or private clone URL.

- [x] **Step 2: Make the contract GREEN**

```bash
npm test -- tests/go-v3-oracle-contract.test.ts
```

- [x] **Step 3: Write failing verifier tests**

Require offline validation to reject a changed tag, malformed digest, missing
provenance, public-content decision, URL, absolute path, unknown surface, or
duplicated identifier. Require explicit source verification to detect a wrong
commit and a changed archive group without printing file contents.

- [x] **Step 4: Implement the minimal verifier**

Validate the committed manifest by default. Support explicit `--source`,
`--dist-source`, `--binary`, and `--plugin-cache` options. Recompute immutable
Git object/archive hashes and file projections with argument-safe child
processes. Emit only concise IDs, hashes, counts, and pass/fail status.

- [x] **Step 5: Integrate the offline gate**

Add `oracle:verify` to the root scripts and the offline `verify` chain before
the build. Regenerate the lockfile only if the root manifest changes its lock
metadata; add no dependency.

- [x] **Step 6: Run focused checks and commit**

```bash
npm run oracle:verify
npm test -- tests/go-v3-oracle-contract.test.ts tests/go-v3-oracle-verifier.test.ts
npm run lint
npm run typecheck
```

```bash
git add compatibility scripts/verify-go-v3-oracle.mjs tests package.json package-lock.json
git commit -s -m "test: freeze Go v3 oracle metadata"
```

### Task 3: Prove private-source verification and document reproduction

**Files:**

- Create: `docs/compatibility/go-v3-v0.6.5-baseline.md`
- Modify: `README.md`
- Modify: `docs/development/toolchain.md`

**Interfaces:**

- Consumes: authorized local source/dist checkouts and installed oracle binary.
- Produces: reproducible evidence and contributor instructions without private bytes.

- [x] **Step 1: Recompute source and distribution captures**

Run the verifier with explicit paths. Confirm the source tag/commit, twelve
archive groups, four PRD anchors, source archive, dist archive, tracked plugin
projection, command outputs, and installed Linux binary.

- [x] **Step 2: Record the two-build campaign**

Document two clean detached checkouts, exact Go release flags, byte-identical
Linux/Windows/Darwin results, source archive identity, help/version output
identity, and installed Linux binary match.

- [x] **Step 3: Record the complete legacy suite**

Document `go mod verify`, build, race/coverage test command, coverage gate,
cross-builds, both Python suites, and skill cap. Include the required external
`TMPDIR` boundary and distinguish cross-build from native execution.

- [x] **Step 4: Complete the provenance audit**

Explicitly answer every contribution checklist item. State that all new public
code/prose is original, all predecessor material is hash-only behavioral-oracle
metadata, no adapted/verbatim material is present, and no private payload was
staged.

- [x] **Step 5: Add discoverability and commit**

Link the frozen baseline from README and the development guide without claiming
that differential parity is already implemented.

```bash
npm run spellcheck
npx --yes markdownlint-cli2@0.23.2 '**/*.md' '#node_modules'
lychee --config .lychee.toml docs/compatibility/go-v3-v0.6.5-baseline.md
git diff --check
git add docs README.md
git commit -s -m "docs: publish Go v3 baseline evidence"
```

### Task 4: Verify, review, merge, and close issue #9

**Files:**

- Verify: every changed public file and external-oracle result.

**Interfaces:**

- Consumes: Tasks 1–3.
- Produces: reviewed green pull request, closed issue #9, and updated epic #8 child status.

- [ ] **Step 1: Run full public verification**

```bash
npm ci
npm run templates:validate
npm run verify
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml
git diff --check
```

- [ ] **Step 2: Run private read-only verification**

Verify source, distribution, installed binary, and plugin projection from
explicit paths. Confirm `git status` remains clean in both public and legacy
repositories.

- [ ] **Step 3: Obtain independent review**

Review acceptance coverage, hash correctness, command safety, privacy,
provenance, PRD locking, and claim accuracy. Resolve all valid findings and
rerun affected checks.

- [ ] **Step 4: Open and merge the completion pull request**

The PR links and closes #9, lists exact public/private commands and results,
completes the provenance checklist, and explains that behavior is frozen but not
yet reimplemented. Merge only after CI and documentation checks pass.

- [ ] **Step 5: Confirm closure and update epic #8**

Confirm issue #9 is closed, mark its child checkbox complete in epic #8, sync
`main`, and begin the next sequential issue.
