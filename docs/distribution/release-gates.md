# Release gates

The tagged release workflow runs through the GitHub `release` environment. A
repository administrator must configure that environment with required human
reviewers before a release is considered protected; naming an environment in
workflow source does not activate those settings.

The workflow verifies the complete repository, benchmarks the built runtime,
creates the shared plugin and both host-specific archives, rebuilds them, and
requires byte-for-byte equality. It then emits SHA-256 checksums, a CycloneDX
SBOM, and GitHub build-provenance attestations. Only a verified `v*` tag is
published as a GitHub release.

The `developer` branch is the integration line and `main` is the release line.
Repository rulesets must require pull requests, CI, DCO, dependency review,
CodeQL, up-to-date review, and blocked force pushes/deletions. Those rules are
server-side configuration and require API or administrator evidence; the
workflow files cannot prove that the settings are active.
