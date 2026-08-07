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

beforeAll(async () => {
  [guide, readme, schemaIndex, fixtureIndex, resultContract] =
    await Promise.all([
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
    ]);
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
    expect(guide).toContain("runtime.node_unsupported");
    expect(resultContract).toContain("reason-codes.v1.3.json");
    expect(resultContract).toContain("runtime.orientation_ok");
  });

  it("keeps README status honest while publishing contract infrastructure", () => {
    expect(readme).toContain(
      "Contract schemas and compatibility checks are available",
    );
    expect(readme).toContain("The harness runtime is not usable yet");
    expect(readme).toContain("docs/compatibility/contract-versioning.md");
  });

  it("indexes all current artifact families and commands", () => {
    for (const token of [
      "project-config.v1.schema.json",
      "snapshot.v1.schema.json",
      "event.v1.schema.json",
      "approval.v1.schema.json",
      "evidence.v1.schema.json",
      "lock.v1.schema.json",
      "migration.v1.schema.json",
      "adapter-message.v1.schema.json",
      "contract-manifest.v1.schema.json",
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
      "adapter-message.json",
      "version-cases.json",
    ]) {
      expect(fixtureIndex).toContain(token);
    }
  });
});
