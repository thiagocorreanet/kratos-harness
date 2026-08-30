import {
  CONTRACT_VERSIONS,
  KRATOS_VERSION,
  type AdapterMessageV1_1,
  type PhaseHandoffV1_2,
} from "@kratos/contracts";

export interface HostModelAssignment {
  readonly model: string;
  readonly effort: string;
}

/** Host-owned, versioned capability facts; never a runtime policy choice. */
export interface HostModelCatalog {
  readonly host: "claude" | "codex" | "antigravity";
  readonly defaults: Readonly<
    Record<"planner" | "implementer" | "judge", HostModelAssignment>
  >;
  readonly models: readonly {
    readonly canonicalModel: string;
    readonly aliases: readonly string[];
    readonly efforts: readonly string[];
  }[];
}

/** The read-only capability shape the runtime composition consumes structurally. */
export interface HostModelRouting {
  observe(
    host: "claude" | "codex" | "antigravity",
  ): Promise<HostModelCatalog | null>;
}

function frozenCatalog(catalog: HostModelCatalog): HostModelCatalog {
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

const DEFAULT_CATALOGS: Readonly<
  Record<"claude" | "codex" | "antigravity", HostModelCatalog>
> = Object.freeze({
  claude: frozenCatalog({
    host: "claude",
    defaults: {
      planner: { model: "sonnet", effort: "medium" },
      implementer: { model: "opus", effort: "medium" },
      judge: { model: "sonnet", effort: "medium" },
    },
    models: [
      { canonicalModel: "opus", aliases: ["opus"], efforts: ["medium"] },
      {
        canonicalModel: "sonnet",
        aliases: ["sonnet"],
        efforts: ["medium"],
      },
    ],
  }),
  codex: frozenCatalog({
    host: "codex",
    defaults: {
      planner: { model: "gpt-5.6-terra", effort: "medium" },
      implementer: { model: "gpt-5.6-sol", effort: "high" },
      judge: { model: "gpt-5.6-terra", effort: "medium" },
    },
    models: [
      {
        canonicalModel: "gpt-5.6-sol",
        aliases: ["gpt-5.6", "gpt-5.6-sol"],
        efforts: ["low", "medium", "high", "xhigh"],
      },
      {
        canonicalModel: "gpt-5.6-terra",
        aliases: ["gpt-5.6-terra"],
        efforts: ["low", "medium", "high"],
      },
    ],
  }),
  antigravity: frozenCatalog({
    host: "antigravity",
    defaults: {
      planner: { model: "gemini-3.7-pro", effort: "medium" },
      implementer: { model: "gemini-3.7-pro", effort: "high" },
      judge: { model: "gemini-2.5-pro", effort: "high" },
    },
    models: [
      {
        canonicalModel: "gemini-3.7-pro",
        aliases: ["gemini-3.7-pro", "gemini-3.7"],
        efforts: ["low", "medium", "high"],
      },
      {
        canonicalModel: "gemini-3.7-flash",
        aliases: ["gemini-3.7-flash"],
        efforts: ["low", "medium", "high"],
      },
      {
        canonicalModel: "gemini-2.5-pro",
        aliases: ["gemini-2.5-pro", "gemini-2.5"],
        efforts: ["low", "medium", "high"],
      },
    ],
  }),
});

/** Current host capability catalogs bundled with this adapter revision. */
export function defaultModelRouting(): HostModelRouting {
  return Object.freeze({
    observe: (host: "claude" | "codex" | "antigravity") =>
      Promise.resolve(DEFAULT_CATALOGS[host]),
  });
}

/**
 * What a host is and what it can do, as explicit data.
 *
 * ADR-0004 requires host capabilities to be normalized rather than inferred, so
 * an adapter states them instead of the runtime guessing from the host name. A
 * host that cannot supply an optional signal states the limitation; it does not
 * substitute a configured or model-reported value.
 */
export interface HostDescriptor {
  /** The host identity carried on every message this adapter sends. */
  readonly host: string;
  /** The configuration key to which this host's catalog belongs. */
  readonly configurationHost: "claude" | "codex" | "antigravity";
  /** The host contract revision this adapter speaks. */
  readonly hostContract: string;
  /** Every capability this host offers, as declared. */
  readonly capabilities: readonly string[];
  /** Immutable host-native facts used by the runtime to resolve assignments. */
  readonly modelRouting: HostModelCatalog;
  /**
   * Who is running, so far as the host can honestly say.
   *
   * `model: null` means the host was handed no model identity. It never means
   * the adapter picked one.
   */
  readonly observedIdentity: {
    readonly adapterVersion: string;
    readonly model: string | null;
    readonly effort: string | null;
  };
}

/** One thing a host asked the runtime to do. */
export interface HostInvocation {
  readonly messageId: string;
  readonly correlationId: string;
  readonly operation: string;
  readonly payloadContract: string;
  /**
   * The request body, by reference.
   *
   * A host hands a digest-pinned path rather than inlined content, so the
   * runtime reads the bytes it verifies instead of the bytes it was told about.
   */
  readonly payload: { readonly ref: string; readonly sha256: string };
  /** Host-observed phase execution, bound to this exact referenced payload. */
  readonly phaseExecution?: {
    readonly assignmentDigest: string;
    readonly model: string | null;
    readonly effort: string | null;
  };
}

/** What a host publishes for one runtime response. */
export interface HostRendering {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface HostPhaseRuntime {
  handoff(): Promise<
    | { readonly kind: "ready"; readonly handoff: PhaseHandoffV1_2 }
    | { readonly kind: "refused"; readonly rendering: HostRendering }
  >;
  record(message: AdapterMessageV1_1): Promise<HostRendering>;
}

export interface HostPhaseLauncher {
  /** Both selectors must be exact or the phase is not allowed to begin. */
  readonly exactSelection: {
    readonly model: boolean;
    readonly effort: boolean;
  };
  launch(request: {
    readonly phase: PhaseHandoffV1_2["phase"];
    readonly role: PhaseHandoffV1_2["assignment"]["role"];
    readonly model: string;
    readonly effort: string;
    /** Exact runtime handoff acknowledgement the host gives the phase agent. */
    readonly memory: PhaseHandoffV1_2["memory"];
  }): Promise<{
    readonly payload: { readonly ref: string; readonly sha256: string };
    /** Host observation only; nullable values are never filled from selection. */
    readonly observedIdentity: {
      readonly model: string | null;
      readonly effort: string | null;
    };
  }>;
}

export interface HostPhaseRelayInput {
  readonly modelRouting: HostModelCatalog;
  readonly messageId: string;
  readonly correlationId: string;
  readonly runtime: HostPhaseRuntime;
  readonly launcher: HostPhaseLauncher;
  readonly adapterVersion?: string;
  readonly capabilities?: readonly string[];
}

export type HostPhaseRelayOutcome =
  | { readonly kind: "recorded"; readonly rendering: HostRendering }
  | { readonly kind: "runtime-refused"; readonly rendering: HostRendering }
  | {
      readonly kind: "exact-selection-unsupported";
      readonly phaseExecuted: false;
    };

/**
 * The runtime's half of a host conversation, from the host side.
 *
 * An adapter translates and relays. It does not decide. There is deliberately
 * no method here that could advance a phase, resolve a gate, or write state:
 * the absence is the boundary, and the conformance suite asserts it rather
 * than trusting each adapter to have honoured it.
 */
export interface HostAdapter {
  readonly name: string;
  /** State this host's identity, contract, and capabilities. */
  describe(): HostDescriptor;
  /** Turn one host invocation into a request message for the runtime. */
  translate(invocation: HostInvocation): AdapterMessageV1_1;
  /** Publish one runtime response without reinterpreting it. */
  relay(response: AdapterMessageV1_1): HostRendering;
}

/** Every method a conforming adapter exposes, and nothing else. */
export const HOST_ADAPTER_METHODS: readonly string[] = Object.freeze([
  "describe",
  "relay",
  "translate",
]);

export type SupportedHost = "claude-code" | "codex" | "antigravity";

export interface HostInstallManifest {
  readonly contractVersion: "1.0.0";
  readonly host: SupportedHost;
  readonly executable: "kratos";
  readonly handshake: readonly string[];
  readonly hook: readonly string[];
  readonly requiredCapabilities: readonly string[];
}

const CAPABILITIES = Object.freeze([
  "interaction.approval",
  "lifecycle.cancellation",
  "lifecycle.error",
  "lifecycle.hook",
  "lifecycle.timeout",
]);

/** The installation data hosts consume; it performs no installation itself. */
export function hostInstallManifest(host: SupportedHost): HostInstallManifest {
  return Object.freeze({
    contractVersion: "1.0.0",
    host,
    executable: "kratos",
    handshake: Object.freeze(["kratos", "handshake", "--json"]),
    hook: Object.freeze(["kratos", "hook", "--host", host]),
    requiredCapabilities: CAPABILITIES,
  });
}

export interface HostAdapterOptions {
  readonly modelRouting: HostModelCatalog;
  readonly model?: string | null;
  readonly effort?: string | null;
  readonly adapterVersion?: string;
  readonly capabilities?: readonly string[];
}

function configurationHostFor(
  host: SupportedHost,
): "claude" | "codex" | "antigravity" {
  if (host === "claude-code") return "claude";
  if (host === "codex") return "codex";
  return "antigravity";
}

/** Copy only the catalog contract fields so host-supplied extras cannot leak. */
function snapshotCatalog(catalog: HostModelCatalog): HostModelCatalog {
  return frozenCatalog(catalog);
}

function normalized(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values)].sort((left, right) => (left < right ? -1 : 1)),
  );
}

