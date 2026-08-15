import { describe, expect, it } from "vitest";

import {
  DEFAULT_REGISTRY,
  renderHelp,
  usageLine,
  type CommandRegistry,
  type CommandSpec,
} from "@kratos/runtime/domain/cli";
import { planOf } from "@kratos/runtime/domain/effects";
import { resultFor } from "@kratos/runtime/domain/result";

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
  it("publishes the complete implemented command surface deterministically", () => {
    const help = renderHelp(DEFAULT_REGISTRY);
    expect(help).toBe(renderHelp([...DEFAULT_REGISTRY].reverse()));
    expect(help.startsWith("Usage: kratos ")).toBe(true);
    expect(help.endsWith("\n")).toBe(true);
    expect(help).not.toContain("\r");
    for (const command of DEFAULT_REGISTRY.filter(
      ({ retired }) => retired !== true,
    )) {
      expect(help).toContain(`  ${command.path.join(" ")}`);
      expect(help).toContain(command.summary);
      for (const flag of command.flags) {
        expect(help).toContain(flag.name);
        expect(help).toContain(flag.summary);
      }
    }
    expect(help).toContain("  start");
    expect(help).toContain("  continue");
    expect(help).toContain("--expected-revision <number>");
  });

  it("builds a usage line from the specification", () => {
    expect(usageLine(stub)).toBe("kratos ac check [--root <path>]");
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
