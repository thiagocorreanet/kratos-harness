import { describe, expect, it } from "vitest";

import {
  DEFAULT_REGISTRY,
  renderHelp,
  usageLine,
  type CommandRegistry,
  type CommandSpec,
} from "@mestre-yoda/runtime/domain/cli";
import { planOf } from "@mestre-yoda/runtime/domain/effects";
import { resultFor } from "@mestre-yoda/runtime/domain/result";

const stub: CommandSpec = {
  path: ["ac", "check"],
  summary: "Check every stored acceptance criterion.",
  flags: [
    {
      name: "--root",
      kind: "value",
      valueLabel: "<path>",
      summary: "Operate on the project rooted at this path.",
    },
  ],
  positionals: { min: 0, max: 0 },
  jsonContract: "result@1.0.0",
  prerequisite: "none",
  handler: () => ({
    result: resultFor("runtime.orientation_ok"),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  }),
};

const registry: CommandRegistry = [stub];

describe("generated help", () => {
  it("keeps the complete implemented help byte-stable", () => {
    expect(renderHelp(DEFAULT_REGISTRY)).toBe(
      [
        "Usage: yoda [--expect <version>] [--json] <command>",
        "",
        "Commands:",
        "  handshake           Report the contract versions this runtime carries.",
        "  help                Print the command usage text.",
        "  version             Print the runtime version.",
        "",
        "Global flags:",
        "  --expect <version>  Act only when the plugin version matches exactly.",
        "  --json              Emit one machine-readable object instead of human text.",
        "",
      ].join("\n"),
    );
  });

  it("builds a usage line from the specification", () => {
    expect(usageLine(stub)).toBe("yoda ac check [--root <path>]");
  });

  it("lists commands and their flags", () => {
    const help = renderHelp(registry);
    expect(help).toContain("  ac check");
    expect(help).toContain("Check every stored acceptance criterion.");
    expect(help).toMatch(
      / {6}--root <path>\s{2,}Operate on the project rooted at this path\./u,
    );
  });

  it("lists every global flag", () => {
    const help = renderHelp(registry);
    expect(help).toContain("--expect <version>");
    expect(help).toContain("--json");
    expect(help).toContain(
      "--expect <version>  Act only when the plugin version matches exactly.",
    );
  });

  it("orders commands deterministically", () => {
    const other: CommandSpec = { ...stub, path: ["ab"], flags: [] };
    expect(renderHelp([stub, other])).toBe(renderHelp([other, stub]));
    expect(renderHelp([stub, other]).indexOf("ab")).toBeLessThan(
      renderHelp([stub, other]).indexOf("ac check"),
    );
  });

  it("changes when the registry changes", () => {
    const extra: CommandSpec = { ...stub, path: ["zz"], flags: [] };
    expect(renderHelp([stub, extra])).not.toBe(renderHelp(registry));
  });
});
