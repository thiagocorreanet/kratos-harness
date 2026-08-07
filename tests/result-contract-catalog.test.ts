import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const discoveryPath = join(
  repositoryRoot,
  "compatibility/inventory/go-v3-v0.6.5/discovery.json",
);
const catalogPath = join(
  repositoryRoot,
  "packages/contracts/catalogs/reason-codes.v1.json",
);

interface ReasonEntry {
  readonly code: string;
  readonly description: string;
  readonly status: "success" | "failure" | "blocked";
  readonly exitCode: number;
  readonly evidence: "required" | "optional" | "forbidden";
  readonly stateChanged: boolean;
  readonly retryable: boolean;
  readonly recovery: string | null;
}

interface Catalog {
  readonly contractVersion: string;
  readonly reasons: readonly ReasonEntry[];
}

let legacyCodes: string[];
let catalog: Catalog;

beforeAll(async () => {
  const [discovery, parsedCatalog] = await Promise.all([
    readFile(discoveryPath, "utf8").then((value) => JSON.parse(value)),
    readFile(catalogPath, "utf8").then((value) => JSON.parse(value) as Catalog),
  ]);
  legacyCodes = discovery.namespaces.reason_codes.map(
    ({ name }: { readonly name: string }) => name,
  );
  catalog = parsedCatalog;
});

describe("universal result reason catalog", () => {
  it("contains every frozen and runtime reason exactly once", () => {
    const runtimeCodes = [
      "runtime.internal_failure",
      "runtime.lease_conflict",
      "runtime.recovery_required",
      "runtime.revision_conflict",
      "runtime.state_corrupt",
    ];
    const codes = catalog.reasons.map(({ code }) => code);

    expect(catalog.contractVersion).toBe("1.0.0");
    expect(codes).toEqual([...legacyCodes, ...runtimeCodes].sort());
    expect(codes).toHaveLength(76);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("defines a unique actionable policy for every reason", () => {
    const descriptions = new Set<string>();
    const recoveries = new Set<string>();
    for (const reason of catalog.reasons) {
      expect(Object.keys(reason), reason.code).toEqual([
        "code",
        "description",
        "status",
        "exitCode",
        "evidence",
        "stateChanged",
        "retryable",
        "recovery",
      ]);
      expect(reason.code).toMatch(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/u);
      expect(reason.description.length, reason.code).toBeGreaterThan(20);
      expect(descriptions.has(reason.description), reason.code).toBe(false);
      descriptions.add(reason.description);
      if (reason.exitCode === 0) {
        expect(reason.status, reason.code).toBe("success");
        expect(reason.retryable, reason.code).toBe(false);
        expect(reason.recovery, reason.code).toBeNull();
      } else {
        expect(reason.status, reason.code).toBe(
          reason.exitCode < 3 ? "failure" : "blocked",
        );
        expect(reason.stateChanged, reason.code).toBe(false);
        expect(reason.recovery?.length, reason.code).toBeGreaterThan(20);
        expect(recoveries.has(reason.recovery ?? ""), reason.code).toBe(false);
        recoveries.add(reason.recovery ?? "");
      }
    }
  });
});
