# Go v3 v0.6.5 Behavioral Oracle Baseline

## Decision

The authoritative predecessor for compatibility work is private Go v3 release
`v0.6.5`:

| Identity | Frozen value |
| --- | --- |
| Source tag object | `720f0a35074451208a0673324d223803add249e0` |
| Source commit | `632f1e9bb283cf83412ef3e9e0b642daefdb0784` |
| Distribution commit | `e6e6803c9329a53d362217a8f829a2801c83609d` |
| Source files | 1,157 |
| Distribution files | 59 |
| Go toolchain | `1.23.4` |
| Plugin version | `0.6.5` for Claude and Codex |

The source annotated tag dereferences to the same commit as the source
repository's `main` at capture time. The old local working branch was not used:
it pointed at `v0.6.1` and was 77 commits behind the released line. Future
movement of `main` cannot change this baseline.

The canonical machine catalog is
[`manifest.json`](../../compatibility/oracles/go-v3/v0.6.5/manifest.json).

## Reproducible artifacts

Two independently cloned, clean detached checkouts produced identical source
archives and release assets:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Source archive | — | `637a0b0acd89666c2a8cac5f9a0af8e1b5a56b9eeca8a145af3a0c0f66badfc4` |
| `yoda-linux-amd64` | 5,443,736 | `da4ec4a2394ae90a94722f633bcb9157ddc5ee0133f46540b7c2c700abe378b8` |
| `yoda-windows-amd64.exe` | 5,774,848 | `14ba51351606cb2706729027258ed5408a5d0bf592ccf78dc20360fb127fe645` |
| `yoda-darwin-arm64` | 5,215,602 | `bf6a721aec8de8076330ce1e72308a60f3a351e216b307201a0987d48f1ff88d` |
| Distribution archive | — | `18d2d9d679e100baa42b1d439538d0810833a1e7a1e6ca03874a640aa6466ccc` |

The Linux result was also byte-identical to the installed `0.6.5` binary. Its
Go build metadata reported the frozen revision, release commit time,
`vcs.modified=false`, `linux/amd64`, `CGO_ENABLED=0`, and Go `1.23.4`.
The Windows and Darwin values are identities of two clean, byte-identical
rebuilds using the frozen release procedure; no separately downloaded asset or
native execution comparison is claimed for those targets.

Release builds used a clean Git checkout because Go embeds VCS metadata. A build
from `git archive` is deterministic but intentionally has different bytes and
is not the release oracle.

The release command shape was:

```text
CGO_ENABLED=0 GOOS=<target-os> GOARCH=<target-arch> \
  go build -trimpath -ldflags "-s -w -X main.version=0.6.5" \
  -o <asset> ./cmd/yoda
```

## Command-output capture

No private help prose is published. Exact output identity is retained by digest:

| Arguments | Exit | Stdout bytes | Stdout SHA-256 | Stderr |
| --- | ---: | ---: | --- | --- |
| `version` | 0 | 6 | `34bf52562bae401de106933a7565c9d3a5c8dc83c04b0b29492dd3f6f3983b7a` | Empty |
| `--help` | 0 | 1,058 | `8fe918223dc75b5fc644f2769fa38456077c1b0467e5bc2394597a77431414b6` | Empty |

Both independently rebuilt Linux binaries produced byte-identical command
outputs.

## Captured behavior surfaces

Each row is a deterministic SHA-256 of a tagged `git archive` path set. Private
bytes remain private.

| Surface | Files | SHA-256 |
| --- | ---: | --- |
| Schemas | 16 | `13994d61e989d72ee74a640243738c45f6ee1d32545e396ce9b049670455a503` |
| Skills | 3 | `7aafdb22f482184f407b030859cb97dedd20e62e3d3264325068b5595558c507` |
| Agents | 7 | `390d56fa01d3af732ad0207c23734cf5735c1fa64b1ddfd7f00857615653d37e` |
| Hooks | 2 | `9f357297871a157d2aeb07f5604e389abd613d7d2d03ecf54ea6e8c919e5f46f` |
| Init templates | 24 | `c0bc812195f1ac714152a652eb052edf7bcd4e5d345529f6955fe18d4e36f730` |
| Migration | 40 | `c96b561e1b289cc4619675ff1597a234937071a0f4c177c241dabbf60055e2ce` |
| Benchmarks | 57 | `11b79efdc0e08211a2810cab7ad4c1df7637b638ef1b1e7550bab80115b17dfd` |
| PRD contract | 17 | `f213095d91c8da81faff4d8ef0ec3bd1c10097f1ddb513d19a91793740775974` |
| Release contract | 17 | `029673cb911a3469deb30d770d5b263239b4f3fba3ca5095f6a1f834760100e1` |
| Go inputs | 2 | `7182371e0e5a23bb1ae1f24b51e156b3de87396163f856788cdf75a2a121d9ad` |
| Plugin manifests | 3 | `f491b25a0ab48f97e544935afb707a7a9188f3d55fe4189af2638648c1d6ac76` |

