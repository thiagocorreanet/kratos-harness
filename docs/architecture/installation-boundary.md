# Installation boundary

Kratos has three distinct ownership zones. They must not be collapsed.

| Zone | Contains | Must not contain |
| --- | --- | --- |
| Source repository | TypeScript source, tests, schemas, host templates, documentation | generated `dist`, release archives, installed dependencies committed as runtime |
| Installed host plugin | embedded motor, runtime contracts and schemas, manifest, thin host adapter | application source or project-owned workflow state |
| User project | `.brain` state and evidence, managed instructions, bounded host-facing configuration | motor source, runtime schemas, engine skills, `node_modules`, TypeScript, source maps |

The host skill is an adapter, not a second implementation of Kratos. It tells
Codex or Claude Code how to locate the plugin-relative runtime, perform the
handshake, pass an explicit project root, and relay structured results. Policy,
workflow transitions, gates, approvals, schemas, and state invariants remain in
the motor.

The source build is intentionally ephemeral. It stages one Codex package and
one Claude Code package in an absolute directory outside the checkout. Release
automation archives those host packages directly and does not generate a
repository-local build tree.

Project initialization is the enforcement point for the last boundary. Package
verification installs both plugins into a clean room, initializes one project
per host, and rejects any project that receives runtime code, package sources,
engine dependencies, TypeScript, or source maps.
