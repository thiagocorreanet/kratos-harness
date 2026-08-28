import type { FeatureScopeV1, PreToolUseV1 } from "@kratos/contracts";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCommandLine } from "@kratos/runtime/composition/cli";
import { renderSummaryScope } from "@kratos/runtime/domain/write-guard";
import { createRuntimeAt } from "@kratos/runtime/composition";
import { pipedInput, recordingOutput } from "@kratos/runtime/infra/fake";
import type { RuntimePorts } from "@kratos/runtime/ports";

const roots: string[] = [];
const feature = "scope-guard";

const scope = (
  allow: readonly string[],
  deny: readonly string[] = [],
): FeatureScopeV1 => ({
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  allow: [...allow],
  deny: [...deny],
});

const guardrails = JSON.stringify(
  {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    policyMode: "standard",
    snapshots: true,
    managedPaths: [".brain"],
    writeBlocks: ["private/**"],
  },
  null,
  2,
);

async function project(
  options: {
    readonly scope?: FeatureScopeV1 | "corrupt";
    readonly summary?: FeatureScopeV1 | "malformed";
    readonly guardrails?: string;
  } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kratos-guard-operation-"));
  roots.push(root);
  const featureRoot = join(root, ".brain/02-features", feature);
  await mkdir(join(root, ".brain/transactions"), { recursive: true });
  await mkdir(featureRoot, { recursive: true });
  await writeFile(join(root, ".brain/02-features/active"), `${feature}\n`);
  await writeFile(
    join(root, ".brain/guardrails.json"),
    options.guardrails ?? `${guardrails}\n`,
  );
  if (options.scope !== undefined) {
    await writeFile(
      join(featureRoot, "scope.json"),
      options.scope === "corrupt"
        ? "{not-json\n"
        : `${JSON.stringify(options.scope, null, 2)}\n`,
    );
  }
  if (options.summary !== undefined) {
    await writeFile(
      join(featureRoot, "03-summa.md"),
      options.summary === "malformed"
        ? "## File allowlist\n\n- src/**\n\n## File denylist\n"
        : renderSummaryScope(options.summary),
    );
  }
  return root;
}

async function runGuard(
  root: string,
  request: unknown,
  overrides: Partial<RuntimePorts> = {},
) {
  const output = recordingOutput();
  const exitCode = await runCommandLine(
    ["--json", "guard", "write"],
    createRuntimeAt(root, {
      ...overrides,
      output,
      standardInput: pipedInput(JSON.stringify(request)),
    }),
  );
  return {
    exitCode,
    result: JSON.parse(output.structured_.join("")) as {
      readonly reasonCode: string;
      readonly stateChanged: boolean;
      readonly evidence: readonly {
        readonly kind: string;
        readonly ref: string;
      }[];
    },
  };
}

function request(mutations: PreToolUseV1["mutations"]): PreToolUseV1 {
  return {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    mutations,
  };
}

