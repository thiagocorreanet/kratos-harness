import { describe, expect, it } from "vitest";

import { createRuntime } from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import { recordingOutput } from "@kratos/runtime/infra/fake";

async function run(argv: readonly string[]) {
  const output = recordingOutput();
  const exitCode = await runCommandLine(argv, createRuntime({ output }));
  return {
    exitCode,
    stdout: output.structured_.join(""),
    stderr: output.human_.join(""),
  };
}

describe("the adapters command", () => {
  it("reports installation manifests for all supported hosts including antigravity", async () => {
    const { exitCode, stdout } = await run(["adapters"]);

    expect(exitCode).toBe(0);
    const manifests = JSON.parse(stdout) as readonly {
      readonly contractVersion: string;
      readonly host: string;
      readonly executable: string;
      readonly handshake: readonly string[];
      readonly hook: readonly string[];
      readonly requiredCapabilities: readonly string[];
    }[];

    expect(manifests).toHaveLength(3);
    expect(manifests.map((m) => m.host)).toEqual([
      "claude-code",
      "codex",
      "antigravity",
    ]);

    const antigravityManifest = manifests.find((m) => m.host === "antigravity");
    expect(antigravityManifest).toEqual({
      contractVersion: "1.0.0",
      host: "antigravity",
      executable: "kratos",
      handshake: ["kratos", "handshake", "--json"],
      hook: ["kratos", "hook", "--host", "antigravity"],
      requiredCapabilities: [
        "interaction.approval",
        "lifecycle.cancellation",
        "lifecycle.error",
        "lifecycle.hook",
        "lifecycle.timeout",
      ],
    });
  });

  it("reports a single manifest when antigravity is selected", async () => {
    const { exitCode, stdout } = await run(["adapters", "antigravity"]);

    expect(exitCode).toBe(0);
    const manifests = JSON.parse(stdout) as readonly {
      readonly contractVersion: string;
      readonly host: string;
      readonly executable: string;
      readonly handshake: readonly string[];
      readonly hook: readonly string[];
      readonly requiredCapabilities: readonly string[];
    }[];

    expect(manifests).toHaveLength(1);
    expect(manifests[0]).toEqual({
      contractVersion: "1.0.0",
      host: "antigravity",
      executable: "kratos",
      handshake: ["kratos", "handshake", "--json"],
      hook: ["kratos", "hook", "--host", "antigravity"],
      requiredCapabilities: [
        "interaction.approval",
        "lifecycle.cancellation",
        "lifecycle.error",
        "lifecycle.hook",
        "lifecycle.timeout",
      ],
    });
  });

  it("refuses an unsupported adapter name", async () => {
    const { exitCode, stdout } = await run(["--json", "adapters", "cursor"]);

    expect(exitCode).toBe(2);
    const result = JSON.parse(stdout) as { readonly reasonCode: string };
    expect(result.reasonCode).toBe("trail.uso");
  });
});
