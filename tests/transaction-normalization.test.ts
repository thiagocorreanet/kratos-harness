import { planOf } from "@mestre-yoda/runtime/domain/effects";
import {
  TransactionPolicyError,
  normalizeManagedMutationPlan,
  toPersistedManagedOperation,
  type PathFingerprint,
} from "@mestre-yoda/runtime/domain/transactions";
import { describe, expect, it } from "vitest";

const missing = { kind: "missing" } as const;
const directory = { kind: "directory" } as const;
const sha256 = (text: string): string => `sha256:${text}`;

function observations(
  entries: readonly (readonly [string, PathFingerprint])[],
): ReadonlyMap<string, PathFingerprint> {
  return new Map(entries);
}

describe("managed mutation plan normalization", () => {
  it("normalizes a write with stable identity and transient content", () => {
    expect(
      normalizeManagedMutationPlan(
        planOf({
          kind: "write_file",
          path: ".brain/runs/a/state.json",
          content: "new state",
        }),
        observations([
          [".brain/runs", directory],
          [".brain/runs/a", directory],
          [".brain/runs/a/state.json", missing],
        ]),
        sha256,
      ),
    ).toEqual({
      kind: "ready",
      plan: {
        operations: [
          {
            operationId: "operation-0001",
            kind: "write_file",
            path: ".brain/runs/a/state.json",
            expected: missing,
            result: {
              kind: "file",
              size: 9,
              sha256: "sha256:new state",
            },
            stagedPath: "staging/operation-0001.payload",
            content: "new state",
          },
        ],
      },
    });
  });

  it("excludes output effects from the managed plan", () => {
    expect(
      normalizeManagedMutationPlan(
        planOf({ kind: "emit", channel: "human", text: "ready" }),
        new Map(),
        sha256,
      ),
    ).toEqual({ kind: "noop" });
  });

  it("makes each missing write parent explicit before the write", () => {
    const result = normalizeManagedMutationPlan(
      planOf({
        kind: "write_file",
        path: ".brain/runs/a/state.json",
        content: "x",
      }),
      new Map(),
      sha256,
    );

    expect(result).toMatchObject({
      kind: "ready",
      plan: {
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/runs",
          },
          {
            operationId: "operation-0002",
            kind: "create_directory",
            path: ".brain/runs/a",
          },
          {
            operationId: "operation-0003",
            kind: "write_file",
            path: ".brain/runs/a/state.json",
          },
        ],
      },
    });
  });

  it("synthesizes a shared missing parent only once", () => {
    const result = normalizeManagedMutationPlan(
      planOf(
        { kind: "write_file", path: ".brain/runs/a.json", content: "a" },
        { kind: "write_file", path: ".brain/runs/b.json", content: "b" },
      ),
      new Map(),
      sha256,
    );

    expect(result).toMatchObject({
      kind: "ready",
      plan: {
        operations: [
          { kind: "create_directory", path: ".brain/runs" },
          { kind: "write_file", path: ".brain/runs/a.json" },
          { kind: "write_file", path: ".brain/runs/b.json" },
        ],
      },
    });
  });

  it("makes missing parents explicit before a deep directory creation", () => {
    const result = normalizeManagedMutationPlan(
      planOf({ kind: "create_directory", path: ".brain/runs/a" }),
      new Map(),
      sha256,
    );

    expect(result).toMatchObject({
      kind: "ready",
      plan: {
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/runs",
          },
          {
            operationId: "operation-0002",
            kind: "create_directory",
            path: ".brain/runs/a",
          },
        ],
      },
    });
  });

  it("creates each missing parent once before a following write", () => {
    const result = normalizeManagedMutationPlan(
      planOf(
        { kind: "create_directory", path: ".brain/runs/a" },
        {
          kind: "write_file",
          path: ".brain/runs/a/state.json",
          content: "state",
        },
      ),
      new Map(),
      sha256,
    );

    expect(result).toMatchObject({
      kind: "ready",
      plan: {
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/runs",
          },
          {
            operationId: "operation-0002",
            kind: "create_directory",
            path: ".brain/runs/a",
          },
          {
            operationId: "operation-0003",
            kind: "write_file",
            path: ".brain/runs/a/state.json",
          },
        ],
      },
    });
  });

  it("removes an already-equal write and returns a no-op", () => {
    expect(
      normalizeManagedMutationPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "é",
        }),
        observations([
          [".brain/state.json", { kind: "file", size: 2, sha256: "sha256:é" }],
        ]),
        sha256,
      ),
    ).toEqual({ kind: "noop" });
  });

  it("removes satisfied directory creation and missing deletion", () => {
    expect(
      normalizeManagedMutationPlan(
        planOf(
          { kind: "create_directory", path: ".brain/runs" },
          { kind: "delete_file", path: ".brain/old.json" },
        ),
        observations([
          [".brain/runs", directory],
          [".brain/old.json", missing],
        ]),
        sha256,
      ),
    ).toEqual({ kind: "noop" });
  });

  it("preserves declared order after satisfied effects are removed", () => {
    const result = normalizeManagedMutationPlan(
      planOf(
        { kind: "emit", channel: "structured", text: "ignored" },
        { kind: "write_file", path: ".brain/b.json", content: "b" },
        { kind: "create_directory", path: ".brain/satisfied" },
        { kind: "delete_file", path: ".brain/a.json" },
        { kind: "create_directory", path: ".brain/new" },
      ),
      observations([
        [".brain/b.json", missing],
        [".brain/satisfied", directory],
        [".brain/a.json", { kind: "file", size: 1, sha256: "sha256:a" }],
        [".brain/new", missing],
      ]),
      sha256,
    );

    expect(result).toMatchObject({
      kind: "ready",
      plan: {
        operations: [
          { operationId: "operation-0001", path: ".brain/b.json" },
          { operationId: "operation-0002", path: ".brain/a.json" },
          { operationId: "operation-0003", path: ".brain/new" },
        ],
      },
    });
  });

  it("omits transient write content from persisted operations", () => {
    const result = normalizeManagedMutationPlan(
      planOf({ kind: "write_file", path: ".brain/state.json", content: "x" }),
      observations([[".brain/state.json", missing]]),
      sha256,
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    const persisted = result.plan.operations.map(toPersistedManagedOperation);
    expect(persisted).toEqual([
      {
        operationId: "operation-0001",
        kind: "write_file",
        path: ".brain/state.json",
        expected: missing,
        result: { kind: "file", size: 1, sha256: "sha256:x" },
        stagedPath: "staging/operation-0001.payload",
      },
    ]);
    expect(JSON.stringify(persisted)).not.toContain("content");
  });

  it("persists directory creation and deletion without transient content", () => {
    const deleted = { kind: "file", size: 3, sha256: "sha256:old" } as const;
    const result = normalizeManagedMutationPlan(
      planOf(
        { kind: "create_directory", path: ".brain/new" },
        { kind: "delete_file", path: ".brain/old.json" },
      ),
      observations([
        [".brain/new", missing],
        [".brain/old.json", deleted],
      ]),
      sha256,
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    expect(result.plan.operations.map(toPersistedManagedOperation)).toEqual([
      {
        operationId: "operation-0001",
        kind: "create_directory",
        path: ".brain/new",
        expected: missing,
        result: directory,
        stagedPath: null,
      },
      {
        operationId: "operation-0002",
        kind: "delete_file",
        path: ".brain/old.json",
        expected: deleted,
        result: missing,
        stagedPath: null,
      },
    ]);
  });

  it.each([
    ["outside the managed root", "state.json"],
    ["the managed root itself", ".brain"],
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
  ])("rejects %s", (_name, path) => {
    expect(() =>
      normalizeManagedMutationPlan(
        planOf({ kind: "write_file", path, content: "x" }),
        new Map(),
        sha256,
      ),
    ).toThrow(expect.objectContaining({ reasonCode: "guard.outside_allow" }));
  });

  it("rejects append effects until canonical event append exists", () => {
    expect(() =>
      normalizeManagedMutationPlan(
        planOf({ kind: "append_event", event: "event" }),
        new Map(),
        sha256,
      ),
    ).toThrow(expect.objectContaining({ reasonCode: "runtime.state_corrupt" }));
  });

  it.each([
    [
      "duplicate destinations",
      planOf(
        { kind: "write_file", path: ".brain/a", content: "one" },
        { kind: "write_file", path: ".brain/a", content: "two" },
      ),
    ],
    [
      "case-colliding destinations",
      planOf(
        { kind: "write_file", path: ".brain/A", content: "one" },
        { kind: "write_file", path: ".brain/a", content: "two" },
      ),
    ],
    [
      "case-colliding implicit parents",
      planOf(
        { kind: "write_file", path: ".brain/Runs/a", content: "one" },
        { kind: "write_file", path: ".brain/runs/b", content: "two" },
      ),
    ],
    [
      "a file target overlapping a child target",
      planOf(
        { kind: "write_file", path: ".brain/a", content: "one" },
        { kind: "write_file", path: ".brain/a/child", content: "two" },
      ),
    ],
    [
      "a parent declared after its child",
      planOf(
        { kind: "write_file", path: ".brain/a/child", content: "one" },
        { kind: "create_directory", path: ".brain/a" },
      ),
    ],
  ])("rejects %s", (_name, plan) => {
    expect(() => normalizeManagedMutationPlan(plan, new Map(), sha256)).toThrow(
      expect.objectContaining({ reasonCode: "runtime.state_corrupt" }),
    );
  });

  it("rejects deletion of an observed directory", () => {
    expect(() =>
      normalizeManagedMutationPlan(
        planOf({ kind: "delete_file", path: ".brain/runs" }),
        observations([[".brain/runs", directory]]),
        sha256,
      ),
    ).toThrow(TransactionPolicyError);
  });

  it("rejects replacing an observed directory with a file", () => {
    expect(() =>
      normalizeManagedMutationPlan(
        planOf({ kind: "write_file", path: ".brain/runs", content: "x" }),
        observations([[".brain/runs", directory]]),
        sha256,
      ),
    ).toThrow(expect.objectContaining({ reasonCode: "runtime.state_corrupt" }));
  });

  it("rejects a write below an observed file parent", () => {
    expect(() =>
      normalizeManagedMutationPlan(
        planOf({
          kind: "write_file",
          path: ".brain/runs/state.json",
          content: "x",
        }),
        observations([
          [".brain/runs", { kind: "file", size: 1, sha256: "sha256:x" }],
        ]),
        sha256,
      ),
    ).toThrow(expect.objectContaining({ reasonCode: "runtime.state_corrupt" }));
  });

  it("rejects creating a directory over an observed file", () => {
    expect(() =>
      normalizeManagedMutationPlan(
        planOf({ kind: "create_directory", path: ".brain/runs" }),
        observations([
          [".brain/runs", { kind: "file", size: 1, sha256: "sha256:x" }],
        ]),
        sha256,
      ),
    ).toThrow(expect.objectContaining({ reasonCode: "runtime.state_corrupt" }));
  });
});
