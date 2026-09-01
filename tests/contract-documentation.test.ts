import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import contractFamilies from "../packages/contracts/catalogs/contract-families.v1.json" with { type: "json" };
import reasonCatalogV16 from "../packages/contracts/catalogs/reason-codes.v1.6.json" with { type: "json" };
import preToolUseSchema from "../schemas/host/pre-tool-use.v1.schema.json" with { type: "json" };
import featureScopeSchema from "../schemas/state/feature-scope.v1.schema.json" with { type: "json" };
import guardrailsSchema from "../schemas/state/guardrails.v1.schema.json" with { type: "json" };
import { CONTRACT_VERSIONS } from "@kratos/contracts";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

let guide: string;
let readme: string;
let schemaIndex: string;
let fixtureIndex: string;
let resultContract: string;
let projectDiscovery: string;
let runtimeBoundaries: string;
let concurrencyLocks: string;
let reasonCatalog: string;
let agentOutput: string;
let configuration: string;
let projectInitialization: string;
let hosts: string;
let gatesApprovalsEvidence: string;
let eventStore: string;
let migrationRecovery: string;
let schemaRegistry: string;
let migrationObservability: string;
let systemArchitecture: string;
let commands: string;
let shadowGateEvidence: string;

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a contract record");
  }
  return value as Readonly<Record<string, unknown>>;
}

function unknownArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("expected a contract array");
  return value as readonly unknown[];
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`expected ${label}`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number") throw new Error(`expected ${label}`);
  return value;
}

function contractVersion(schema: unknown): string {
  const properties = record(record(schema).properties);
  const version = record(properties.contractVersion).const;
  return stringValue(version, "contract version");
}

function requiredProperties(schema: unknown): readonly string[] {
  return unknownArray(record(schema).required).map((value) =>
    stringValue(value, "required contract property"),
  );
}

function mutationBounds(schema: unknown): readonly [number, number] {
  const mutations = record(record(schema).properties).mutations;
  const minimum = record(mutations).minItems;
  const maximum = record(mutations).maxItems;
  return [
    numberValue(minimum, "minimum mutation count"),
    numberValue(maximum, "maximum mutation count"),
  ];
}

function reason(code: string): Readonly<Record<string, unknown>> {
  const reasons = unknownArray(record(reasonCatalogV16).reasons);
  const entry = reasons.find((candidate) => record(candidate).code === code);
  if (entry === undefined) throw new Error(`missing reason ${code}`);
  return record(entry);
}

beforeAll(async () => {
  [
    guide,
    readme,
    schemaIndex,
    fixtureIndex,
    resultContract,
    projectDiscovery,
    runtimeBoundaries,
    concurrencyLocks,
    reasonCatalog,
    agentOutput,
    configuration,
    projectInitialization,
    hosts,
    gatesApprovalsEvidence,
    eventStore,
    migrationRecovery,
    schemaRegistry,
    migrationObservability,
    systemArchitecture,
    commands,
    shadowGateEvidence,
  ] = await Promise.all([
    readFile(
      join(repositoryRoot, "docs/compatibility/contract-versioning.md"),
      "utf8",
    ),
    readFile(join(repositoryRoot, "README.md"), "utf8"),
    readFile(join(repositoryRoot, "schemas/README.md"), "utf8"),
    readFile(join(repositoryRoot, "fixtures/README.md"), "utf8"),
    readFile(
      join(repositoryRoot, "docs/compatibility/result-contract.md"),
      "utf8",
    ),
    readFile(
      join(repositoryRoot, "docs/architecture/project-discovery.md"),
      "utf8",
    ),
    readFile(
      join(repositoryRoot, "docs/architecture/runtime-boundaries.md"),
      "utf8",
    ),
    readFile(
      join(repositoryRoot, "docs/architecture/concurrency-locks.md"),
      "utf8",
    ),
    readFile(
      join(
        repositoryRoot,
        "packages/contracts/catalogs/reason-codes.v1.3.json",
      ),
      "utf8",
    ),
    readFile(
      join(repositoryRoot, "docs/architecture/agent-output-contract.md"),
      "utf8",
    ),
    readFile(
      join(repositoryRoot, "docs/user/configuration-and-state.md"),
      "utf8",
    ),
    readFile(
      join(repositoryRoot, "docs/architecture/project-initialization.md"),
      "utf8",
    ),
    readFile(join(repositoryRoot, "docs/user/hosts.md"), "utf8"),
    readFile(
      join(repositoryRoot, "docs/architecture/gates-approvals-evidence.md"),
      "utf8",
    ),
    readFile(join(repositoryRoot, "docs/architecture/event-store.md"), "utf8"),
    readFile(
      join(repositoryRoot, "docs/user/migration-and-recovery.md"),
      "utf8",
    ),
    readFile(
      join(repositoryRoot, "docs/architecture/schema-registry.md"),
      "utf8",
    ),
    readFile(
      join(repositoryRoot, "docs/architecture/migration-observability.md"),
      "utf8",
    ),
    readFile(
      join(repositoryRoot, "docs/architecture/system-architecture.md"),
      "utf8",
    ),
    readFile(join(repositoryRoot, "docs/user/commands.md"), "utf8"),
    readFile(
      join(
        repositoryRoot,
        "docs/verification/issue-12a-shadow-gate-selection-evidence.md",
      ),
      "utf8",
    ),
  ]);
});