All 59 distribution files were present and byte-identical in the installed
Codex plugin cache. Their tracked projection digest was
`0ac3c54c2f0932eb2c60f13e4522cfcca8f4218000fe2d68a589dcf3fa0b0dc3`.

## PRD parity lock

PRD behavior is a P0 compatibility boundary. The aggregate above is reinforced
by individual hashes for the private PRD researcher contract, structured-output
schema, adaptive Problem Discovery reference, and generated PRD template. Their
paths, byte counts, and digests are in the public manifest; their content is not.

The TypeScript rewrite must remain behaviorally equivalent to these frozen
anchors and the approved architecture's PRD contract. In particular, it must
preserve WHAT/WHY ownership, adaptive discovery, blocking versus deferred
questions, structured outcomes, and the rule that insufficient context creates
no PRD artifact. Issue #10 will map these anchors into exhaustive parity rows;
this issue does not claim that parity is implemented.

## Complete legacy verification

The successful run used Linux amd64, Go `1.23.4`, Python `3.12.3`, and an
external temporary directory:

```text
go mod verify
go build ./...
TMPDIR=<outside-checkout> go test -race -count=1 \
  -covermode=atomic -coverprofile=coverage.out ./...
go run ./cmd/coveragegate --profile coverage.out \
  --floors .github/coverage-floors.json --summary <outside-checkout-summary>
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build ./...
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build ./...
python3 -m unittest discover -s tests/gap-bench -p 'test_*.py'
python3 -m unittest discover -s tests/spec-v2 -p 'test_*.py'
test "$(wc -l < skills/sdd/SKILL.md)" -le 150
```

Results:

- all Go packages passed with race detection and fresh execution;
- total Go statement coverage was 81.97%, and every configured package floor
  passed;
- Windows amd64 and Darwin arm64 cross-builds passed;
- the gap-bench Python suite passed 10 tests;
- the spec-v2 Python suite passed 75 tests;
- the SDD orchestrator was 119 lines against a 150-line cap.

Cross-builds prove compilation, not native Windows or macOS execution. Native
platform evidence remains owned by the later quality campaign.

`TMPDIR` must remain outside the clone. The legacy runtime deliberately detects
worktree-local temporary files as dirty project state; placing test temporaries
inside the clone is an invalid environment, not a product failure.

## Authorized private verification

The normal public command is offline:

```text
npm run oracle:verify
```

An authorized maintainer can recompute private evidence without copying it:

```text
node scripts/verify-go-v3-oracle.mjs \
  --source <authorized-source-checkout> \
  --dist-source <authorized-distribution-checkout> \
  --binary <installed-linux-oracle> \
  --plugin-cache <installed-plugin-cache>
```

The verifier reads only explicit paths and reports identifiers, hashes, counts,
and status. It never searches user directories, prints private file contents, or
uses network access.

## Intellectual-property provenance audit

- [x] Every legacy source is identified by private repository slug, immutable
  tag/commit, owner, surface ID, and cryptographic digest.
- [x] Both predecessor repositories and all captured artifacts are classified
  as private, owned by BetaUp Sistemas, with no established MIT publication
  grant.
- [x] All code, tests, and prose added to this public repository are original;
  predecessor use is behavioral clean-room metadata only.
- [x] No adapted or verbatim predecessor material is present, so no relicensing
  claim or inherited notice is required by this change.
- [x] No source, prompt, schema, fixture, help prose, binary, private clone URL,
  credential, internal filesystem path, customer data, or confidential business
  payload is included.

The publication decision is fail-closed: private content remains denied until a
separate review establishes explicit MIT-compatible authority. Hashes establish
identity; they do not publish or relicense the hashed expression.