/**
 * Build a relay-only adapter for a supported host.
 *
 * The object intentionally exposes only the three conformance methods. Host
 * differences are data in the descriptor; they never branch a workflow
 * verdict or mutate project state.
 */
export function createHostAdapter(
  host: SupportedHost,
  options: HostAdapterOptions,
): HostAdapter {
  const configurationHost = configurationHostFor(host);
  if (options.modelRouting.host !== configurationHost) {
    throw new Error("Host model catalog does not match the adapter host");
  }
  const descriptor: HostDescriptor = Object.freeze({
    host,
    configurationHost,
    hostContract: CONTRACT_VERSIONS["host.adapter-message"],
    capabilities: normalized(options.capabilities ?? CAPABILITIES),
    modelRouting: snapshotCatalog(options.modelRouting),
    observedIdentity: Object.freeze({
      adapterVersion: options.adapterVersion ?? KRATOS_VERSION,
      model: options.model ?? null,
      effort: options.effort ?? null,
    }),
  });
  return Object.freeze({
    name: host,
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
        throw new Error("Expected a runtime response message");
      }
      return {
        stdout: `${JSON.stringify(response.payload)}\n`,
        stderr: "",
        exitCode: response.payload.exitCode,
      };
    },
  });
}

export const codexAdapter = (options: HostAdapterOptions): HostAdapter =>
  createHostAdapter("codex", options);

