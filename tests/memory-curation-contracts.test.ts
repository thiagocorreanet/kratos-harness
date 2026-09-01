import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CONTRACT_VERSIONS } from "@kratos/contracts";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { describe, expect, it } from "vitest";

const root = process.cwd();

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, path), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("deterministic memory-curation contracts", () => {
  it("publishes every additive state and host payload revision", async () => {
    const paths = [
      "schemas/state/failure-candidate.v1.1.schema.json",
      "schemas/state/curated-memory.v1.1.schema.json",
      "schemas/host/memory-change.v1.4.schema.json",
      "schemas/host/memory-curation.v1.4.schema.json",
    ];
    const manifest = await json(
      "packages/contracts/catalogs/contract-families.v1.json",
    );

    await expect(Promise.all(paths.map(json))).resolves.toHaveLength(4);
    expect(manifest).toMatchObject({
      schemas: expect.arrayContaining(
        paths.map((path) => expect.objectContaining({ path })),
      ),
    });
  });

  it("selects and loads each current memory revision", () => {
    const versions = CONTRACT_VERSIONS as Readonly<Record<string, string>>;
    expect(versions).toMatchObject({
      "state.failure-candidate": "1.1.0",
      "state.curated-memory": "1.1.0",
      "host.memory-change": "1.4.0",
      "host.memory-curation": "1.4.0",
    });

    const registry = createSchemaRegistry();
    const sha = "a".repeat(64);
    const values = [
      registry.validate({
        id: "state.failure-candidate",
        version: "1.1.0",
        structuralReasonCode: "runtime.state_corrupt",
        value: {
          contractVersion: "1.1.0",
          stateContract: "1.1.0",
          candidateId: sha,
          toolFamily: "shell",
          failureClass: "nonzero_exit",
          exitCode: 1,
          diagnostic: "failed",
          observationCount: 1,
          firstObservedAt: "2026-09-01T00:00:00Z",
          lastObservedAt: "2026-09-01T00:00:00Z",
        },
      }),
      registry.validate({
        id: "state.curated-memory",
        version: "1.1.0",
        structuralReasonCode: "runtime.state_corrupt",
        value: {
          contractVersion: "1.1.0",
          stateContract: "1.1.0",
          revision: 0,
          projectionDigest: sha,
          updatedAt: "2026-09-01T00:00:00Z",
          confirmed: [],
          archive: [],
        },
      }),
      registry.validate({
        id: "host.memory-change",
        version: "1.4.0",
        structuralReasonCode: "trail.uso",
        value: {
          contractVersion: "1.4.0",
          hostContract: "1.4.0",
          operation: "reinforce",
          reviewer: "reviewer",
          lessonId: sha,
          candidateIds: [sha],
        },
      }),
      registry.validate({
        id: "host.memory-curation",
        version: "1.4.0",
        structuralReasonCode: "trail.uso",
        value: {
          contractVersion: "1.4.0",
          hostContract: "1.4.0",
          kind: "approval",
          reviewer: "reviewer",
          planDigest: sha,
          decisions: [],
        },
      }),
    ];
    expect(values.map(({ kind }) => kind)).toEqual([
      "valid",
      "valid",
      "valid",
      "valid",
    ]);
  });
});