describe("project discovery documentation", () => {
  it("publishes the root, worktree, and migration precedence", () => {
    for (const token of [
      "explicit `--root`",
      "nearest ancestor",
      "linked Git worktree",
      "principal checkout",
      "migration-only",
      "project-owned `.brain/`",
    ]) {
      expect(projectDiscovery).toContain(token);
    }
  });

  it("publishes configuration safety and ownership boundaries", () => {
    for (const token of [
      "no environment-variable configuration layer",
      "safe to render",
      "RUN-04",
      "ConfigurationValidator",
      "does not add a command",
      "0 / 400",
    ]) {
      expect(projectDiscovery).toContain(token);
    }
    expect(projectDiscovery).not.toContain("kratos-old");
    expect(runtimeBoundaries).toContain("Workspace");
    expect(runtimeBoundaries).toContain("project discovery");
  });
});

describe("contract versioning documentation", () => {
  it("publishes per-gate policy modes and their current state contracts", () => {
    const documentation = [
      guide,
      schemaIndex,
      configuration,
      gatesApprovalsEvidence,
      eventStore,
      migrationRecovery,
    ].join("\n");

    for (const phrase of [
      "gateModes",
      "gaps-closed",
      "shadow",
      "warn",
      "enforce",
      "state.event@1.2.0",
      "state.project-config@1.4.0",
    ]) {
      expect(documentation).toContain(phrase);
    }
  });

  it("documents the selectable shadow rollout across operator and registry guides", () => {
    expect(configuration).toContain("shadow -> measure -> warn -> enforce");
    expect(projectInitialization).toContain('"gaps-closed": "shadow"');
    expect(guide).toContain("contract.state_version_unsupported");
    expect(schemaIndex).toContain("host.doctor-report@1.0.0");
  });

  it("derives every documented current diagnostic revision from the exported selectors", () => {
    const currentContracts = [
      "state.event",
      "host.init-answers",
      "host.phase-handoff",
      "host.doctor-report",
      "host.agent-output",
      "host.memory-capture",
      "host.memory-change",
      "host.memory-curation",
      "host.memory-migration",
    ] as const satisfies readonly (keyof typeof CONTRACT_VERSIONS)[];

    for (const id of currentContracts) {
      const selector = `\`${id}@${CONTRACT_VERSIONS[id]}\``;
      expect(guide).toContain(selector);
      expect(schemaIndex).toContain(selector);
    }
  });

  it("maps acceptance evidence to the exact lifecycle and predecessor tests", () => {
    expect(shadowGateEvidence).toContain(
      "`tests/gate-facts.test.ts` — `records gaps-closed in %s mode as %s through the lifecycle`",
    );
    expect(shadowGateEvidence).toContain(
      "`tests/contract-compatibility.test.ts` — `lets a frozen predecessor refuse a shadow-enabled state without mutation`",
    );
  });

  it("publishes current state and migration boundaries in every operator guide", () => {
    for (const phrase of [
      "| `state.event` | state | `1.4.0` | `EventV1_4` |",
      "| `state.project-config` | state | `1.4.0` | `ProjectConfigV1_4` |",
      "pre-`1.4.0` project configuration",
      "| `host.init-answers` | host | `1.4.0` | `InitAnswersV1_4` |",
    ]) {
      expect(schemaRegistry).toContain(phrase);
    }

    for (const phrase of [
      "current `1.4.0` state",
      "pre-`1.4.0` configuration",
    ]) {
      expect(migrationObservability).toContain(phrase);
    }

    expect(systemArchitecture).toMatch(
      /current execution requires a `1\.4\.0`\s+project configuration/u,
    );

    for (const phrase of [
      "pre-`1.4.0` configuration",
      "current `1.4.0` state",
      "host.init-answers@1.5.0",
    ]) {
      expect(commands).toContain(phrase);
    }

    expect(guide).toMatch(
      /every pre-`1\.4\.0` project configuration,\s+including `1\.3\.0`/u,
    );
  });

  it("documents identities, migration, PRD protection, and verification", () => {
    for (const token of [
      "pluginVersion",
      "stateContract",
      "hostContract",
      "migration-only",
      "npm run contracts:check",
      "go-v3.prd-output@1",
      "issue #13",
    ]) {
      expect(guide).toContain(token);
    }
    expect(guide).toContain("0.9.0");
    expect(guide).toMatch(/before payload validation or\s+mutation/u);
    expect(guide).toContain("byte-preserving");
    expect(guide).toContain("reason-codes.v1.1.json");
    expect(guide).toContain("reason-codes.v1.2.json");
    expect(guide).toContain("reason-codes.v1.3.json");
    expect(guide).toContain("reason-codes.v1.5.json");
    expect(guide).toContain("reason-codes.v1.6.json");
    expect(guide).toContain("runtime.node_unsupported");
    expect(resultContract).toContain("reason-codes.v1.5.json");
    expect(resultContract).toContain("runtime.orientation_ok");
    expect(resultContract).toContain("gate.prd_untouched");
    expect(resultContract).toContain("gate.prd_section_missing");
  });

  it("keeps the lock contract inside the published reason catalog", () => {
    // Every reason the lock guide promises has to be one the result contract
    // publishes. A document naming a code nothing can emit teaches operators
    // to look for output they will never see.
    for (const token of [
      "runtime.lease_conflict",
      "runtime.recovery_required",
      "runtime.state_corrupt",
      "guard.outside_allow",
    ]) {
      expect(concurrencyLocks).toContain(token);
      expect(reasonCatalog).toContain(`"${token}"`);
    }
  });

  it("keeps README status honest while publishing contract infrastructure", () => {
    expect(readme).toContain("versioned contracts, schemas, reason codes");
    expect(readme).toContain("experimental development snapshot");
    expect(readme).toContain("schema registry contract");
  });

  it("publishes the delimiter, the envelope, and the extraction rules", () => {
    for (const token of [
      "===KRATOS-AGENT-OUTPUT-V1===",
      "===END-KRATOS-AGENT-OUTPUT-V1===",
      "deliberately not a Markdown fence",
      "kratos agent record REF",
      "host.agent-output@1.0.0",
      "run.agent.recorded",
      "trail.output_invalido",
      "no model call and no network access",
      "additionalProperties: false",
      "issues/113",
    ]) {
      expect(agentOutput).toContain(token);
    }
    // The two path fields exist to stay apart; documentation that stopped
    // saying so would be documenting a different contract.
    expect(agentOutput).toContain("stay separate fields");
  });

  it("indexes all current artifact families and commands", () => {
    for (const token of [
      "project-config.v1.schema.json",
      "project-config.v1.1.schema.json",
      "project-config.v1.2.schema.json",
      "project-config.v1.3.schema.json",
      "snapshot.v1.schema.json",
      "event.v1.schema.json",
      "event.v1.1.schema.json",
      "approval.v1.schema.json",
      "evidence.v1.schema.json",
      "feature.v1.schema.json",
      "feature-scope.v1.schema.json",
      "guardrails.v1.schema.json",
      "lock.v1.schema.json",
      "migration.v1.schema.json",
      "migration.v1.1.schema.json",
      "transaction-manifest.v1.schema.json",
      "transaction-progress.v1.schema.json",
      "adapter-message.v1.schema.json",
      "adapter-message.v1.1.schema.json",
      "agent-output.v1.schema.json",
      "operation-message.v1.schema.json",
      "pre-tool-use.v1.schema.json",
      "init-answers.v1.1.schema.json",
      "init-answers.v1.2.schema.json",
      "init-answers.v1.3.schema.json",
      "init-answers.v1.4.schema.json",
      "phase-handoff.v1.1.schema.json",
      "contract-manifest.v1.2.schema.json",
      "contract-manifest.v1.3.schema.json",
      "contract-manifest.v1.4.schema.json",
      "contract-manifest.v1.5.schema.json",
      "contract-manifest.v1.6.schema.json",
      "contract-manifest.v1.9.schema.json",
      "contract-manifest.v1.1.schema.json",
      "npm run contracts:generate",
      "npm run contracts:check",
      "reason-codes.v1.7.json",
      "reason-codes.v1.8.json",
      "reason-codes.v1.9.json",
      "reason-codes.v1.10.json",
    ]) {
      expect(schemaIndex).toContain(token);
    }
    for (const token of [
      "project-config.json",
      "snapshot.json",
      "event.json",
      "approval.json",
      "evidence.json",
      "lock.json",
      "migration.json",
      "transaction-manifest.json",
      "transaction-progress.json",
      "adapter-message.json",
      "operation-approval.json",
      "operation-hook.json",
      "operation-timeout.json",
      "operation-cancellation.json",
      "operation-error.json",
      "agent-output.json",
      "version-cases.json",
    ]) {
      expect(fixtureIndex).toContain(token);
    }
  });
});

