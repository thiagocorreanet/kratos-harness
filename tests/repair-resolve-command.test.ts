import {
  DEFAULT_REGISTRY,
  dispatch,
  parseInvocation,
  renderHelp,
} from "@kratos/runtime/domain/cli";
import { describe, expect, it } from "vitest";

function invoke(argv: readonly string[]) {
  const parsed = parseInvocation(argv, DEFAULT_REGISTRY);
  if (parsed.kind === "result") {
    throw new Error(`command did not resolve: ${parsed.result.reasonCode}`);
  }
  const decision = dispatch({
    ...parsed.invocation,
    observation: {
      kind: "workflow",
      workflow: { kind: "absent", operations: [] },
    } as never,
  });
  return { command: parsed.invocation.command.path.join(" "), decision };
}

describe("repair resolve command", () => {
  it("registers the explicit recovery route and publishes its human inputs", () => {
    const command = DEFAULT_REGISTRY.find(
      ({ path }) => path.join(" ") === "repair resolve",
    );

    expect(command?.prerequisite).toBe("workflow");
    expect(command?.positionals).toEqual({ min: 1, max: 1 });
    const flags =
      command?.flags.map(({ name, kind }) => ({ name, kind })) ?? [];
    expect(flags).toContainEqual({ name: "--run", kind: "value" });
    expect(flags).toContainEqual({ name: "--resolved-by", kind: "value" });
    expect(flags).toContainEqual({ name: "--observation", kind: "value" });
    expect(flags).toContainEqual({ name: "--next-run", kind: "value" });
    expect(renderHelp(DEFAULT_REGISTRY)).toContain("  repair resolve");
  });

  it.each([
    {
      label: "missing human identity",
      argv: [
        "repair",
        "resolve",
        "AC-1.1.1",
        "--run",
        "run-01",
        "--observation",
        "The implementation was corrected and independently verified.",
      ],
    },
    {
      label: "missing written observation",
      argv: [
        "repair",
        "resolve",
        "AC-1.1.1",
        "--run",
        "run-01",
        "--resolved-by",
        "human-01",
      ],
    },
    {
      label: "malformed criterion identifier",
      argv: [
        "repair",
        "resolve",
        "criterion-1",
        "--run",
        "run-01",
        "--resolved-by",
        "human-01",
        "--observation",
        "The implementation was corrected and independently verified.",
      ],
    },
  ])("refuses $label before producing effects", ({ argv }) => {
    expect(invoke(argv)).toMatchObject({
      command: "repair resolve",
      decision: {
        result: { reasonCode: "trail.uso", stateChanged: false },
        plan: { effects: [] },
      },
    });
  });
});
