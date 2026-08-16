# Go v3 Oracle Baseline Design

- Status: Approved by maintainer-authorized autonomous execution
- Decision date: 2026-08-07
- Tracking issue: [#9](https://github.com/thiagocorreanet/kratos-harness/issues/9)
- Parent epic: [#8](https://github.com/thiagocorreanet/kratos-harness/issues/8)

## 1. Outcome

The authoritative behavioral oracle is the private Go v3 release `v0.6.5`.
Its annotated Git tag object is
`720f0a35074451208a0673324d223803add249e0` and dereferences to commit
`632f1e9bb283cf83412ef3e9e0b642daefdb0784`. That commit is also the source
repository's current `main` tip. The Claude and Codex plugin manifests both
declare version `0.6.5`, and the installed Linux oracle reports the same
version.

This pair is selected instead of the legacy checkout's active branch or a
floating branch reference. The active local branch points at `v0.6.1` and is 77
commits behind the release. A branch name cannot be a differential-test
authority; the annotated tag and dereferenced commit can.

## 2. Provenance and publication boundary

The source and distribution repositories are private and owned by BetaUp
Sistemas. Neither tagged tree contains a repository-level license granting MIT
publication of the predecessor source, prompts, schemas, fixtures,
documentation, or binaries. Access and ownership context therefore do not, by
themselves, authorize relicensing.

The public MIT repository records only original English documentation,
cryptographic hashes, byte counts, file counts, immutable Git identifiers,
toolchain facts, test results, and verification code. It does not copy or quote
legacy content. Every captured private artifact has this decision:

- source visibility: private;
- owner: BetaUp Sistemas;
- license status: no MIT-compatible publication grant established;
- classification: behavioral oracle, not public source material;
- public representation: hash and metadata only;
- content publication: denied until separately authorized and reviewed.

Repository slugs may be recorded because issue #9 requires an exact origin, but
private clone URLs, SSH host aliases, credentials, tokens, customer data,
private infrastructure paths, and release API details are excluded. Verifiers
receive local checkout paths explicitly and never discover private locations by
scanning a developer's home directory.

## 3. Public catalog and private artifacts

`compatibility/oracles/go-v3/v0.6.5/manifest.json` is the canonical public
catalog. It records:

- source repository slug, visibility, tag object, commit, commit timestamp, Go
  module version, and whole-source archive hash;
- distribution repository slug, immutable tag commit, archive hash, and file
  count;
- plugin manifests and the fact that the installed Codex cache projection is
  byte-identical to every tracked distribution file;
- command-output hashes, sizes, and exit codes for `version` and `--help`;
- exact Linux, Windows, and Darwin release-binary hashes and sizes;
- named source-surface archive groups;
- four individually hashed PRD anchors;
- provenance and publication decisions for every row;
- the exact successful build and test environment.

Private bytes remain in the immutable private Git tags, private release, or an
authorized maintainer's external oracle store. They never live under the public
checkout, even in an ignored directory. A hash proves which bytes were used; it
does not transfer copyright or reveal their contents.

## 4. Captured source surfaces

Each source surface is a deterministic SHA-256 over `git archive --format=tar`
at the frozen tag and the listed path set. The catalog records the file count so
an accidental empty or narrowed capture cannot look valid.

| Surface | Included behavior |
| --- | --- |
| Whole source | All 1,157 tracked source-release files |
| Schemas | Versioned machine contracts |
| Skills | Agent-facing SDD and initialization entry points |
| Agents | PRD, specification, review, implementation, and evaluation roles |
| Hooks | Host hook wiring and protocol data |
| Init templates | Project memory, host provider, and generated wiring templates |
| Migration | Migration command, implementation, tests, and documented legacy flow |
| Benchmarks | Gap benchmark assets, detector, runs, fixtures, and scorer |
| PRD contract | PRD researcher, result schema, Problem Discovery reference, template, and PRD benchmark fixtures |
| Release contract | Release/dist workflows and deterministic staging/release checks |
| Go inputs | `go.mod` and `go.sum` |
| Plugin manifests | Claude and Codex package identities |

The catalog does not claim that these groups are the final parity inventory.
Issue #10 owns exhaustive surface-to-owner-to-fixture traceability. Issue #9
freezes the inputs that inventory will inspect.

## 5. PRD compatibility lock

PRD behavior is a P0 compatibility boundary. In addition to the aggregate PRD
archive, the manifest independently fixes these artifacts by path, byte count,
and SHA-256:

1. the PRD researcher contract;
2. the PRD structured-output schema;
3. the adaptive Problem Discovery reference;
4. the generated `00-prd.md` template.

The private bytes are not published. Later clean-room fixtures may observe and
encode behavior, but any PRD implementation or contract change must cite these
anchors and the approved architecture's PRD invariants. A passing aggregate
source hash cannot waive PRD differential evidence.

## 6. Reproducible build contract

The source module requires Go `1.23.4`. Release binaries use `CGO_ENABLED=0`,
`-trimpath`, and linker flags that strip symbols and inject version `0.6.5`.
The frozen release matrix is:

| Asset | Target |
| --- | --- |
| `yoda-linux-amd64` | `linux/amd64` |
| `yoda-windows-amd64.exe` | `windows/amd64` |
| `yoda-darwin-arm64` | `darwin/arm64` |

Builds must run from a clean Git checkout of the dereferenced commit, not from a
plain source archive. Go embeds VCS revision, timestamp, and clean/dirty state in
the binaries. Removing `.git` creates a different but internally deterministic
binary and therefore does not reproduce the release artifact.

Two independent clean checkouts must produce byte-identical assets. The Linux
result must additionally match the installed `0.6.5` oracle. `go version -m`
must report Go `1.23.4`, the frozen revision, `vcs.modified=false`, the target
OS/architecture, and `CGO_ENABLED=0`.

## 7. Command-output capture

The Linux release binary is executed with `version` and `--help`. The public
catalog stores only argument vector, exit code, stdout byte count, stdout
SHA-256, and empty-stderr status. A second independently rebuilt binary must
produce identical outputs.

This preserves exact output identity for later differential tests without
publishing private help prose. Issue #10 may split the command surface into
individual behavioral rows, but it must remain anchored to these whole-output
hashes.

## 8. Test evidence contract

The baseline is acceptable only when a clean detached checkout runs the same
foundation checks as the legacy CI:

1. `go mod verify`;
2. `go build ./...`;
3. the complete race-enabled Go suite with fresh execution and atomic coverage;
4. the package coverage gate and configured floors;
5. Windows and Darwin cross-builds;
6. both Python unittest suites;
7. the SDD orchestrator skill line cap.

`TMPDIR` must be outside the checkout. The runtime intentionally rejects
project roots and staged distributions inside its own worktree; putting test
temporaries under the clone creates legitimate dirty-tree failures and is not a
valid oracle environment.

The evidence document records the exact commands, package results, coverage
total, Python counts, hashes, and known platform boundary. Cross-builds prove
compilation only; they do not claim native Windows or macOS execution.

## 9. Verification tool

`scripts/verify-go-v3-oracle.mjs` has two modes:

- without private paths, validate the catalog schema, immutable identifier
  shapes, required surfaces, PRD anchors, provenance decisions, supported
  targets, and absence of private URLs or copied content;
- with explicit source, distribution, binary, or plugin-cache paths, recompute
  the applicable hashes and fail on any mismatch.

The offline mode joins `npm run verify` and runs on every public pull request.
Private verification is opt-in and emits only pass/fail metadata and hashes. It
does not print captured file contents or remotes.

The source verifier accepts only the frozen tag and commit. A dirty checkout is
allowed for hash verification because all source reads address the immutable
tag object, but build/test instructions require a separate clean detached
checkout.

## 10. Rejected alternatives

### Use the current legacy working branch

Rejected because it points at `v0.6.1`, trails the released main line, and can
move or contain unrelated worktree state.

### Use floating `main`

Rejected because differential evidence would change whenever the private
repository advances.

### Copy schemas, prompts, fixtures, or help into the MIT repository

Rejected because no MIT-compatible publication grant is established. Hashes and
clean-room behavioral observations satisfy identity and parity needs without
relicensing private expression.

### Store a private archive under an ignored public-worktree directory

Rejected because ignored files are still easy to stage accidentally and place
confidential material inside the public repository boundary. Private artifacts
remain in private immutable sources or an external authorized store.

### Treat a source-archive build as the release binary

Rejected because Go VCS build metadata changes the executable. Reproducible
release builds require clean Git checkouts at the frozen commit.

## 11. Compatibility and security impact

This issue does not implement or change SDD behavior, schemas, state, migration,
host wiring, or distribution. It establishes the immutable measurement origin
for later work. The PRD behavior remains exactly the Go v3 baseline; no public
artifact in this issue attempts to reinterpret it.

The public verifier uses no network, secret, private default path, or repository
write. Explicit private verification reads only caller-supplied paths. Public CI
has no access to the private predecessor and validates only the catalog's
integrity and publication boundary.
