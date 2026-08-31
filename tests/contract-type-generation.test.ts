import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = join(repositoryRoot, "scripts/check-contracts.mjs");
const generated = join(
  repositoryRoot,
  "packages/contracts/src/generated/contracts.ts",
);

function check(...args: string[]) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

describe("schema-derived contract declarations", () => {
  it("verifies committed declarations without rewriting them", async () => {
    const before = await readFile(generated, "utf8");
    const result = check();
    const after = await readFile(generated, "utf8");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "contract families v1.0.0: verified (47 schemas; 14 legacy profiles; generated types current)\n",
    );
    expect(after).toBe(before);
    expect(after).toContain("Generated from registered JSON Schemas.");
    expect(after).toContain("export type AdapterMessageV1");
    expect(after).toContain("export type ProjectConfigV1_1");
    expect(after).toContain("export type ProjectConfigV1_2");
    expect(after).toContain("export type ProjectConfigV1_3");
    expect(after).toContain("export type ProjectConfigV1_4");
    expect(after).toContain("export type EventV1_2");
    expect(after).toContain("export type InitAnswersV1_3");
    expect(after).toContain("export type PhaseHandoffV1_1");
    expect(after).toContain("export type HostOperationMessageV1");
    expect(after).toContain("export type CuratedMemoryV1");
    expect(after).toContain("export type MemoryChangeV1_2");
    expect(after).toContain("candidateIds: Sha256[];");
    expect(after).toContain("confirmed: ConfirmedLesson[];");
    expect(after).toContain("sourceRanges: SourceRange[];");
    expect(after).toContain('kind: "create";');
    expect(after).toContain('kind: "move";');
    expect(after).toContain("source: Target;");
    expect(after).toContain("destination: Target;");
    expect(after).toContain("export interface ProjectConfigV1");
    expect(after).toContain("export interface RequirementDiscoveryV1");
    expect(after).toContain("export interface TransactionManifestV1");
    expect(after).toContain("export type TransactionProgressV1");
    const transactionDeclarations = after.slice(
      after.indexOf("export namespace TransactionManifestV1Contract"),
    );
    expect(transactionDeclarations).not.toContain("[k: string]");
    const projectConfigDeclarations = after.slice(
      after.indexOf("export namespace ProjectConfigV1_4Contract"),
      after.indexOf("export namespace RequirementDiscoveryV1Contract"),
    );
    expect(projectConfigDeclarations).toContain(
      '"context-readable"?: GateMode;',
    );
    expect(projectConfigDeclarations).toContain(
      '"final-acceptance"?: GateMode;',
    );
    expect(projectConfigDeclarations).not.toContain("[k: string]");
  });

  it("detects drift through an alternate generated path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kratos-contract-test-"));
    try {
      const stale = join(directory, "contracts.ts");
      await writeFile(stale, "export type Stale = true;\n", "utf8");
      const result = check("--generated", stale);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "Contract verification failed: generated declarations drifted\n",
      );
      expect(await readFile(stale, "utf8")).toBe("export type Stale = true;\n");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects extra adapter fields and mismatched response payloads", async () => {
    const directory = await mkdtemp(
      join(repositoryRoot, ".contract-type-test-"),
    );
    try {
      const source = join(directory, "invalid-adapter.mts");
      await writeFile(
        source,
        `
          import type { AdapterMessageV1 } from "../packages/contracts/src/generated/contracts.js";
          const common = {
            contractVersion: "1.0.0" as const,
            hostContract: "1.0.0" as const,
            messageId: "message-01",
            host: "codex",
            operation: "sdd.continue",
            capabilities: [] as string[],
            observedIdentity: { adapterVersion: "1.0.0", model: null as string | null },
            payloadContract: "state.snapshot@1.0.0",
            correlationId: "correlation-01",
          };
          ({
            ...common,
            messageType: "request",
            payload: { ref: "snapshot.json", sha256: "${"a".repeat(64)}" },
            unexpected: true,
          }) satisfies AdapterMessageV1;
          ({
            ...common,
            messageType: "response",
            payload: { ref: "snapshot.json", sha256: "${"a".repeat(64)}" },
          }) satisfies AdapterMessageV1;
          ({
            ...common,
            messageType: "response",
            payload: {
              contractVersion: "1.0.0",
              status: "failure",
              exitCode: 0,
              reasonCode: "runtime.internal_failure",
              summary: "The operation stopped.",
              why: ["A contract condition was not satisfied."],
              evidence: [],
              stateChanged: false,
              retryable: true,
              recovery: "Retry the operation.",
            },
          }) satisfies AdapterMessageV1;
          ({
            ...common,
            messageType: "response",
            payload: {
              contractVersion: "1.0.0",
              status: "failure",
              exitCode: 1,
              reasonCode: "runtime.internal_failure",
              summary: "The operation stopped.",
              why: ["A contract condition was not satisfied."],
              evidence: [],
              stateChanged: false,
              retryable: false,
              recovery: "Retry the operation.",
              unexpected: true,
            },
          }) satisfies AdapterMessageV1;
        `,
        "utf8",
      );
      const result = spawnSync(
        process.execPath,
        [
          join(repositoryRoot, "node_modules/typescript/lib/tsc.js"),
          "--ignoreConfig",
          "--noEmit",
          "--strict",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--target",
          "ES2024",
          source,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain(
        "'unexpected' does not exist in type 'RequestMessage'",
      );
      expect(result.stdout).toContain(
        "'ref' does not exist in type 'KratosUniversalResultV1'",
      );
      expect(result.stdout).toContain("Type '0' is not assignable");
      expect(result.stdout).toContain(
        "'unexpected' does not exist in type '{ contractVersion:",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects extra fields in generated 1.1 adapter-message variants", async () => {
    const directory = await mkdtemp(
      join(repositoryRoot, ".contract-type-test-"),
    );
    try {
      const source = join(directory, "invalid-adapter-v1.1.mts");
      await writeFile(
        source,
        `
          import type { AdapterMessageV1_1 } from "../packages/contracts/src/generated/contracts.js";

          ({
            contractVersion: "1.1.0",
            hostContract: "1.1.0",
            messageId: "message-01",
            messageType: "phase-execution",
            host: "codex",
            operation: "phase.execute",
            capabilities: [],
            observedIdentity: {
              adapterVersion: "1.1.0",
              model: null,
              effort: null,
            },
            payloadContract: "host.phase-execution@1.1.0",
            payload: {
              assignmentDigest: "${"a".repeat(64)}",
              model: null,
              effort: null,
            },
            correlationId: "correlation-01",
            unexpected: true,
          }) satisfies AdapterMessageV1_1;
        `,
        "utf8",
      );
      const result = spawnSync(
        process.execPath,
        [
          join(repositoryRoot, "node_modules/typescript/lib/tsc.js"),
          "--ignoreConfig",
          "--noEmit",
          "--strict",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--target",
          "ES2024",
          source,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      expect(result.status, result.stdout).not.toBe(0);
      expect(result.stdout).toContain("'unexpected' does not exist");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects phase execution metadata on schema-forbidden adapter variants", async () => {
    const directory = await mkdtemp(
      join(repositoryRoot, ".contract-type-test-"),
    );
    try {
      const source = join(directory, "invalid-adapter-v1.1-phase.mts");
      await writeFile(
        source,
        `
          import type { AdapterMessageV1_1 } from "../packages/contracts/src/generated/contracts.js";

          const common = {
            contractVersion: "1.1.0" as const,
            hostContract: "1.1.0" as const,
            messageId: "message-01",
            host: "codex" as const,
            operation: "phase.execute",
            capabilities: [] as string[],
            observedIdentity: {
              adapterVersion: "1.1.0",
              model: null,
              effort: null,
            },
            correlationId: "correlation-01",
          };
          const phaseExecution = {
            assignmentDigest: "${"a".repeat(64)}",
            model: null,
            effort: null,
          };

          ({
            ...common,
            messageType: "response",
            payloadContract: "result@1.0.0",
            payload: {
              contractVersion: "1.0.0",
              status: "success",
              exitCode: 0,
              reasonCode: "trail.ok",
              summary: "The operation completed.",
              why: [],
              evidence: [],
              stateChanged: false,
              retryable: false,
              recovery: null,
            },
            phaseExecution,
          }) satisfies AdapterMessageV1_1;

          ({
            ...common,
            messageType: "model-catalog",
            payloadContract: "host.model-catalog@1.1.0",
            payload: {
              defaults: {
                planner: "planner",
                implementer: "implementer",
                judge: "judge",
              },
              models: [{
                model: "planner",
                canonicalModel: "planner",
                efforts: ["medium"],
              }],
            },
            phaseExecution,
          }) satisfies AdapterMessageV1_1;

          ({
            ...common,
            messageType: "phase-execution",
            payloadContract: "host.phase-execution@1.1.0",
            payload: phaseExecution,
            phaseExecution,
          }) satisfies AdapterMessageV1_1;
        `,
        "utf8",
      );
      const result = spawnSync(
        process.execPath,
        [
          join(repositoryRoot, "node_modules/typescript/lib/tsc.js"),
          "--ignoreConfig",
          "--noEmit",
          "--strict",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--target",
          "ES2024",
          source,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      expect(result.status, result.stdout).not.toBe(0);
      expect(
        result.stdout.match(/'phaseExecution' does not exist/gu),
      ).toHaveLength(3);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it.each([
    [
      "a write operation without a staged payload",
      `
        ({
          contractVersion: "1.0.0",
          stateContract: "1.0.0",
          transactionId: "transaction-01",
          planDigest: "${"a".repeat(64)}",
          createdAt: "2026-08-09T00:00:00.000Z",
          operations: [{
            operationId: "operation-0001",
            kind: "write_file",
            path: ".brain/state.json",
            expected: { kind: "missing" },
            result: { kind: "file", size: 3, sha256: "${"a".repeat(64)}" },
            stagedPath: null,
          }],
        }) satisfies TransactionManifestV1;
      `,
    ],
    [
      "an additional operation property",
      `
        ({
          contractVersion: "1.0.0",
          stateContract: "1.0.0",
          transactionId: "transaction-01",
          planDigest: "${"a".repeat(64)}",
          createdAt: "2026-08-09T00:00:00.000Z",
          operations: [{
            operationId: "operation-0001",
            kind: "write_file",
            path: ".brain/state.json",
            expected: { kind: "missing" },
            result: { kind: "file", size: 3, sha256: "${"a".repeat(64)}" },
            stagedPath: ".brain/transactions/transaction-01/staging/operation-0001.payload",
            unexpected: true,
          }],
        }) satisfies TransactionManifestV1;
      `,
    ],
    [
      "prepared progress without a manifest digest",
      `
        ({
          contractVersion: "1.0.0",
          stateContract: "1.0.0",
          transactionId: "transaction-01",
          manifestDigest: null,
          recoveryToken: "${"a".repeat(64)}",
          phase: "prepared",
          publishedOperationIds: [],
          fileSync: "required",
          directorySync: "supported",
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:01.000Z",
        }) satisfies TransactionProgressV1;
      `,
    ],
    [
      "an additional progress property",
      `
        ({
          contractVersion: "1.0.0",
          stateContract: "1.0.0",
          transactionId: "transaction-01",
          manifestDigest: "${"a".repeat(64)}",
          recoveryToken: "${"a".repeat(64)}",
          phase: "prepared",
          publishedOperationIds: [],
          fileSync: "required",
          directorySync: "supported",
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:01.000Z",
          unexpected: true,
        }) satisfies TransactionProgressV1;
      `,
    ],
  ])(
    "rejects %s in generated transaction types",
    async (_name, candidate) => {
      const directory = await mkdtemp(
        join(repositoryRoot, ".contract-type-test-"),
      );
      try {
        const source = join(directory, "invalid-transaction.mts");
        await writeFile(
          source,
          `
          import type {
            TransactionManifestV1,
            TransactionProgressV1,
          } from "../packages/contracts/src/generated/contracts.js";
          ${candidate}
        `,
          "utf8",
        );
        const result = spawnSync(
          process.execPath,
          [
            join(repositoryRoot, "node_modules/typescript/lib/tsc.js"),
            "--ignoreConfig",
            "--noEmit",
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2024",
            source,
          ],
          { cwd: repositoryRoot, encoding: "utf8" },
        );
        expect(result.status, result.stdout).not.toBe(0);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
    30000,
  );

  it("accepts every valid generated transaction variant", async () => {
    const directory = await mkdtemp(
      join(repositoryRoot, ".contract-type-test-"),
    );
    try {
      const source = join(directory, "valid-transactions.mts");
      await writeFile(
        source,
        `
          import type {
            TransactionManifestV1,
            TransactionProgressV1,
          } from "../packages/contracts/src/generated/contracts.js";

          const digest = "${"a".repeat(64)}";
          ({
            contractVersion: "1.0.0",
            stateContract: "1.0.0",
            transactionId: "transaction-01",
            planDigest: digest,
            createdAt: "2026-08-09T00:00:00.000Z",
            operations: [
              {
                operationId: "operation-0001",
                kind: "write_file",
                path: ".brain/state.json",
                expected: { kind: "missing" },
                result: { kind: "file", size: 3, sha256: digest },
                stagedPath: ".brain/transactions/transaction-01/staging/operation-0001.payload",
              },
              {
                operationId: "operation-0002",
                kind: "create_directory",
                path: ".brain/runs",
                expected: { kind: "missing" },
                result: { kind: "directory" },
                stagedPath: null,
              },
              {
                operationId: "operation-0003",
                kind: "delete_file",
                path: ".brain/old.json",
                expected: { kind: "file", size: 3, sha256: digest },
                result: { kind: "missing" },
                stagedPath: null,
              },
            ],
          }) satisfies TransactionManifestV1;

          const common = {
            contractVersion: "1.0.0" as const,
            stateContract: "1.0.0" as const,
            transactionId: "transaction-01",
            recoveryToken: digest,
            publishedOperationIds: [] as string[],
            fileSync: "required" as const,
            directorySync: "supported" as const,
            createdAt: "2026-08-09T00:00:00.000Z",
            updatedAt: "2026-08-09T00:00:01.000Z",
          };
          ({ ...common, phase: "begun", manifestDigest: null }) satisfies TransactionProgressV1;
          ({ ...common, phase: "prepared", manifestDigest: digest }) satisfies TransactionProgressV1;
          ({ ...common, phase: "publishing", manifestDigest: digest }) satisfies TransactionProgressV1;
          ({ ...common, phase: "committed", manifestDigest: digest }) satisfies TransactionProgressV1;
          ({ ...common, phase: "aborted", manifestDigest: null }) satisfies TransactionProgressV1;
          ({ ...common, phase: "aborted", manifestDigest: digest }) satisfies TransactionProgressV1;
        `,
        "utf8",
      );
      const result = spawnSync(
        process.execPath,
        [
          join(repositoryRoot, "node_modules/typescript/lib/tsc.js"),
          "--ignoreConfig",
          "--noEmit",
          "--strict",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--target",
          "ES2024",
          source,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      expect(result.status, result.stdout).toBe(0);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 30000);

  it.each([
    ["unknown option", ["--other", "value"]],
    ["duplicate option", ["--generated", "one", "--generated", "two"]],
    ["missing value", ["--generated"]],
  ])("rejects %s as safe usage failure", (_name, args) => {
    const result = check(...args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Contract verification usage error: expected at most one --generated path\n",
    );
  });
});
