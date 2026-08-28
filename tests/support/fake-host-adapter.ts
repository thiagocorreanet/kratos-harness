import {
  CONTRACT_VERSIONS,
  KRATOS_VERSION,
  type AdapterMessageV1_1,
} from "@kratos/contracts";
import type {
  HostAdapter,
  HostDescriptor,
  HostInvocation,
  HostRendering,
} from "@kratos/adapters";
import type { HostModelCatalog } from "@kratos/runtime/domain/model-roles";

import { claudeCatalog, codexCatalog } from "./model-routing.js";

export interface FakeHostAdapterOptions {
  readonly host?: string;
  readonly hostContract?: string;
  readonly capabilities?: readonly string[];
  readonly model?: string | null;
  readonly effort?: string | null;
  readonly configurationHost?: "claude" | "codex";
  readonly modelRouting?: HostModelCatalog;
}

function snapshotCatalog(catalog: HostModelCatalog): HostModelCatalog {
  return Object.freeze({
    host: catalog.host,
    defaults: Object.freeze({
      planner: Object.freeze({ ...catalog.defaults.planner }),
      implementer: Object.freeze({ ...catalog.defaults.implementer }),
      judge: Object.freeze({ ...catalog.defaults.judge }),
    }),
    models: Object.freeze(
      catalog.models.map(({ canonicalModel, aliases, efforts }) =>
        Object.freeze({
          canonicalModel,
          aliases: Object.freeze([...aliases]),
          efforts: Object.freeze([...efforts]),
        }),
      ),
    ),
  });
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
  const configurationHost = options.configurationHost ?? "codex";
  const catalog =
    options.modelRouting ??
    (configurationHost === "claude" ? claudeCatalog() : codexCatalog());
  if (catalog.host !== configurationHost) {
    throw new Error("Host model catalog does not match the adapter host");
  }
  const descriptor: HostDescriptor = {
    host: options.host ?? "fake",
    configurationHost,
    hostContract:
      options.hostContract ?? CONTRACT_VERSIONS["host.adapter-message"],
    capabilities: Object.freeze([...(options.capabilities ?? [])]),
    modelRouting: snapshotCatalog(catalog),
    observedIdentity: {
      adapterVersion: KRATOS_VERSION,
      model: options.model ?? null,
      effort: options.effort ?? null,
    },
  };
  return {
    name: "fake",
    describe: () => descriptor,
    translate: (invocation: HostInvocation): AdapterMessageV1_1 => ({
      contractVersion: CONTRACT_VERSIONS["host.adapter-message"],
      hostContract: CONTRACT_VERSIONS["host.adapter-message"],
      messageId: invocation.messageId,
      messageType: "request",
      host: descriptor.configurationHost,
      operation: invocation.operation,
      capabilities: [...descriptor.capabilities],
      observedIdentity: descriptor.observedIdentity,
      payloadContract: invocation.payloadContract,
      payload: invocation.payload,
      ...(invocation.phaseExecution === undefined
        ? {}
        : { phaseExecution: { ...invocation.phaseExecution } }),
      correlationId: invocation.correlationId,
    }),
    relay: (response: AdapterMessageV1_1): HostRendering => {
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
