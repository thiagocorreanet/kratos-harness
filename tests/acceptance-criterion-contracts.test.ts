import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(repositoryRoot, path), "utf8"),
  ) as Record<string, unknown>;
}

const snapshot = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  runId: "run-01",
  eventId: "event-plan",
  sourceRef: ".brain/02-features/refunds/02-tasks.md",
  sourceDigest: "a".repeat(64),
  recordedAt: "2026-08-27T12:00:00Z",
  previousSnapshotRef: null,
  declarations: [
    {
      criterionId: "AC-01.2.E3",
      workUnit: "01",
      task: "2",
      kind: "edge",
      ordinal: 0,
      declarationDigest: "b".repeat(64),
    },
  ],
} as const;

const verdict = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  runId: "run-01",
  eventId: "event-acceptance",
  criterionId: "AC-01.2.E3",
  outcome: "failed",
  criteriaSnapshotRef:
    ".brain/02-features/refunds/runs/run-01/acceptance/criteria/event-plan.json",
  criteriaSnapshotDigest: "c".repeat(64),
  evidenceId: "evidence-edge-3",
  evidenceRef: ".brain/02-features/refunds/runs/run-01/evidence/edge-3.json",
  evidenceDigest: "d".repeat(64),
  recordedAt: "2026-08-27T12:05:00Z",
} as const;

describe("acceptance criterion contracts", () => {
  it("preserves the published host and predecessor manifest schema bytes", async () => {
    const [agentOutput, manifestV1, manifestV11] = await Promise.all([
      readFile(
        join(repositoryRoot, "schemas/host/agent-output.v1.schema.json"),
        "utf8",
      ),
      readFile(
        join(
          repositoryRoot,
          "schemas/contracts/contract-manifest.v1.schema.json",
        ),
        "utf8",
      ),
      readFile(
        join(
          repositoryRoot,
          "schemas/contracts/contract-manifest.v1.1.schema.json",
        ),
        "utf8",
      ),
    ]);
    expect(createHash("sha256").update(agentOutput).digest("hex")).toBe(
      "7d95ea2c2541c12b8e960094bb3bd197b35f5f55ffd6412581449efacde54d3a",
    );
    expect(createHash("sha256").update(manifestV1).digest("hex")).toBe(
      "a87dd52092ee34eb3d0a1e182f10481c87a83111f104607c2a5df378a431e629",
    );
    expect(createHash("sha256").update(manifestV11).digest("hex")).toBe(
      "ec050850bcf9cb584bee1f27a047891d3ed60236a36be3c7bb586fad7cea281e",
    );
  });

  it("exposes one matcher for the published grammar and length boundary", async () => {
    const contracts = (await import("@kratos/contracts")) as Record<
      string,
      unknown
    >;

    expect(contracts.ACCEPTANCE_CRITERION_ID_PATTERN).toBe(
      "^AC-\\d+\\.\\d+\\.E?\\d+$",
    );
    expect(contracts.ACCEPTANCE_CRITERION_ID_MAX_LENGTH).toBe(128);

    const matches = contracts.isAcceptanceCriterionId as
      ((value: unknown) => boolean) | undefined;
    expect(typeof matches).toBe("function");
    if (matches === undefined) return;
    expect(matches("AC-1.2.3")).toBe(true);
    expect(matches("AC-01.002.E0003")).toBe(true);
    expect(matches("AC-1.2.EE3")).toBe(false);
    expect(matches("AC--1.2.3")).toBe(false);
    expect(matches(`AC-${"1".repeat(122)}.2.3`)).toBe(false);
  });

  it("validates immutable declaration snapshots from the canonical id schema", async () => {
    const [criterionId, schema] = await Promise.all([
      json("schemas/contracts/acceptance-criterion-id.v1.schema.json"),
      json("schemas/state/acceptance-criteria-snapshot.v1.schema.json"),
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(criterionId);
    const validate = ajv.compile(schema);

    expect(validate(snapshot), JSON.stringify(validate.errors)).toBe(true);
    expect(
      validate({
        ...snapshot,
        declarations: [
          { ...snapshot.declarations[0], criterionId: "AC-01.2.EE3" },
        ],
      }),
    ).toBe(false);
    expect(validate({ ...snapshot, unexpected: true })).toBe(false);
  });

  it("binds each verdict to one criterion, snapshot, and evidence digest", async () => {
    const [criterionId, schema] = await Promise.all([
      json("schemas/contracts/acceptance-criterion-id.v1.schema.json"),
      json("schemas/state/acceptance-verdict.v1.schema.json"),
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(criterionId);
    const validate = ajv.compile(schema);

    expect(validate(verdict), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...verdict, evidenceDigest: "not-a-digest" })).toBe(
      false,
    );
    expect(validate({ ...verdict, criterionId: "criterion-edge-3" })).toBe(
      false,
    );
  });
});
