import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
      "snapshot.v1.schema.json",
      "event.v1.schema.json",
      "approval.v1.schema.json",
      "evidence.v1.schema.json",
      "feature.v1.schema.json",
      "feature-scope.v1.schema.json",
      "guardrails.v1.schema.json",
      "lock.v1.schema.json",
      "migration.v1.schema.json",
      "transaction-manifest.v1.schema.json",
      "transaction-progress.v1.schema.json",
      "adapter-message.v1.schema.json",
      "agent-output.v1.schema.json",
      "operation-message.v1.schema.json",
      "pre-tool-use.v1.schema.json",
      "contract-manifest.v1.1.schema.json",
      "npm run contracts:generate",
      "npm run contracts:check",
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
  it("publishes the scope grammar, policy order, host boundary, and result compatibility", () => {
    for (const token of [
      "`.brain/02-features/<active-feature>/scope.json`",
      "`state.feature-scope@1.0.0`",
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

    for (const token of [
      "reason-codes.v1.6.json",
      "`guard.path_escape`",
      "`guard.target_uninspectable`",
      "exit 3",
      "failure / exit 2",
      "Every non-success result is denied by the host relay",
    ]) {
      expect(resultContract).toContain(token);
    }
  });
});
