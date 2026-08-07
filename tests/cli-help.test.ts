import { describe, expect, it } from "vitest";

import {
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
  handler: () => ({
    result: resultFor("runtime.orientation_ok"),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  }),
};

const registry: CommandRegistry = [stub];

describe("generated help", () => {
  it("builds a usage line from the specification", () => {
    expect(usageLine(stub)).toBe("yoda ac check [--root <path>]");
  });

  it("lists commands and their flags", () => {
    const help = renderHelp(registry);
    expect(help).toContain("  ac check");
    expect(help).toContain("Check every stored acceptance criterion.");
    expect(help).toContain("      --root <path>");
  });

  it("lists every global flag", () => {
    const help = renderHelp(registry);
    expect(help).toContain("--expect <version>");
    expect(help).toContain("--json");
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
