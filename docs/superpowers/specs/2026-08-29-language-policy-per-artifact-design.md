# Language Policy per Artifact Design

Date: 2026-08-29
Status: APPROVED
Issue: #138 (`FND-08`)
Approval source: the user's approved brainstorming design

## 1. Problem and outcome

The legacy configuration provided a single `language` field restricted to `"en"` or `"pt-BR"`. This single field cannot express the arrangement standard in mixed-language engineering environments: conversation and documentation authored in Brazilian Portuguese, while technical identifiers, code comments, and commits remain in English (or vice versa).

Collapsing all dimensions into a single value forces an unacceptable choice: setting it to Portuguese may cause agents to synthesize code identifiers in Portuguese on an English codebase, whereas setting it to English prevents requirement and design documents from being easily readable and approvable by Portuguese-speaking stakeholders.

Additionally, on an existing codebase, existing code conventions must act as the primary authority. Overriding established identifier conventions leads to inconsistent files.

Kratos will expand the language policy into an explicit, closed per-artifact object covering conversation, documentation, code comments, technical identifiers, and suggested commits, along with a convention preservation flag and an advisory enforcement mode. The runtime owns resolution, validation, and migration; prompts and context surfaces relay the resolved policy; and evaluations never fail an acceptance criterion based on prose language alone.

## 2. Authority and host neutrality

The runtime owns all policy:

- the closed set of policy dimensions (`conversation`, `documentation`, `comments`, `identifiers`, `commits`, `preserveConventions`, `enforcement`);
- the supported language codes (`"en"`, `"pt-BR"`);
- structural completeness validation (refusing incomplete objects with exact reason codes);
- deterministic fallback resolution for absent policy configurations;
- offline convention detection during initialization;
- migration from legacy v1.0.0 and v1.1.0 configuration formats; and
- stable advisory reason codes during gate evaluation.

Host surfaces (`CLAUDE.md`, `AGENTS.md`, `.codex/config.toml`) and phase agent prompt templates act strictly as relays:

- rendering the resolved per-artifact language directives in project context files; and
- relaying normative language rules and exception boundaries in agent system instructions.

Prompts never make decisions or invent fallback values; they relay the exact policy computed by the runtime.

## 3. Configuration and schema contracts

The project configuration updates to contract version `1.2.0` (`stateContract: 1.2.0`, `hostContract: 1.2.0`).

### 3.1 Project configuration (`schemas/state/project-config.v1.2.schema.json`)

The `language` property becomes a required, closed object:

```json
{
  "contractVersion": "1.2.0",
  "stateContract": "1.2.0",
  "pluginVersion": "0.0.0-development",
  "hostContract": "1.2.0",
  "language": {
    "conversation": "pt-BR",
    "documentation": "pt-BR",
    "comments": "en",
    "identifiers": "en",
    "commits": "en",
    "preserveConventions": true,
    "enforcement": "advisory"
  },
  "policyMode": "standard",
  "managedState": {
    "directory": ".brain",
    "eventLog": "events.jsonl",
    "snapshots": true
  },
  "modelRoles": { ... }
}
```

Schema rules:

- `language` is closed (`additionalProperties: false`).
- All 7 keys are required when `language` is present:
  - `conversation`: `"en" | "pt-BR"`
  - `documentation`: `"en" | "pt-BR"`
  - `comments`: `"en" | "pt-BR"`
  - `identifiers`: `"en" | "pt-BR"`
  - `commits`: `"en" | "pt-BR"`
  - `preserveConventions`: `boolean`
  - `enforcement`: `"advisory" | "off"`

### 3.2 Initialization answers (`schemas/host/init-answers.v1.2.schema.json`)

- `contractVersion: "1.2.0"` and `hostContract: "1.2.0"`.
- `language` is optional at the top level.
- When `language` is present, it must be the complete 7-property object matching the schema above. An incomplete object is invalid schema-wise and rejected with reason code `trail.output_invalido` or `policy.language_incomplete`.

### 3.3 Default resolution when absent

When `language` is omitted from `init-answers`, the runtime resolves deterministic defaults:

```ts
const DEFAULT_LANGUAGE_POLICY = {
  conversation: "en",
  documentation: "en",
  comments: "en",
  identifiers: "en",
  commits: "en",
  preserveConventions: true,
  enforcement: "advisory",
} as const;
```

## 4. Convention detection and preservation

When initializing a project, the runtime executes offline repository convention detection:

- Inspects existing root documents, README files, and repository source markers.
- If `preserveConventions: true` and a dominant convention is detected (e.g. codebase identifiers in English while documentation is in Portuguese), the convention wins for `identifiers` and `comments`.
- Detection is pure and offline: no network calls and no non-deterministic heuristic guessing.

## 5. Normative exceptions

The language policy governs authored text and prose synthesis. It explicitly does not govern technical vocabulary:

- **Domain terms**, **proper nouns**, **acronyms**, **library and package names**, and **external interface/API fields** retain their canonical form regardless of the active language policy.
- Prompts and documentation must explicitly state these boundaries so agents do not attempt to translate canonical symbols or library identifiers.

## 6. Migration contract

Existing project configurations with `stateContract: "1.0.0"` or `stateContract: "1.1.0"` carrying a single `language: "en" | "pt-BR"` value are migrated to `1.2.0` deterministically:

- Legacy `"language": "pt-BR"` migrates to:

  ```json
  {
    "conversation": "pt-BR",
    "documentation": "pt-BR",
    "comments": "en",
    "identifiers": "en",
    "commits": "en",
    "preserveConventions": true,
    "enforcement": "advisory"
  }
  ```

- Legacy `"language": "en"` migrates to:

  ```json
  {
    "conversation": "en",
    "documentation": "en",
    "comments": "en",
    "identifiers": "en",
    "commits": "en",
    "preserveConventions": true,
    "enforcement": "advisory"
  }
  ```

Configurations with legacy single-field language values require migration (`model.config_migration_required`) and cleanly upgrade when `kratos migrate` is invoked.

## 7. Dual-channel agent relay

The resolved language policy is broadcast through two independent channels:

1. **Project context surfaces:**
   - `CLAUDE.md`, `AGENTS.md`, and `.codex/config.toml` generated during skeleton initialization contain structured descriptions of the resolved language policy per artifact.
2. **Phase agent prompts (`PHASE_AGENT_PROMPTS`):**
   - The shared instructions header incorporates the language policy rules and normative exceptions, ensuring agents follow the policy even if host context files are partially truncated or overridden.

## 8. Non-blocking evaluation contract

- The evaluator phase (`implementation-evaluator` and gate evaluation) checks language consistency against policy.
- When a language divergence is observed, it may record an advisory diagnostic (`policy.language_convention_mismatch_advisory`).
- The evaluator **never fails an acceptance criterion** and **never blocks a gate transition or run completion** on prose language divergence alone.
- Kratos's own repository governance (`QAL-09` / `CONTRIBUTING.md`) remains strictly English-only and is completely independent of user project policies.

## 9. Verification and evidence requirements

Verification must provide test evidence for:

1. Complete `v1.2.0` schema validation for `project-config` and `init-answers`.
2. Rejection of incomplete language objects with descriptive diagnostics naming missing keys.
3. Fallback resolution of absent language policy to documented English defaults.
4. Clean migration from single-field `v1.0.0` and `v1.1.0` project configurations.
5. Proof that language policy directives reach agents through both host context files (`CLAUDE.md`/`AGENTS.md`) and phase agent prompt definitions.
6. Dominant convention preservation override assertion when `preserveConventions: true`.
7. Repository test suite pass (`npm run verify`).
