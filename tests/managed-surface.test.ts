import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planOf } from "@mestre-yoda/runtime/domain/effects";
import {
  isManagedDestination,
  isManagedPathShape,
  normalizeManagedMutationPlan,
} from "@mestre-yoda/runtime/domain/transactions";
import { nodeDurableFileSystem } from "@mestre-yoda/runtime/infra/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Everything a plan may target, one entry per reason it is legal. */
export const ACCEPTED: readonly string[] = [
  ".brain/config.json",
  ".brain/02-features/_template/state.json",
  ".claude/settings.json",
  ".codex/config.toml",
  ".codex/agents/spec-planner.toml",
  "AGENTS.md",
  "CLAUDE.md",
];

/** Everything a plan may not target, and the reason it may not. */
export const REFUSED: readonly (readonly [string, string])[] = [
  ["an unmanaged root file", "state.json"],
  ["an unmanaged root file with a managed extension", "readme.md"],
  ["a root file off by its case", "claude.md"],
  ["a managed root itself", ".brain"],
  ["a host root itself", ".claude"],
  ["an unmanaged directory", "src/index.ts"],
  ["a root file used as a directory", "CLAUDE.md/nested.md"],
  ["a near-miss root", ".claudex/settings.json"],
  ["the reserved transaction namespace", ".brain/transactions/forbidden"],
  ["the reserved namespace with a case alias", ".brain/TRANSACTIONS/x"],
  ["an absolute path", "/.brain/state.json"],
  ["a drive-qualified path", "C:/.brain/state.json"],
  ["a backslash-bearing path", ".brain\\state.json"],
  ["a traversing path", ".brain/../state.json"],
  ["a dot segment", ".brain/./state.json"],
  ["an empty segment", ".brain//state.json"],
  ["a trailing separator", ".brain/state.json/"],
  ["a control character", ".brain/state\n.json"],
  ["an empty path", ""],
];

describe("the managed surface", () => {
  it.each(ACCEPTED)("accepts %s", (path) => {
    expect(isManagedDestination(path)).toBe(true);
  });

  it.each(REFUSED)("refuses %s", (_label, path) => {
    // Every entry below the first four was refused before the surface widened.
    // A rule that stops refusing what it refused is the regression this table
    // exists to prevent.
    expect(isManagedDestination(path)).toBe(false);
  });

  it("does not accept a host namespace the inventory never named", () => {
    // The surface widened by exact spelling. A pattern over the project root
    // would accept files this runtime has no business writing.
    expect(isManagedDestination(".cursor/settings.json")).toBe(false);
    expect(isManagedDestination("GEMINI.md")).toBe(false);
  });

  it("reserves the transaction namespace only inside the managed state root", () => {
    // `.brain/transactions` belongs to the transaction manager. A directory of
    // the same name under a host surface is just a directory.
    expect(isManagedDestination(".codex/transactions/x.toml")).toBe(true);
  });

  it("closes the reserved namespace to callers without closing it to the manager", () => {
    // The manager writes its own namespace through the same adapter, so the
    // shape it may operate on is wider than the set a plan may target. That
    // difference is the one place the two rules part company.
    expect(isManagedPathShape(".brain/transactions/tx-1/manifest.json")).toBe(
      true,
    );
    expect(isManagedDestination(".brain/transactions/tx-1/manifest.json")).toBe(
      false,
    );
  });
});

/** Spellings close enough to a legal path to catch a rule that drifted. */
const NEAR_MISSES: readonly string[] = [
  ".brain/",
  "./brain/state.json",
  ".BRAIN/state.json",
  ".Claude/settings.json",
  "CLAUDE.MD",
  "agents.md",
  "AGENTS.md/",
  ".brain/transactions",
  ".brain/transactionsx/file.json",
  "..",
];

describe("every layer answers alike", () => {
  const sha256 = (text: string): string => `sha256:${text}`;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "yoda-managed-surface-"));
  });

  afterAll(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it.each([
    ...ACCEPTED,
    ...REFUSED.map(([, path]) => path),
    ...NEAR_MISSES,
    ".brain/transactions/tx-1/manifest.json",
  ])("gives the planner and the adapter one answer about %s", async (path) => {
    const adapterAccepts = await nodeDurableFileSystem(root)
      .inspect(path)
      .then(
        () => true,
        (error: unknown) =>
          !(
            error instanceof Error &&
            error.message.includes("Runtime path escapes the project")
          ),
      );
    const plannerAccepts = (() => {
      try {
        normalizeManagedMutationPlan(
          planOf({ kind: "write_file", path, content: "x" }),
          new Map(),
          sha256,
        );
        return true;
      } catch {
        return false;
      }
    })();

    // The adapter answers the shape question and the planner answers the
    // destination question. Comparing each against its own rule is what proves
    // the layers cannot drift apart: a hole opens when one accepts a path the
    // other refuses.
    expect(adapterAccepts).toBe(isManagedPathShape(path));
    expect(plannerAccepts).toBe(isManagedDestination(path));
  });

  it("treats the project root as a sentinel rather than as a path", () => {
    // `.` is not a managed path and never becomes one. It is the name two
    // adapter methods answer to so a root file has a parent, and the planner
    // never emits it as a destination.
    expect(isManagedPathShape(".")).toBe(false);
    expect(isManagedDestination(".")).toBe(false);
  });
});
