# Glossary and writing style

## Glossary

- **Adapter:** Thin host boundary that transports observations and results.
- **Approval:** Human decision bound to exact content and policy digests.
- **Evidence:** Classified reference plus a digest and provenance metadata.
- **Gate:** Pure policy evaluator with a stable decision and recovery code.
- **Host:** Claude Code, Codex, or another contract-compatible caller.
- **Plan:** Deterministic, reviewable description of intended effects.
- **Run:** One correlated objective-to-acceptance workflow.
- **Snapshot:** Materialized view derived from canonical events.
- **Trail:** The replayable history of proposals, decisions, and evidence.

## Style

Public source, schemas, CLI messages, templates, skills, and documentation use
plain English. Prefer stable domain terms, active voice, short sentences, and
specific recovery instructions. Do not translate identifiers or reason codes.
Proper names and deliberately multilingual parser/security fixtures require a
narrowly documented allowlist entry.
