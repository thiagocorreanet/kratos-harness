import { KRATOS_VERSION, type AdapterMessageV1 } from "@kratos/contracts";
import type {
  HostAdapter,
  HostDescriptor,
  HostInvocation,
  HostRendering,
} from "@kratos/adapters";

export interface FakeHostAdapterOptions {
  readonly host?: string;
  readonly hostContract?: string;
  readonly capabilities?: readonly string[];
  readonly model?: string | null;
}

/**
 * The smallest adapter that conforms.
 *
 * It exists so the conformance suite has a subject before either real host
 * does, and so a change to the protocol fails here rather than only inside a
 * host nobody can run in CI.
 */
export function fakeHostAdapter(
  options: FakeHostAdapterOptions = {},
): HostAdapter {
  const descriptor: HostDescriptor = {
    host: options.host ?? "fake",
    hostContract: options.hostContract ?? "1.0.0",
    capabilities: Object.freeze([...(options.capabilities ?? [])]),
    observedIdentity: {
      adapterVersion: KRATOS_VERSION,
      model: options.model ?? null,
    },
  };
  return {
    name: "fake",
    describe: () => descriptor,
    translate: (invocation: HostInvocation): AdapterMessageV1 => ({
      contractVersion: "1.0.0",
      hostContract: descriptor.hostContract as "1.0.0",
      messageId: invocation.messageId,
      messageType: "request",
      host: descriptor.host,
      operation: invocation.operation,
      capabilities: [...descriptor.capabilities],
      observedIdentity: descriptor.observedIdentity,
      payloadContract: invocation.payloadContract,
      payload: invocation.payload,
      correlationId: invocation.correlationId,
    }),
    relay: (response: AdapterMessageV1): HostRendering => {
      if (response.messageType !== "response") {
        throw new Error("Expected a response message");
      }
      // The verdict is copied, never recomputed. An adapter that decided its
      // own exit code would be deciding for the runtime.
      return {
        stdout: `${JSON.stringify(response.payload)}\n`,
        stderr: "",
        exitCode: response.payload.exitCode,
      };
    },
  };
}
