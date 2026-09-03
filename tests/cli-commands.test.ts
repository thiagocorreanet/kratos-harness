import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KRATOS_VERSION } from "@kratos/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_REGISTRY,
  dispatch,
  parseInvocation,
} from "@kratos/runtime/domain/cli";
import { renderMemoryApplyCommand } from "@kratos/runtime/domain/cli/memory";
import {
  memoryMigrationApplyArgv,
  renderMemoryMigrationApply,
  renderPowerShellCommand,
} from "@kratos/runtime/domain/cli";
import { USAGE_WHY } from "@kratos/runtime/domain/result";

function invoke(argv: readonly string[]) {
  const parsed = parseInvocation(argv, DEFAULT_REGISTRY);
  return parsed.kind === "result"
    ? { failure: parsed.result, decision: null }
    : { failure: null, decision: dispatch(parsed.invocation) };
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("implemented commands", () => {
  it("quotes memory apply paths and preserves an explicit root", () => {
    const parsed = parseInvocation(
      [
        "memory",
        "promote",
        "proposal 'x'; $(bad).json",
        "--root",
        "a root'$;$(bad)",
      ],
      DEFAULT_REGISTRY,
    );
    if (parsed.kind !== "invocation") throw new Error("expected invocation");
    expect(
      renderMemoryApplyCommand(
        parsed.invocation,
        "a".repeat(64),
        "b".repeat(64),
        "2026-08-29T00:00:00Z",
      ),
    ).toBe(
      String.raw`kratos memory promote --root 'a root'\''$;$(bad)' 'proposal '\''x'\''; $(bad).json' --yes --proposal-digest aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --plan-digest bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb --plan-time 2026-08-29T00:00:00Z`,
    );
  });

  it("renders a migration apply command that reconstructs hostile argv without executing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-migration-argv-"));
    temporaryRoots.push(root);
    const bin = join(root, "bin");
    const argvPath = join(root, "argv");
    const badPath = join(root, "bad-executed");
    await mkdir(bin);
    await writeFile(
      join(bin, "kratos"),
      `#!/bin/sh\n: > '${argvPath}'\nfor arg in "$@"; do printf '%s\\0' "$arg" >> '${argvPath}'; done\n`,
    );
    await writeFile(join(bin, "bad"), `#!/bin/sh\n: > '${badPath}'\n`);
    await chmod(join(bin, "kratos"), 0o755);
    await chmod(join(bin, "bad"), 0o755);
    const parsed = parseInvocation(
      [
        "migrate",
        "memory",
        "proposal 'x'; $(bad) $ % ! ^ & | mapping.json",
        "--root",
        "a root'$;$(bad) % ! ^ & |",
      ],
      DEFAULT_REGISTRY,
    );
    if (parsed.kind !== "invocation") throw new Error("expected invocation");
    const command = renderMemoryMigrationApply(
      parsed.invocation,
      "a".repeat(64),
      "b".repeat(64),
      "2026-08-29T00:00:00Z",
    );

    expect(command).toContain(String.raw`'a root'\''$;$(bad) % ! ^ & |'`);
    const argv = memoryMigrationApplyArgv(
      parsed.invocation,
      "a".repeat(64),
      "b".repeat(64),
      "2026-08-29T00:00:00Z",
    );
    expect(argv).toEqual([
      "kratos",
      "migrate",
      "memory",
      "--root",
      "a root'$;$(bad) % ! ^ & |",
      "proposal 'x'; $(bad) $ % ! ^ & | mapping.json",
      "--yes",
      "--proposal-digest",
      "a".repeat(64),
      "--plan-digest",
      "b".repeat(64),
      "--plan-time",
      "2026-08-29T00:00:00Z",
    ]);
    expect(renderPowerShellCommand(argv)).toBe(
      `& 'kratos' 'migrate' 'memory' '--root' 'a root''$;$(bad) % ! ^ & |' 'proposal ''x''; $(bad) $ % ! ^ & | mapping.json' '--yes' '--proposal-digest' '${"a".repeat(64)}' '--plan-digest' '${"b".repeat(64)}' '--plan-time' '2026-08-29T00:00:00Z'`,
    );
    execFileSync("/usr/bin/bash", ["-c", command], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    expect((await readFile(argvPath, "utf8")).split("\0").slice(0, -1)).toEqual(
      [
        "migrate",
        "memory",
        "--root",
        "a root'$;$(bad) % ! ^ & |",
        "proposal 'x'; $(bad) $ % ! ^ & | mapping.json",
        "--yes",
        "--proposal-digest",
        "a".repeat(64),
        "--plan-digest",
        "b".repeat(64),
        "--plan-time",
        "2026-08-29T00:00:00Z",
      ],
    );
    await expect(readFile(badPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("registers exactly the commands that work today", () => {
    expect(
      DEFAULT_REGISTRY.filter((spec) => spec.retired !== true)
        .map((spec) => spec.path.join(" "))
        .sort(),
    ).toEqual([
      "adapters",
      "agent record",
      "approve",
      "audit",
      "budgets",
      "continue",
      "dashboard",
      "doctor",
      "done",
      "evidence bundle",
      "evidence record",
      "explain",
      "gaps record",
      "gaps resolve",
      "gaps waive",
      "gates record",
      "guard write",
      "handoff",
      "handshake",
      "help",
      "hook",
      "init",
      "memory archive",
      "memory capture",
      "memory curate",
      "memory list",
      "memory merge",
      "memory promote",
      "memory reinforce",
      "metrics refresh",
      "migrate brain",
      "migrate config",
      "migrate memory",
      "migrate rollback",
      "narrate",
      "objective",
      "profile derive",
      "repair",
      "repair resolve",
      "scope record",
      "start",
      "stats",
      "status",
      "unlock stop-loss",
      "version",
    ]);
  });

  it("registers every retired phase name apart from those", () => {
    expect(
      DEFAULT_REGISTRY.filter((spec) => spec.retired === true)
        .map((spec) => spec.path.join(" "))
        .sort(),
    ).toEqual(["auto", "code", "eval", "next", "prd", "review", "run", "spec"]);
  });

  it("prints usage for an empty argument vector", () => {
    expect(invoke([]).decision?.humanStdout).toContain("Usage: kratos");
  });

  it.each([["--help"], ["-h"], ["help"]])("answers %s with usage", (token) => {
    expect(invoke([token]).decision?.humanStdout).toContain("Commands:");
  });

  it.each([["--version"], ["version"]])(
    "answers %s with exactly the version",
    (token) => {
      expect(invoke([token]).decision?.humanStdout).toBe(`${KRATOS_VERSION}\n`);
    },
  );

  it("carries the version in the summary for JSON mode", () => {
    expect(invoke(["--json", "--version"]).decision?.result.summary).toContain(
      KRATOS_VERSION,
    );
  });

  it("answers the handshake with an adapter message", () => {
    const decision = invoke(["handshake"]).decision;
    expect(decision?.payload).toMatchObject({
      messageType: "response",
      operation: "handshake",
    });
    expect(JSON.parse(decision?.humanStdout ?? "")).toEqual(decision?.payload);
  });

  it("refuses an unregistered command", () => {
    expect(invoke(["missing"]).failure?.why).toEqual([
      USAGE_WHY.unknownCommand,
    ]);
  });

  it("checks a pinned version before resolving the command", () => {
    expect(invoke(["--expect", "9.9.9", "start"]).failure?.reasonCode).toBe(
      "contract.plugin_version_unsupported",
    );
  });

  it("continues past a matching pin", () => {
    expect(invoke(["--expect", KRATOS_VERSION, "version"]).failure).toBeNull();
  });

  it("keeps help available with a matching pin", () => {
    expect(
      invoke(["--expect", KRATOS_VERSION, "--help"]).decision?.humanStdout,
    ).toContain("Usage: kratos");
  });
});
