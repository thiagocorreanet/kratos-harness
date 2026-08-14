import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const inventoryRoot = join(
  repositoryRoot,
  "compatibility/inventory/go-v3-v0.6.5",
);

interface DiscoveryEntry {
  readonly key: string;
  readonly legacy_refs: readonly string[];
  readonly name: string;
  readonly provenance_id: string;
}

interface Discovery {
  readonly schema_version: number;
  readonly oracle_id: string;
  readonly source: {
    readonly tag: string;
    readonly tag_object: string;
    readonly commit: string;
    readonly distribution_commit: string;
  };
  readonly provenance_id: string;
  readonly namespaces: Record<string, readonly DiscoveryEntry[]>;
}

interface VerificationCase {
  readonly id: string;
  readonly status: "planned" | "passed";
  readonly path: string | null;
}

interface MatrixRow {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly legacy_refs: readonly string[];
  readonly covers: readonly string[];
  readonly expected_behavior: string;
  readonly priority: "P0" | "P1" | "P2";
  readonly typescript_owner:
    | "@mestre-yoda/contracts"
    | "@mestre-yoda/runtime"
    | "@mestre-yoda/adapters"
    | "plugin";
  readonly verification: Record<
    "unit" | "differential" | "integration" | "e2e",
    VerificationCase
  >;
  readonly status:
    "not_started" | "in_progress" | "parity" | "intentional_difference";
  readonly intentional_difference: null | Record<string, unknown>;
}

interface Matrix {
  readonly schema_version: number;
  readonly oracle_id: string;
  readonly rows: readonly MatrixRow[];
}

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(inventoryRoot, name), "utf8")) as T;
}

const activeCommands = [
  "ac",
  "bench",
  "budgets",
  "complete",
  "continue",
  "dashboard",
  "decide",
  "doctor",
  "done",
  "evidence",
  "gaps-sync",
  "gen",
  "guard",
  "guardrails",
  "handoff",
  "help",
  "hook",
  "init",
  "judge",
  "migrate",
  "objective",
  "partition",
  "start",
  "stats",
  "status",
  "step",
  "unlock",
  "validate",
  "version",
  "views",
];

describe("Go v3 parity inventory catalog", () => {
  it("pins the immutable oracle and exhaustive discovery sets", async () => {
    const discovery = await readJson<Discovery>("discovery.json");

    expect(discovery).toMatchObject({
      schema_version: 1,
      oracle_id: "go-v3-v0.6.5",
      source: {
        tag: "v0.6.5",
        tag_object: "720f0a35074451208a0673324d223803add249e0",
        commit: "632f1e9bb283cf83412ef3e9e0b642daefdb0784",
        distribution_commit: "e6e6803c9329a53d362217a8f829a2801c83609d",
      },
      provenance_id: "private-go-v3-hash-only",
    });
    expect(discovery.namespaces.commands?.map(({ name }) => name)).toEqual(
      activeCommands,
    );
    expect(discovery.namespaces.command_forms).toHaveLength(10);
    expect(discovery.namespaces.flags).toHaveLength(59);
    expect(discovery.namespaces.io_contracts).toHaveLength(9);
    expect(discovery.namespaces.exit_codes).toHaveLength(4);
    expect(discovery.namespaces.retired_commands).toHaveLength(8);
    expect(discovery.namespaces.packages).toHaveLength(49);
    expect(discovery.namespaces.schemas).toHaveLength(14);
    expect(discovery.namespaces.plugin_files).toHaveLength(59);
    expect(discovery.namespaces.workflows).toHaveLength(5);
    expect(discovery.namespaces.reason_codes).toHaveLength(71);
    expect(Object.keys(discovery.namespaces).sort()).toEqual(
      [
        "aliases",
        "benchmarks",
        "command_forms",
        "commands",
        "documentation",
        "exit_codes",
        "flags",
        "generated_files",
        "global_flags",
        "human_gates",
        "io_contracts",
        "packages",
        "phases",
        "plugin_files",
        "reason_codes",
        "retired_commands",
        "schemas",
        "state_transitions",
        "workflows",
      ].sort(),
    );
  });

  it("assigns every row stable ownership and four planned evidence cases", async () => {
    const matrix = await readJson<Matrix>("matrix.json");
    expect(matrix).toMatchObject({
      schema_version: 1,
      oracle_id: "go-v3-v0.6.5",
    });
    expect(matrix.rows.length).toBeGreaterThan(0);

    const rowIds = new Set<string>();
    const verificationIds = new Set<string>();
    for (const row of matrix.rows) {
      expect(row.id).toMatch(/^[A-Z][A-Z0-9-]+$/u);
      expect(rowIds.has(row.id), row.id).toBe(false);
      rowIds.add(row.id);
      expect(row.category).not.toBe("");
      expect(row.title).not.toBe("");
      expect(row.legacy_refs.length, row.id).toBeGreaterThan(0);
      expect(row.covers.length, row.id).toBeGreaterThan(0);
      expect(row.expected_behavior).not.toBe("");
      expect(["P0", "P1", "P2"]).toContain(row.priority);
      expect([
        "@mestre-yoda/contracts",
        "@mestre-yoda/runtime",
        "@mestre-yoda/adapters",
        "plugin",
      ]).toContain(row.typescript_owner);
      expect(Object.keys(row.verification).sort(), row.id).toEqual(
        ["unit", "differential", "integration", "e2e"].sort(),
      );
      for (const evidence of Object.values(row.verification)) {
        // Evidence is registered as work lands, so the shape is what stays
        // fixed: planned carries no path, passed carries one, and no other
        // status exists. Asserting that every case is still planned would make
        // this test fail on progress rather than on a defect.
        expect(["planned", "passed"], evidence.id).toContain(evidence.status);
        expect(
          evidence.status === "planned"
            ? evidence.path === null
            : evidence.path,
          evidence.id,
        ).toBeTruthy();
        expect(verificationIds.has(evidence.id), evidence.id).toBe(false);
        verificationIds.add(evidence.id);
      }
      expect(["not_started", "in_progress"], row.id).toContain(row.status);
      // No row claims parity yet: that needs all four cases against a captured
      // predecessor, which no command has.
      expect(row.status, row.id).not.toBe("parity");
      expect(row.intentional_difference, row.id).toBeNull();
    }
  });

  it("protects the PRD contract as dedicated P0 rows", async () => {
    const matrix = await readJson<Matrix>("matrix.json");
    const prdRows = matrix.rows.filter(({ id }) => id.startsWith("PRD-"));

    expect(prdRows.length).toBeGreaterThanOrEqual(4);
    expect(prdRows.every(({ priority }) => priority === "P0")).toBe(true);
    expect(
      new Set(prdRows.flatMap(({ legacy_refs: references }) => references)),
    ).toEqual(
      new Set([
        "agents/prd-researcher.md",
        "schemas/prd-output.schema.json",
        "references/problem-discovery.md",
        "templates/brain/02-features/_template/00-prd.md",
      ]),
    );
  });
});
