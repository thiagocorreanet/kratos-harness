import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { resolveInitAnswers } from "@mestre-yoda/runtime/domain/init";
import { describe, expect, it } from "vitest";

const registry = createSchemaRegistry();

function answers(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    hosts: ["claude"],
    ...overrides,
  };
}

describe("initialization answers", () => {
  it("accepts the minimal document and reports every default it applied", () => {
    const resolved = resolveInitAnswers(answers(), registry);

    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") return;
    expect(resolved.answers).toEqual({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      hosts: ["claude"],
      language: "en",
      policyMode: "standard",
      snapshots: true,
    });
    // A person who supplied three fields and got six needs to see the other
    // three, or they will believe they chose them.
    expect(resolved.defaulted).toEqual(["language", "policyMode", "snapshots"]);
  });

  it("reports nothing defaulted when every answer was supplied", () => {
    const resolved = resolveInitAnswers(
      answers({ language: "pt-BR", policyMode: "strict", snapshots: false }),
      registry,
    );

    expect(resolved).toMatchObject({ kind: "resolved", defaulted: [] });
  });

  it("keeps the host order the caller chose", () => {
    const resolved = resolveInitAnswers(
      answers({ hosts: ["codex", "claude"] }),
      registry,
    );

    expect(resolved).toMatchObject({
      kind: "resolved",
      answers: { hosts: ["codex", "claude"] },
    });
  });

  it.each([
    ["an unknown key", answers({ langauge: "en" })],
    ["no hosts at all", answers({ hosts: [] })],
    ["a repeated host", answers({ hosts: ["claude", "claude"] })],
    ["an unsupported host", answers({ hosts: ["cursor"] })],
    ["an unsupported language", answers({ language: "fr" })],
    ["a missing contract version", { hostContract: "1.0.0", hosts: ["claude"] }],
  ])("refuses %s", (_label, document) => {
    // A misspelled key that is quietly dropped is how somebody believes they
    // configured something they did not.
    expect(resolveInitAnswers(document, registry).kind).toBe("invalid");
  });

  it("names the reason a document was refused", () => {
    const resolved = resolveInitAnswers({ hosts: ["claude"] }, registry);

    expect(resolved).toMatchObject({
      kind: "invalid",
      reasonCode: "contract.host_version_invalid",
    });
  });
});