async function tree(root: string, relative = ""): Promise<readonly string[]> {
  const entries = await readdir(join(root, relative));
  const observed: string[] = [];
  for (const name of entries.sort()) {
    const path = relative === "" ? name : `${relative}/${name}`;
    const details = await lstat(join(root, path));
    if (details.isSymbolicLink()) {
      observed.push(`${path}->${await readlink(join(root, path))}`);
    } else if (details.isDirectory()) {
      observed.push(`${path}/`, ...(await tree(root, path)));
    } else {
      observed.push(`${path}:${await readFile(join(root, path), "utf8")}`);
    }
  }
  return observed;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("guard write operation", () => {
  it("rejects a malformed pre-tool request before target inspection", async () => {
    const root = await project();

    const result = await runGuard(root, {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      mutations: [{ kind: "move", source: "src/only-source.ts" }],
    });

    expect(result.result).toMatchObject({
      reasonCode: "guard.target_uninspectable",
      stateChanged: false,
      evidence: [{ kind: "observation", ref: "guard-target-0001" }],
    });
  });

  it("extracts create, update, delete, and both ordered move endpoints", async () => {
    const activeScope = scope(["allowed/**"]);
    const root = await project({ scope: activeScope, summary: activeScope });

    const result = await runGuard(
      root,
      request([
        { kind: "create", path: "allowed/create.ts" },
        { kind: "update", path: "allowed/update.ts" },
        { kind: "delete", path: "allowed/delete.ts" },
        {
          kind: "move",
          source: "allowed/source.ts",
          destination: "allowed/destination.ts",
        },
      ]),
    );

    expect(result.exitCode).toBe(0);
    expect(result.result).toMatchObject({
      reasonCode: "runtime.orientation_ok",
      stateChanged: false,
    });
  });

  it("refuses the whole request at the first target in normalized order", async () => {
    const activeScope = scope(["allowed/**"]);
    const root = await project({ scope: activeScope, summary: activeScope });

    const result = await runGuard(
      root,
      request([
        { kind: "update", path: "outside/first.ts" },
        { kind: "update", path: ".env" },
      ]),
    );

    expect(result.result).toMatchObject({
      reasonCode: "guard.outside_allow",
      stateChanged: false,
      evidence: [{ kind: "artifact", ref: "outside/first.ts" }],
    });
  });

  it("does not let a later path failure replace an earlier policy refusal", async () => {
    const activeScope = scope(["allowed/**"]);
    const root = await project({ scope: activeScope, summary: activeScope });
    await symlink("absent", join(root, "dangling"));

    const result = await runGuard(
      root,
      request([
        { kind: "update", path: "outside/first.ts" },
        { kind: "update", path: "dangling" },
      ]),
    );

    expect(result.result).toMatchObject({
      reasonCode: "guard.outside_allow",
      evidence: [{ kind: "artifact", ref: "outside/first.ts" }],
    });
  });

  it("checks a move source before its destination", async () => {
    const activeScope = scope(["allowed/**"]);
    const root = await project({ scope: activeScope, summary: activeScope });

    const result = await runGuard(
      root,
      request([
        {
          kind: "move",
          source: "outside/source.ts",
          destination: ".env",
        },
      ]),
    );

    expect(result.result.evidence).toEqual([
      { kind: "artifact", ref: "outside/source.ts" },
    ]);
  });

  it("inspects and refuses a forbidden move destination after an allowed source", async () => {
    const activeScope = scope(["allowed/**"], ["forbidden/**"]);
    const root = await project({ scope: activeScope, summary: activeScope });

    const result = await runGuard(
      root,
      request([
        {
          kind: "move",
          source: "allowed/source.ts",
          destination: "forbidden/destination.ts",
        },
      ]),
    );

    expect(result.result).toMatchObject({
      reasonCode: "guard.scope_deny",
      evidence: [{ kind: "artifact", ref: "forbidden/destination.ts" }],
    });
  });

  it.each([
    ["delete", [{ kind: "delete", path: "links/final.ts" }]],
    [
      "move source",
      [
        {
          kind: "move",
          source: "links/final.ts",
          destination: "allowed/destination.ts",
        },
      ],
    ],
    [
      "move destination",
      [
        {
          kind: "move",
          source: "allowed/source.ts",
          destination: "links/final.ts",
        },
      ],
    ],
  ] as const)(
    "authorizes the lexical directory entry for %s",
    async (_label, mutations) => {
      const activeScope = scope(["allowed/**"], ["links/**"]);
      const root = await project({ scope: activeScope, summary: activeScope });
      await mkdir(join(root, "allowed"));
      await mkdir(join(root, "links"));
      await writeFile(join(root, "allowed/target.ts"), "target\n");
      await symlink("../allowed/target.ts", join(root, "links/final.ts"));

      const result = await runGuard(root, request([...mutations]));

      expect(result.result).toMatchObject({
        reasonCode: "guard.scope_deny",
        evidence: [{ kind: "artifact", ref: "links/final.ts" }],
      });
    },
  );

  it("authorizes the canonical referent while keeping lexical evidence", async () => {
    const activeScope = scope(["allowed/**"], ["forbidden/**"]);
    const root = await project({ scope: activeScope, summary: activeScope });
    await mkdir(join(root, "allowed"));
    await mkdir(join(root, "forbidden"));
    await writeFile(join(root, "forbidden/target.ts"), "target\n");
    await symlink("../forbidden/target.ts", join(root, "allowed/link.ts"));

    const result = await runGuard(
      root,
      request([{ kind: "update", path: "allowed/link.ts" }]),
    );

    expect(result.result).toMatchObject({
      reasonCode: "guard.scope_deny",
      evidence: [{ kind: "artifact", ref: "allowed/link.ts" }],
    });
  });

  it("never mutates requested targets or any project state", async () => {
    const activeScope = scope(["src/**"]);
    const root = await project({ scope: activeScope, summary: activeScope });
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/existing.ts"), "original\n");
    const before = await tree(root);

    const result = await runGuard(
      root,
      request([
        { kind: "update", path: "src/existing.ts" },
        { kind: "create", path: "src/new.ts" },
      ]),
    );

    expect(result.exitCode).toBe(0);
    expect(await tree(root)).toEqual(before);
  });

  it("evaluates a new path under an in-root symlink by both path identities", async () => {
    const activeScope = scope(["alias/**", "canonical/**"]);
    const root = await project({ scope: activeScope, summary: activeScope });
    await mkdir(join(root, "canonical"));
    await symlink("canonical", join(root, "alias"));

    const result = await runGuard(
      root,
      request([{ kind: "create", path: "alias/new/deep/file.ts" }]),
    );

    expect(result.result.reasonCode).toBe("runtime.orientation_ok");
  });

  it("has no feature allow or deny restriction when scope.json is absent", async () => {
    const root = await project({ summary: scope(["elsewhere/**"]) });

    expect(
      (await runGuard(root, request([{ kind: "create", path: "src/new.ts" }])))
        .result.reasonCode,
    ).toBe("runtime.orientation_ok");
    expect(
      (await runGuard(root, request([{ kind: "update", path: ".env" }]))).result
        .reasonCode,
    ).toBe("guard.write_block");
    expect(
      (
        await runGuard(
          root,
          request([{ kind: "update", path: "private/secret.txt" }]),
        )
      ).result.reasonCode,
    ).toBe("guard.write_block");
  });

  it("treats the initialized empty active marker as no active feature", async () => {
    const root = await project();
    await writeFile(join(root, ".brain/02-features/active"), "");

    const result = await runGuard(
      root,
      request([{ kind: "create", path: "src/new.ts" }]),
    );

    expect(result.result.reasonCode).toBe("runtime.orientation_ok");
  });

  it.each([
    [
      "scope",
      { scope: "corrupt" as const, summary: scope(["src/**"]) },
      "guard.scope_corrupt",
    ],
    [
      "reviewer",
      { scope: scope(["src/**"]), summary: "malformed" as const },
      "guard.scope_corrupt",
    ],
    [
      "reviewer drift",
      { scope: scope(["src/**"]), summary: scope(["docs/**"]) },
      "guard.scope_corrupt",
    ],
    ["guardrails", { guardrails: "{bad-json\n" }, "guard.guardrails_corrupt"],
  ])(
    "fails closed for corrupt %s state",
    async (_label, options, reasonCode) => {
      const root = await project(options);

      const result = await runGuard(
        root,
        request([{ kind: "update", path: "src/index.ts" }]),
      );

      expect(result.result.reasonCode).toBe(reasonCode);
      expect(result.result.stateChanged).toBe(false);
    },
  );

  it.each([
    ["immutable block", ".env"],
    ["project block", "private/secret.txt"],
  ])("applies a %s before corrupt scope state", async (_label, path) => {
    const root = await project({
      scope: scope(["src/**"]),
      summary: scope(["docs/**"]),
    });

    const result = await runGuard(root, request([{ kind: "update", path }]));

    expect(result.result.reasonCode).toBe("guard.write_block");
  });

  it.each([
    ["immutable", ".env", "immutable-alias"],
    ["project", "private/secret.txt", "project-alias"],
  ])(
    "applies a canonical %s block before rejecting a non-repair lexical alias",
    async (_label, referent, alias) => {
      const root = await project({
        scope: scope(["src/**"]),
        summary: scope(["docs/**"]),
      });
      await mkdir(dirname(join(root, referent)), { recursive: true });
      await writeFile(join(root, referent), "blocked\n");
      await symlink(referent, join(root, alias));

      const result = await runGuard(
        root,
        request([{ kind: "update", path: alias }]),
      );

      expect(result.result).toMatchObject({
        reasonCode: "guard.write_block",
        evidence: [{ kind: "artifact", ref: alias }],
      });
    },
  );

  it("still rejects an ordinary non-brain target for corrupt scope", async () => {
    const root = await project({
      scope: scope(["src/**"]),
      summary: scope(["docs/**"]),
    });

    const result = await runGuard(
      root,
      request([{ kind: "update", path: "src/index.ts" }]),
    );

    expect(result.result.reasonCode).toBe("guard.scope_corrupt");
  });

  it("allows an all-.brain request to repair invalid policy state", async () => {
    const root = await project({ guardrails: "{bad-json\n" });

    const result = await runGuard(
      root,
      request([
        { kind: "update", path: ".brain/guardrails.json" },
        {
          kind: "move",
          source: ".brain/repair.next",
          destination: ".brain/repair.json",
        },
      ]),
    );

    expect(result.exitCode).toBe(0);
    expect(result.result.reasonCode).toBe("runtime.orientation_ok");
  });

  it.each([
    ["delete", [{ kind: "delete", path: ".brain" }]],
    [
      "move source",
      [
        {
          kind: "move",
          source: ".brain",
          destination: ".brain/repair.json",
        },
      ],
    ],
    [
      "move destination",
      [
        {
          kind: "move",
          source: ".brain/repair.json",
          destination: ".brain",
        },
      ],
    ],
  ] as const)(
    "does not treat exact .brain as repairable for %s",
    async (_label, mutations) => {
      const root = await project({ guardrails: "{bad-json\n" });

      const result = await runGuard(root, request([...mutations]));

      expect(result.result.reasonCode).toBe("guard.guardrails_corrupt");
    },
  );

  it("requires both lexical and canonical identities to be repair descendants", async () => {
    const root = await project({ guardrails: "{bad-json\n" });
    await mkdir(join(root, ".brain/repair"));
    await symlink(".brain/repair", join(root, "repair-alias"));

    const result = await runGuard(
      root,
      request([{ kind: "update", path: "repair-alias/state.json" }]),
    );

    expect(result.result).toMatchObject({
      reasonCode: "guard.guardrails_corrupt",
      evidence: [{ kind: "artifact", ref: ".brain/guardrails.json" }],
    });
  });

  it("maps a target-inspector exception to a bounded stable refusal", async () => {
    const root = await project();

    const result = await runGuard(
      root,
      request([{ kind: "update", path: "src/index.ts" }]),
      {
        targetInspector: {
          capture: () => Promise.reject(new Error("/unsafe/private/target")),
        },
      },
    );

    expect(result.result).toMatchObject({
      reasonCode: "guard.target_uninspectable",
      evidence: [{ kind: "observation", ref: "guard-target-0001" }],
    });
    expect(JSON.stringify(result.result)).not.toContain("unsafe/private");
  });

  it("maps an inspection-session exception to a bounded stable refusal", async () => {
    const root = await project();

    const result = await runGuard(
      root,
      request([{ kind: "update", path: "src/index.ts" }]),
      {
        targetInspector: {
          capture: () =>
            Promise.resolve({
              inspect: () =>
                Promise.reject(new Error("/unsafe/private/target")),
            }),
        },
      },
    );

    expect(result.result).toMatchObject({
      reasonCode: "guard.target_uninspectable",
      evidence: [{ kind: "observation", ref: "guard-target-0001" }],
    });
    expect(JSON.stringify(result.result)).not.toContain("unsafe/private");
  });

  it("applies an explicit .brain deny once policy state is valid", async () => {
    const activeScope = scope(["src/**"], [".brain/**"]);
    const root = await project({ scope: activeScope, summary: activeScope });

    const result = await runGuard(
      root,
      request([{ kind: "update", path: ".brain/guardrails.json" }]),
    );

    expect(result.result.reasonCode).toBe("guard.scope_deny");
  });

  it.each([
    [
      "lexical outside root",
      (root: string) => join(root, "../outside.ts"),
      "guard.path_escape",
    ],
    ["existing symlink escape", () => "escape/secret.ts", "guard.path_escape"],
    ["dangling symlink", () => "dangling", "guard.target_uninspectable"],
  ])("refuses a %s before policy", async (label, target, reasonCode) => {
    const activeScope = scope(["**"]);
    const root = await project({ scope: activeScope, summary: activeScope });
    const outside = await mkdtemp(join(tmpdir(), "kratos-guard-outside-"));
    roots.push(outside);
    if (label === "existing symlink escape") {
      await writeFile(join(outside, "secret.ts"), "outside\n");
      await symlink(outside, join(root, "escape"));
    }
    if (label === "dangling symlink") {
      await symlink("absent", join(root, "dangling"));
    }

    const before = await tree(root);
    const result = await runGuard(
      root,
      request([{ kind: "update", path: target(root) }]),
    );

    expect(result.result.reasonCode).toBe(reasonCode);
    expect(result.result.stateChanged).toBe(false);
    expect(await tree(root)).toEqual(before);
  });
});

describe("scope record operation", () => {
  it("records the exact parsed reviewer declarations transactionally", async () => {
    const declared = scope(["src/**", "!src/generated/**"], ["private/**"]);
    const root = await project({ summary: declared });
    const output = recordingOutput();

    const exitCode = await runCommandLine(
      ["--json", "scope", "record"],
      createRuntimeAt(root, { output }),
    );

    expect(exitCode).toBe(0);
    expect(
      JSON.parse(
        await readFile(
          join(root, `.brain/02-features/${feature}/scope.json`),
          "utf8",
        ),
      ),
    ).toEqual(declared);
  });

  it("refuses malformed reviewer prose without creating scope state", async () => {
    const root = await project({ summary: "malformed" });
    const output = recordingOutput();

    const exitCode = await runCommandLine(
      ["--json", "scope", "record"],
      createRuntimeAt(root, { output }),
    );

    expect(exitCode).not.toBe(0);
    await expect(
      readFile(join(root, `.brain/02-features/${feature}/scope.json`), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses drift from an existing scope file without replacing it", async () => {
    const recorded = scope(["src/**"]);
    const root = await project({
      scope: recorded,
      summary: scope(["docs/**"]),
    });
    const path = join(root, `.brain/02-features/${feature}/scope.json`);
    const before = await readFile(path, "utf8");
    const output = recordingOutput();

    const exitCode = await runCommandLine(
      ["--json", "scope", "record"],
      createRuntimeAt(root, { output }),
    );

    expect(exitCode).not.toBe(0);
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      reasonCode: "guard.scope_corrupt",
      stateChanged: false,
    });
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("refuses reviewer scope arrays larger than the persisted schema limit", async () => {
    const root = await project({
      summary: scope(
        Array.from(
          { length: 257 },
          (_value, index) => `src/file-${String(index)}.ts`,
        ),
      ),
    });
    const path = join(root, `.brain/02-features/${feature}/scope.json`);
    const output = recordingOutput();

    const exitCode = await runCommandLine(
      ["--json", "scope", "record"],
      createRuntimeAt(root, { output }),
    );

    expect(exitCode).not.toBe(0);
    expect(JSON.parse(output.structured_.join(""))).toMatchObject({
      reasonCode: "guard.scope_corrupt",
      stateChanged: false,
    });
    await expect(readFile(path, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
