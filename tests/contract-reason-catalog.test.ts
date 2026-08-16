import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const catalogV1Path = join(
  repositoryRoot,
  "packages/contracts/catalogs/reason-codes.v1.json",
);
const catalogV11Path = join(
  repositoryRoot,
  "packages/contracts/catalogs/reason-codes.v1.1.json",
);
const catalogV12Path = join(
  repositoryRoot,
  "packages/contracts/catalogs/reason-codes.v1.2.json",
);
const catalogV13Path = join(
  repositoryRoot,
  "packages/contracts/catalogs/reason-codes.v1.3.json",
);
const resultLibraryUrl = pathToFileURL(
  join(repositoryRoot, "scripts/lib/result-contract.mjs"),
).href;

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

const additions = new Map([
  ["contract.plugin_version_invalid", 2],
  ["contract.plugin_version_unsupported", 2],
  ["contract.host_version_invalid", 2],
  ["contract.host_version_unsupported", 2],
  ["contract.state_version_invalid", 4],
  ["contract.state_version_unsupported", 4],
]);

let catalogV1: Catalog;
let catalogV11: Catalog;
let catalogV12: Catalog;
let catalogV13: Catalog;
let catalogV1Text: string;
let catalogV11Text: string;
let catalogV12Text: string;
let catalogV13Text: string;

beforeAll(async () => {
  [catalogV1Text, catalogV11Text, catalogV12Text, catalogV13Text] =
    await Promise.all([
      readFile(catalogV1Path, "utf8"),
      readFile(catalogV11Path, "utf8"),
      readFile(catalogV12Path, "utf8"),
      readFile(catalogV13Path, "utf8"),
    ]);
  catalogV1 = JSON.parse(catalogV1Text) as Catalog;
  catalogV11 = JSON.parse(catalogV11Text) as Catalog;
  catalogV12 = JSON.parse(catalogV12Text) as Catalog;
  catalogV13 = JSON.parse(catalogV13Text) as Catalog;
});

// The frozen digests below were re-taken after the CLI was renamed to
// `kratos`, which rewrote the `recovery` prose in three entries of every
// revision. Nothing else about the catalogs changed: the append-only prefix,
// the counts, and the added codes are all asserted separately below.
describe("contract reason catalog revision", () => {
  it("preserves revision 1.0 and appends exactly six contract reasons", () => {
    expect(createHash("sha256").update(catalogV1Text).digest("hex")).toBe(
      "14144f56a02ed554de3ad6097051c30ec3f434c7ceeae291c55479ffc9bf0067",
    );
    expect(createHash("sha256").update(catalogV11Text).digest("hex")).toBe(
      "ba004693afccd7eab46af26dde4457e71f1444aede7c56ab37a83726005d434a",
    );
    expect(catalogV11.contractVersion).toBe("1.0.0");
    expect(catalogV11.reasons.slice(0, catalogV1.reasons.length)).toEqual(
      catalogV1.reasons,
    );
    expect(catalogV11.reasons).toHaveLength(82);
    expect(
      catalogV11.reasons
        .slice(catalogV1.reasons.length)
        .map(({ code }) => code),
    ).toEqual([...additions.keys()]);
  });

  it("preserves revision 1.1 and appends the unsupported interpreter reason", () => {
    expect(createHash("sha256").update(catalogV12Text).digest("hex")).toBe(
      "2268cd725dded7389f17f6417fe088e6884fd14474994a31bf0281618e008704",
    );
    expect(catalogV12.contractVersion).toBe("1.0.0");
    expect(catalogV12.reasons.slice(0, catalogV11.reasons.length)).toEqual(
      catalogV11.reasons,
    );
    expect(catalogV12.reasons).toHaveLength(83);
    expect(
      catalogV12.reasons
        .slice(catalogV11.reasons.length)
        .map(({ code }) => code),
    ).toEqual(["runtime.node_unsupported"]);
  });

  it("fails closed on an unsupported interpreter without publishing evidence", () => {
    const reason = catalogV12.reasons.find(
      ({ code }) => code === "runtime.node_unsupported",
    );
    expect(reason).toMatchObject({
      status: "failure",
      exitCode: 2,
      evidence: "forbidden",
      stateChanged: false,
      retryable: false,
    });
    // The recovery text is what the preflight embeds, so it must name the floor.
    expect(reason?.recovery).toContain("24.0.0");
  });

  it("preserves revision 1.2 and appends the orientation reason", () => {
    expect(createHash("sha256").update(catalogV13Text).digest("hex")).toBe(
      "7959f09ca0c72c2201bc651fefd1e630c9e85a0f3a5f6489c3df5f680a551662",
    );
    expect(catalogV13.contractVersion).toBe("1.0.0");
    expect(catalogV13.reasons.slice(0, catalogV12.reasons.length)).toEqual(
      catalogV12.reasons,
    );
    expect(catalogV13.reasons).toHaveLength(84);
    expect(
      catalogV13.reasons
        .slice(catalogV12.reasons.length)
        .map(({ code }) => code),
    ).toEqual(["runtime.orientation_ok"]);
  });

  it("lets orientation output succeed without claiming evidence or mutation", () => {
    expect(
      catalogV13.reasons.find(({ code }) => code === "runtime.orientation_ok"),
    ).toMatchObject({
      status: "success",
      exitCode: 0,
      evidence: "optional",
      stateChanged: false,
      retryable: false,
      recovery: null,
    });
  });

  it("defines safe fail-closed policy for every new reason", () => {
    for (const [code, exitCode] of additions) {
      expect(
        catalogV11.reasons.find((reason) => reason.code === code),
        code,
      ).toMatchObject({
        exitCode,
        evidence: "forbidden",
        stateChanged: false,
        retryable: false,
      });
    }
  });

  it("renders every new reason through the universal result contract", () => {
    for (const reason of catalogV11.reasons.slice(catalogV1.reasons.length)) {
      const result = {
        contractVersion: "1.0.0",
        status: reason.status,
        exitCode: reason.exitCode,
        reasonCode: reason.code,
        summary: reason.description,
        why: ["The declared compatibility identity cannot be accepted."],
        evidence: [],
        stateChanged: false,
        retryable: false,
        recovery: reason.recovery,
      };
      const source = `
        import { canonicalResultJson } from ${JSON.stringify(resultLibraryUrl)};
        process.stdout.write(canonicalResultJson(JSON.parse(process.argv[1])));
      `;
      const rendered = spawnSync(
        process.execPath,
        ["--input-type=module", "--eval", source, JSON.stringify(result)],
        { cwd: repositoryRoot, encoding: "utf8" },
      );

      expect(rendered.status, reason.code).toBe(0);
      expect(rendered.stderr, reason.code).toBe("");
      expect(JSON.parse(rendered.stdout), reason.code).toEqual(result);
    }
  });
});
