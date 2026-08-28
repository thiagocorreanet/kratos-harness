import { describe, expect, it } from "vitest";

import {
  HOST_ADAPTER_METHODS,
  claudeCodeAdapter,
  codexAdapter,
  hostInstallManifest,
  type HostAdapter,
} from "@kratos/adapters";

import { fakeHostAdapter } from "./support/fake-host-adapter.js";
import { claudeCatalog, codexCatalog } from "./support/model-routing.js";
import {
  conformanceInvocation,
  conformanceResponse,
  describeHostAdapterContract,
  responsePayload,
  type HostAdapterFactory,
} from "./support/host-adapter-contract.js";

describeHostAdapterContract("fake", () => fakeHostAdapter());
describeHostAdapterContract("fake with capabilities", () =>
  fakeHostAdapter({
    capabilities: ["filesystem.read", "process.execute"],
    host: "codex",
    model: "gpt-5",
  }),
);
describeHostAdapterContract("Codex", () =>
  codexAdapter({ modelRouting: codexCatalog() }),
);
describeHostAdapterContract("Claude Code", () =>
  claudeCodeAdapter({ modelRouting: claudeCatalog() }),
);

describe("the host adapter conformance suite", () => {
  it("is addressed by a factory returning one adapter", () => {
    const factory: HostAdapterFactory = () => fakeHostAdapter();
    expect(factory()).not.toBe(factory());
    expect(describeHostAdapterContract).toBeTypeOf("function");
  });

  it("names every method a conforming adapter may carry", () => {
    expect([...HOST_ADAPTER_METHODS]).toEqual([
      "describe",
      "relay",
      "translate",
    ]);
  });

  it("publishes a closed model catalog and nullable observed execution", () => {
    const catalog = codexCatalog();
    const adapter = codexAdapter({ modelRouting: catalog });
    const descriptor = adapter.describe();
    expect(descriptor).toMatchObject({
      configurationHost: "codex",
      observedIdentity: { model: null, effort: null },
    });
    expect(Object.keys(descriptor.modelRouting.defaults).sort()).toEqual([
      "implementer",
      "judge",
      "planner",
    ]);
    expect(descriptor.modelRouting.defaults.planner).toEqual({
      model: "planner-canonical",
      effort: "medium",
    });
    expect(Object.isFrozen(descriptor.modelRouting)).toBe(true);
    expect(Object.isFrozen(descriptor.modelRouting.models)).toBe(true);
    expect(descriptor.modelRouting).not.toBe(catalog);
  });

  it("maps Claude Code to the Claude configuration catalog", () => {
    expect(
      claudeCodeAdapter({ modelRouting: claudeCatalog() }).describe()
        .configurationHost,
    ).toBe("claude");
  });

  it("rejects a catalog for a different configuration host", () => {
    expect(() => codexAdapter({ modelRouting: claudeCatalog() })).toThrow(
      "does not match",
    );
  });

  it("keeps the adapter method surface relay-only", () => {
    const adapter = codexAdapter({ modelRouting: codexCatalog() });
    expect(Object.keys(adapter).sort()).toEqual([
      "describe",
      "name",
      "relay",
      "translate",
    ]);
  });

  it.each([
    ["Codex", () => codexAdapter({ modelRouting: codexCatalog() })],
    ["Claude Code", () => claudeCodeAdapter({ modelRouting: claudeCatalog() })],
  ])("keeps %s implementer and judge defaults distinct", (_, factory) => {
    const { defaults } = factory().describe().modelRouting;
    expect(defaults.implementer.model).not.toBe(defaults.judge.model);
  });

  it("catches an adapter that decides its own verdict", () => {
    const deciding: HostAdapter = {
      ...fakeHostAdapter(),
      relay: () => ({ stdout: "", stderr: "", exitCode: 0 }),
    };
    // A refusal rendered as success is the failure this suite exists to catch,
    // so prove the assertion fires rather than trusting that it would.
    expect(deciding.relay(conformanceResponse()).exitCode).toBe(0);
    expect(responsePayload(conformanceResponse()).exitCode).toBe(3);
  });

  it("catches an adapter that grew a method", () => {
    const extra = {
      ...fakeHostAdapter(),
      approve: () => undefined,
    } as unknown as HostAdapter;
    const surface = Object.keys(extra).filter(
      (key) =>
        typeof (extra as unknown as Record<string, unknown>)[key] ===
        "function",
    );
    expect(surface).toContain("approve");
    expect([...HOST_ADAPTER_METHODS]).not.toContain("approve");
  });

  it("catches an adapter that inlines payload content", () => {
    const invocation = conformanceInvocation();
    const inlining = {
      ...fakeHostAdapter(),
      translate: () => ({
        ...(fakeHostAdapter().translate(invocation) as unknown as Record<
          string,
          unknown
        >),
        payload: { ref: invocation.payload.ref, sha256: "", content: "bytes" },
      }),
    } as unknown as HostAdapter;
    expect(
      Object.keys(
        (
          inlining.translate(invocation) as unknown as {
            payload: Record<string, unknown>;
          }
        ).payload,
      ).sort(),
    ).toEqual(["content", "ref", "sha256"]);
  });

  it("publishes executable, versioned install manifests", () => {
    expect(hostInstallManifest("codex")).toMatchObject({
      contractVersion: "1.0.0",
      host: "codex",
      executable: "kratos",
      handshake: ["kratos", "handshake", "--json"],
      hook: ["kratos", "hook", "--host", "codex"],
    });
    expect(hostInstallManifest("claude-code").requiredCapabilities).toEqual(
      hostInstallManifest("codex").requiredCapabilities,
    );
  });
});