describe("pre-write scope guard documentation", () => {
  it("derives published scope, host, and result facts from the checked contracts", () => {
    const scopeVersion = contractVersion(featureScopeSchema);
    const guardrailsProperties = record(guardrailsSchema).properties;
    const preToolVersion = contractVersion(preToolUseSchema);
    const [minimumMutations, maximumMutations] =
      mutationBounds(preToolUseSchema);
    const pathEscape = reason("guard.path_escape");
    const outsideAllow = reason("guard.outside_allow");
    const pathEscapeCode = stringValue(pathEscape.code, "path escape code");
    const pathEscapeStatus = stringValue(
      pathEscape.status,
      "path escape status",
    );
    const pathEscapeExitCode = numberValue(
      pathEscape.exitCode,
      "path escape exit code",
    );
    const outsideAllowCode = stringValue(
      outsideAllow.code,
      "outside allow code",
    );
    const outsideAllowStatus = stringValue(
      outsideAllow.status,
      "outside allow status",
    );
    const outsideAllowExitCode = numberValue(
      outsideAllow.exitCode,
      "outside allow exit code",
    );
    const reasonCatalogVersion = stringValue(
      record(contractFamilies).reasonCatalog,
      "reason catalog version",
    );

    for (const token of [
      "`.brain/02-features/<active-feature>/scope.json`",
      `\`state.feature-scope@${scopeVersion}\``,
      "`kratos scope record`",
      "`## File allowlist`",
      "`## File denylist`",
      "code-formatted bullet",
      "ordered, project-relative, slash-separated, and case-sensitive",
      "`*`, `?`, `**`, character classes, and a leading `!`",
      "`.brain/**`",
      "`.env.example`",
      "`.codex/**` and `.claude/**`",
    ]) {
      expect(configuration).toContain(token);
    }
    for (const property of requiredProperties(featureScopeSchema)) {
      expect(configuration).toContain(`\`${property}\``);
    }
    expect(guardrailsProperties).toHaveProperty("writeBlocks");
    expect(configuration).toContain("`writeBlocks`");
    expect(configuration).toMatch(/exact `\.brain` root is not\s+repairable/u);

    for (const token of [
      "one parser and one renderer",
      "scope file that already differs",
      "malformed reviewer prose",
    ]) {
      expect(projectInitialization).toContain(token);
    }

    for (const token of [
      "synchronous `PreToolUse`",
      "`Write`",
      "`Edit`",
      "legacy `MultiEdit`",
      "`apply_patch`",
      "Bash and arbitrary MCP tools",
      "no decision authority",
      "time-of-check/time-of-use",
    ]) {
      expect(hosts).toContain(token);
    }
    expect(hosts).toContain(`\`host.pre-tool-use@${preToolVersion}\``);
    for (const property of requiredProperties(preToolUseSchema)) {
      expect(hosts).toContain(`\`${property}\``);
    }
    expect(hosts).toContain(
      `${String(minimumMutations)}\u2013${String(maximumMutations)}`,
    );
    expect(hosts).toContain("closed record");

    expect(guide).toContain(`Revision \`${reasonCatalogVersion}\``);
    expect(schemaIndex).toContain(
      `reason-codes.v${reasonCatalogVersion.replace(/\.0$/u, "")}.json`,
    );
    expect(resultContract).toContain(`\`${pathEscapeCode}\``);
    expect(resultContract).toContain(
      `as ${pathEscapeStatus} / exit ${String(pathEscapeExitCode)}`,
    );
    expect(resultContract).toContain(`\`${outsideAllowCode}\``);
    expect(resultContract).toContain(
      `${outsideAllowStatus} / exit ${String(outsideAllowExitCode)}`,
    );
    expect(resultContract).toContain(
      "Every non-success result is denied by the host relay",
    );
  });
});
