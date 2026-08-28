import { KRATOS_VERSION, type AdapterMessageV1 } from "@kratos/contracts";

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
  /** The host contract revision this adapter speaks. */
  readonly hostContract: string;
  /** Every capability this host offers, as declared. */
  readonly capabilities: readonly string[];
  /**
   * Who is running, so far as the host can honestly say.
   *
   * `model: null` means the host was handed no model identity. It never means
   * the adapter picked one.
   */
  readonly observedIdentity: {
    readonly adapterVersion: string;
    readonly model: string | null;
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
}

/** What a host publishes for one runtime response. */
export interface HostRendering {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

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
  translate(invocation: HostInvocation): AdapterMessageV1;
  /** Publish one runtime response without reinterpreting it. */
  relay(response: AdapterMessageV1): HostRendering;
}

/** Every method a conforming adapter exposes, and nothing else. */
export const HOST_ADAPTER_METHODS: readonly string[] = Object.freeze([
  "describe",
  "relay",
  "translate",
]);

export type SupportedHost = "claude-code" | "codex";

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
  readonly model?: string | null;
  readonly adapterVersion?: string;
  readonly capabilities?: readonly string[];
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
  options: HostAdapterOptions = {},
): HostAdapter {
  const descriptor: HostDescriptor = Object.freeze({
    host,
    hostContract: "1.0.0",
    capabilities: normalized(options.capabilities ?? CAPABILITIES),
    observedIdentity: Object.freeze({
      adapterVersion: options.adapterVersion ?? KRATOS_VERSION,
      model: options.model ?? null,
    }),
  });
  return Object.freeze({
    name: host,
    describe: () => descriptor,
    translate: (invocation: HostInvocation): AdapterMessageV1 => ({
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
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

export const codexAdapter = (options: HostAdapterOptions = {}): HostAdapter =>
  createHostAdapter("codex", options);

export const claudeCodeAdapter = (
  options: HostAdapterOptions = {},
): HostAdapter => createHostAdapter("claude-code", options);

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
