import { planOf } from "../effects.js";
import { resultFor } from "../result/index.js";

import type { CommandSpec, Decision, Invocation } from "./spec.js";

type SupportedHost = "claude-code" | "codex" | "antigravity";
const HOSTS: readonly SupportedHost[] = ["claude-code", "codex", "antigravity"];
const CAPABILITIES = [
  "interaction.approval",
  "lifecycle.cancellation",
  "lifecycle.error",
  "lifecycle.hook",
  "lifecycle.timeout",
] as const;

function hostInstallManifest(host: SupportedHost) {
  return {
    contractVersion: "1.0.0" as const,
    host,
    executable: "kratos" as const,
    handshake: ["kratos", "handshake", "--json"],
    hook: ["kratos", "hook", "--host", host],
    requiredCapabilities: CAPABILITIES,
  };
}

export const adaptersCommand: CommandSpec = {
  path: ["adapters"],
  summary: "Print versioned installation manifests for supported hosts.",
  flags: [],
  positionals: { min: 0, max: 1 },
  jsonContract: "result@1.0.0",
  prerequisite: "none",
  handler: (invocation: Invocation): Decision => {
    const selected = invocation.positionals[0];
    const hosts =
      selected === undefined
        ? HOSTS
        : HOSTS.includes(selected as SupportedHost)
          ? ([selected] as readonly SupportedHost[])
          : null;
    if (hosts === null) {
      return {
        result: resultFor("trail.uso", {
          why: ["The adapter name is not supported by this runtime."],
        }),
        plan: planOf(),
        humanStdout: null,
        payload: null,
      };
    }
    const manifests = hosts.map(hostInstallManifest);
    return {
      result: resultFor("runtime.orientation_ok", {
        summary: `Reported ${String(manifests.length)} host adapter manifest${manifests.length === 1 ? "" : "s"}.`,
      }),
      plan: planOf(),
      humanStdout: `${JSON.stringify(manifests, null, 2)}\n`,
      payload: null,
    };
  },
};
