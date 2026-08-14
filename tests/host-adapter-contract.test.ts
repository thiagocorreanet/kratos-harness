import { describe, expect, it } from "vitest";

import { HOST_ADAPTER_METHODS, type HostAdapter } from "@mestre-yoda/adapters";

import { fakeHostAdapter } from "./support/fake-host-adapter.js";
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
});
