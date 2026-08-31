import type { PhaseHandoffV1_1 } from "@kratos/contracts";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import {
  fixedClock,
  fixedEnvironment,
  fixedModelRouting,
  memoryTransactionStorage,
  memoryWorkspace,
  pipedInput,
  recordingOutput,
  sequentialIds,
  stubGit,
} from "@kratos/runtime/infra/fake";
import type { RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import {
  antigravityCatalog,
  claudeCatalog,
  codexCatalog,
  roleConfig,
} from "./support/model-routing.js";

const ROOT = "/project";

function subject(launcherHost: string | null = "antigravity") {
  const storage = memoryTransactionStorage({
    files: {
      ".brain/config.json": JSON.stringify(
        roleConfig("antigravity", {
          planner: "planner-alias",
          implementer: { model: "impl-alias", effort: "high" },
          judge: "judge-alias",
        }),
      ),
    },
    directories: [".brain", ".brain/transactions"],
  });
  const output = recordingOutput();
  const ports: RuntimePorts = {
    clock: fixedClock("2026-08-30T00:00:00.000Z"),
    ids: sequentialIds("workflow"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    fileSystem: storage.fileSystem,
    git: stubGit(),
    locks: {} as RuntimePorts["locks"],
    modelRouting: fixedModelRouting([
      claudeCatalog(),
      codexCatalog(),
      antigravityCatalog(),
    ]),
    environment: fixedEnvironment(
      launcherHost === null ? {} : { KRATOS_HOST: launcherHost },
      ROOT,
    ),
    output,
    standardInput: pipedInput(null),
    targetInspector: {
      capture: () =>
        Promise.resolve({
          inspect: (path) =>
            Promise.resolve({
              kind: "inside",
              lexicalPath: path,
              canonicalPath: path,
            }),
        }),
    },
    workspace: memoryWorkspace({ directories: [ROOT] }),
  };
  return { ports, storage, output };
}

describe("workflow resolution for antigravity launcher host", () => {
  it("resolves launcherHost antigravity to configuration host antigravity in handoff", async () => {
    const s = subject("antigravity");
    expect(
      await runCommandLine(["objective", "Test Antigravity"], s.ports),
    ).toBe(0);
    expect(await runCommandLine(["start"], s.ports)).toBe(0);

    const handoffOutput = recordingOutput();
    expect(
      await runCommandLine(["--json", "handoff"], {
        ...s.ports,
        output: handoffOutput,
      }),
    ).toBe(0);

    const handoff = JSON.parse(
      handoffOutput.structured_.join(""),
    ) as PhaseHandoffV1_1;
    expect(handoff.host).toBe("antigravity");
    expect(handoff.assignment.role).toBe("planner");
    expect(handoff.assignment.model).toBe("planner-canonical");
    expect(handoff.assignment.effort).toBe("medium");
  });

  it("resolves launcherHost antigravity when started with antigravity environment", async () => {
    const s = subject("antigravity");
    expect(
      await runCommandLine(["objective", "Test Antigravity"], s.ports),
    ).toBe(0);
    expect(await runCommandLine(["start"], s.ports)).toBe(0);

    const handoffOutput = recordingOutput();
    expect(
      await runCommandLine(["--json", "handoff"], {
        ...s.ports,
        output: handoffOutput,
      }),
    ).toBe(0);

    const handoff = JSON.parse(
      handoffOutput.structured_.join(""),
    ) as PhaseHandoffV1_1;
    expect(handoff.host).toBe("antigravity");
    expect(handoff.phase).toBe("prd");
    expect(handoff.assignment.role).toBe("planner");
  });
});
