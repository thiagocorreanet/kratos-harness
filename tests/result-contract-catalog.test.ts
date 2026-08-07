import { createHash } from "node:crypto";
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

interface Discovery {
  readonly namespaces: {
    readonly reason_codes: readonly { readonly name: string }[];
  };
}

let legacyCodes: string[];
let catalog: Catalog;
let catalogDigest: string;

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

beforeAll(async () => {
  const [discovery, parsedCatalog, catalogText] = await Promise.all([
    readJson<Discovery>(discoveryPath),
    readJson<Catalog>(catalogPath),
    readFile(catalogPath, "utf8"),
  ]);
  legacyCodes = discovery.namespaces.reason_codes.map(({ name }) => name);
  catalog = parsedCatalog;
  catalogDigest = createHash("sha256").update(catalogText).digest("hex");
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
    expect(catalogDigest).toBe(
      "63f91e9ae2c2d1f0dce1ac6313b75a4e3fb27627920620c7bc6eed3ad63dc2e2",
    );
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

  it("preserves non-blocking guard warning exits from Go v3", () => {
    for (const code of ["guard.external_path", "guard.uninspectable"]) {
      expect(
        catalog.reasons.find((reason) => reason.code === code),
        code,
      ).toMatchObject({
        status: "success",
        exitCode: 0,
        stateChanged: false,
        retryable: false,
        recovery: null,
      });
    }
  });

  it("preserves the legacy migration exit and publishes actionable recovery", () => {
    const expected = new Map<string, { exitCode: number; recovery: string }>([
      [
        "brain_migration_pending",
        {
          exitCode: 1,
          recovery:
            "Run `yoda migrate brain` from the project root, verify the sibling Brain repository, and retry.",
        },
      ],
      [
        "gate.aceitacao_final",
        {
          exitCode: 3,
          recovery:
            "Review the final evidence and run `yoda done` to record explicit human acceptance.",
        },
      ],
      [
        "trail.use_done",
        {
          exitCode: 3,
          recovery:
            "Run `yoda done` instead of `yoda continue` for final acceptance.",
        },
      ],
      [
        "trail.maintenance_tty",
        {
          exitCode: 2,
          recovery:
            "Rerun the maintenance operation from an interactive terminal.",
        },
      ],
      [
        "trail.worktree_dirty",
        {
          exitCode: 2,
          recovery:
            "Commit, stash, or revert disallowed worktree changes, then retry the code-step operation.",
        },
      ],
    ]);
    for (const [code, policy] of expected) {
      expect(
        catalog.reasons.find((reason) => reason.code === code),
        code,
      ).toMatchObject(policy);
    }
    for (const reason of catalog.reasons) {
      if (reason.recovery !== null) {
        expect(reason.recovery, reason.code).not.toMatch(
          /^Resolve .*reload the authoritative project state, and repeat the operation\.$/u,
        );
      }
    }
  });
});
