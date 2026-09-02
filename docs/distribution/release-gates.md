# Release gates

The tagged release workflow runs through the GitHub `release` environment. A
repository administrator must configure that environment with required human
reviewers before a release is considered protected; naming an environment in
workflow source does not activate those settings.

The workflow verifies the complete repository, benchmarks the built runtime,
creates the shared marketplace archive and all three host-specific archives —
Codex, Claude Code, and Antigravity — rebuilds every one of them, and requires
byte-for-byte equality across all four. It then emits SHA-256 checksums written
from inside the release directory, a CycloneDX SBOM, and GitHub
build-provenance attestations covering every archive. Only a verified `v*` tag
is published as a GitHub release.

The npm release that resolves the lockfile is installed from the pin in
`package.json` before it is used, in every workflow that runs npm. The version
the runner image bundles with Node.js decides nothing.

The `developer` branch is the integration line and `main` is the release line.
Repository rulesets must require pull requests, CI, DCO, dependency review,
CodeQL, up-to-date review, and blocked force pushes/deletions. Those rules are
server-side configuration and require API or administrator evidence; the
workflow files cannot prove that the settings are active.
