import { describe, expect, it } from "vitest";

import {
  HOST_ADAPTER_METHODS,
  type HostAdapter,
  type HostInvocation,
} from "@kratos/adapters";
import type { AdapterMessageV1 } from "@kratos/contracts";
import {
  classifyHostContract,
  normalizeCapabilities,
} from "@kratos/runtime/domain/host";

export type HostAdapterFactory = () => HostAdapter;

const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

/** One invocation every adapter must be able to translate. */
export function conformanceInvocation(
  overrides: Partial<HostInvocation> = {},
): HostInvocation {
  return {
    messageId: "conformance-request-01",
    correlationId: "conformance-01",
    operation: "handshake",
    payloadContract: "state.snapshot@1.0.0",
    payload: {
      ref: ".brain/runs/run-01/state.json",
      sha256: "a".repeat(64),
    },
    ...overrides,
  };
}

/** A response an adapter is asked to relay without reinterpreting it. */
export function conformanceResponse(
  overrides: Partial<AdapterMessageV1> = {},
): AdapterMessageV1 {
  return {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    messageId: "conformance-response-01",
    messageType: "response",
    host: "codex",
    operation: "handshake",
    capabilities: [],
    observedIdentity: { adapterVersion: "0.0.0-development", model: null },
    payloadContract: "result@1.0.0",
    payload: {
      contractVersion: "1.0.0",
      status: "blocked",
      exitCode: 3,
      reasonCode: "gate.aprovacao_spec",
      summary: "The specification approval gate is waiting on a decision.",
      why: [],
      evidence: [],
      stateChanged: false,
      retryable: true,
      recovery:
        "Review the current specification lineage and approve that exact revision before continuing.",
    },
    correlationId: "conformance-01",
    ...overrides,
  } as AdapterMessageV1;
}

/** Every callable name an adapter carries, own and inherited. */
function methodsOf(adapter: HostAdapter): readonly string[] {
  const found = new Set<string>();
  let current: object | null = adapter;
  while (current !== null && current !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (key === "constructor") continue;
      if (
        typeof (adapter as unknown as Record<string, unknown>)[key] ===
        "function"
      )
        found.add(key);
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return [...found].sort((left, right) => (left < right ? -1 : 1));
}

function request(
  message: AdapterMessageV1,
): Extract<AdapterMessageV1, { messageType: "request" }> {
  if (message.messageType !== "request") {
    throw new Error("Expected a request message");
  }
  return message;
}

/** The result a response carries, narrowed away from the request payload. */
export function responsePayload(
  message: AdapterMessageV1,
): Extract<AdapterMessageV1, { messageType: "response" }>["payload"] {
  if (message.messageType !== "response") {
    throw new Error("Expected a response message");
  }
  return message.payload;
}

/**
 * Behaviour every host adapter must share.
 *
 * Claude Code and Codex reach the same runtime, so a decision that differs
 * between them is a decision an adapter made. This suite is the shared one from
 * ADR-0004: a new host is added by passing it rather than by branching the core.
 */
export function describeHostAdapterContract(
  label: string,
  factory: HostAdapterFactory,
): void {
  describe(`HostAdapter contract: ${label}`, () => {
    it("states an identity the wire accepts", () => {
      const { host, hostContract } = factory().describe();
      expect(host).toMatch(identifier);
      // A host whose declared revision this bundle does not accept has to be
      // rejected by the runtime, so an adapter that ships one cannot conform.
      expect(classifyHostContract({ hostContract })).toBeNull();
    });

    it("declares capabilities as normalized explicit data", () => {
      const { capabilities } = factory().describe();
      expect(capabilities).toEqual(normalizeCapabilities(capabilities));
    });

    it("never substitutes an observed identity it was not given", () => {
      const { observedIdentity } = factory().describe();
      expect(observedIdentity.adapterVersion).toMatch(identifier);
      // `null` is the honest answer for a host handed no model. A string here
      // must have come from the host, never from the adapter's own default.
      if (observedIdentity.model !== null) {
        expect(observedIdentity.model).toMatch(identifier);
      }
    });

    it("translates an invocation into a request carrying its own identity", () => {
      const adapter = factory();
      const descriptor = adapter.describe();
      const invocation = conformanceInvocation();
      const message = request(adapter.translate(invocation));
      expect(message.host).toBe(descriptor.host);
      expect(message.hostContract).toBe(descriptor.hostContract);
      expect(message.capabilities).toEqual(descriptor.capabilities);
      expect(message.observedIdentity).toEqual(descriptor.observedIdentity);
      expect(message.correlationId).toBe(invocation.correlationId);
      expect(message.operation).toBe(invocation.operation);
    });

    it("hands the payload by reference rather than by content", () => {
      const invocation = conformanceInvocation();
      const message = request(factory().translate(invocation));
      // Inlining content would let a host describe bytes the runtime never
      // verified. The digest is what makes the two agree.
      expect(message.payload).toEqual(invocation.payload);
      expect(Object.keys(message.payload).sort()).toEqual(["ref", "sha256"]);
    });

    it("translates the same invocation into the same bytes", () => {
      const adapter = factory();
      const invocation = conformanceInvocation();
      expect(JSON.stringify(adapter.translate(invocation))).toBe(
        JSON.stringify(adapter.translate(invocation)),
      );
    });

    it("relays a decision without reinterpreting it", () => {
      const response = conformanceResponse();
      const rendering = factory().relay(response);
      // The exit code is the runtime's verdict. An adapter that recomputed it
      // would be deciding, which is exactly what ADR-0004 forbids.
      expect(rendering.exitCode).toBe(responsePayload(response).exitCode);
    });

    it("relays a refusal without turning it into a success", () => {
      for (const exitCode of [0, 2, 3, 4, 5]) {
        const base = conformanceResponse();
        const response = conformanceResponse({
          payload: { ...responsePayload(base), exitCode },
        } as Partial<AdapterMessageV1>);
        expect(factory().relay(response).exitCode).toBe(exitCode);
      }
    });

    it("exposes no way to decide or to mutate state", () => {
      // Asserting the exact set, not merely the absence of a known-bad name: a
      // method nobody thought to forbid is how an adapter grows a decision.
      // The prototype chain is walked too, so a class-based adapter cannot hide
      // a method where own-key enumeration would not look.
      expect(methodsOf(factory())).toEqual([...HOST_ADAPTER_METHODS]);
    });
  });
}