export const claudeCodeAdapter = (options: HostAdapterOptions): HostAdapter =>
  createHostAdapter("claude-code", options);

export const antigravityAdapter = (options: HostAdapterOptions): HostAdapter =>
  createHostAdapter("antigravity", options);

/**
 * Relay one runtime-selected assignment through an exact host launch and back
 * into `agent record`. The launcher supplies observation, never selection.
 */
export async function relaySelectedPhase(
  host: SupportedHost,
  input: HostPhaseRelayInput,
): Promise<HostPhaseRelayOutcome> {
  const runtimeHandoff = await input.runtime.handoff();
  if (runtimeHandoff.kind === "refused") {
    return {
      kind: "runtime-refused",
      rendering: runtimeHandoff.rendering,
    };
  }
  const { handoff } = runtimeHandoff;
  if (
    handoff.host !== configurationHostFor(host) ||
    handoff.phase !== handoff.assignment.phase
  ) {
    throw new Error("Runtime handoff does not match the host relay");
  }

  // Validate and snapshot host facts before any proprietary phase work starts.
  createHostAdapter(host, {
    modelRouting: input.modelRouting,
    ...(input.adapterVersion === undefined
      ? {}
      : { adapterVersion: input.adapterVersion }),
    ...(input.capabilities === undefined
      ? {}
      : { capabilities: input.capabilities }),
  });
  if (
    !input.launcher.exactSelection.model ||
    !input.launcher.exactSelection.effort
  ) {
    return { kind: "exact-selection-unsupported", phaseExecuted: false };
  }

  const execution = await input.launcher.launch(
    Object.freeze({
      phase: handoff.assignment.phase,
      role: handoff.assignment.role,
      model: handoff.assignment.model,
      effort: handoff.assignment.effort,
      memory: handoff.memory,
    }),
  );
  const adapter = createHostAdapter(host, {
    modelRouting: input.modelRouting,
    model: execution.observedIdentity.model,
    effort: execution.observedIdentity.effort,
    ...(input.adapterVersion === undefined
      ? {}
      : { adapterVersion: input.adapterVersion }),
    ...(input.capabilities === undefined
      ? {}
      : { capabilities: input.capabilities }),
  });
  const request = adapter.translate({
    messageId: input.messageId,
    correlationId: input.correlationId,
    operation: `sdd.agent.record:${input.correlationId}`,
    payloadContract: "host.agent-output@1.2.0",
    payload: { ...execution.payload },
    phaseExecution: {
      assignmentDigest: handoff.assignmentDigest,
      model: execution.observedIdentity.model,
      effort: execution.observedIdentity.effort,
    },
  });
  return {
    kind: "recorded",
    rendering: await input.runtime.record(request),
  };
}

export {
  type GuardExecution,
  type GuardExecutor,
  type GuardOperationResult,
  type PreToolRelayResult,
} from "./pre-tool-use.js";
export {
  normalizeClaudeCodePreToolUse,
  relayClaudeCodePreToolUse,
} from "./claude-code/pre-tool-use.js";
export {
  normalizeCodexPreToolUse,
  relayCodexPreToolUse,
} from "./codex/pre-tool-use.js";
export {
  normalizeAntigravityPreToolUse,
  relayAntigravityPreToolUse,
} from "./antigravity/pre-tool-use.js";
export {
  normalizeAntigravityHook,
  normalizeClaudeCodeHook,
  normalizeCodexHook,
  type HookKind,
} from "./hooks.js";
export { renderClaudeCodeNarration } from "./claude-code/narration.js";
export { renderCodexNarration } from "./codex/narration.js";
