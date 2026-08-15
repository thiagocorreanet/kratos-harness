export type TowerRole = "viewer" | "contributor" | "administrator";

export interface ControlTowerEnvelope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly bundleDigest: string;
  readonly signed: boolean;
  readonly encrypted: boolean;
  readonly redacted: boolean;
  readonly containsSource: boolean;
  readonly containsPrompt: boolean;
  readonly containsSecret: boolean;
}

export type ControlTowerDecision =
  | { readonly kind: "local-only"; readonly reason: "disabled" | "offline" }
  | {
      readonly kind: "publish";
      readonly tenantId: string;
      readonly projectId: string;
      readonly bundleDigest: string;
      readonly remoteAuthority: "evidence-consumer";
    }
  | {
      readonly kind: "refused";
      readonly reason:
        | "tower.tenant_mismatch"
        | "tower.not_authorized"
        | "tower.unsafe_payload"
        | "tower.unverified_evidence";
    };

/** Plans optional outbound synchronization without granting remote mutation. */
export function planControlTowerPublish(input: {
  readonly enabled: boolean;
  readonly online: boolean;
  readonly authenticatedTenantId: string;
  readonly role: TowerRole;
  readonly envelope: ControlTowerEnvelope;
}): ControlTowerDecision {
  if (!input.enabled) return { kind: "local-only", reason: "disabled" };
  if (!input.online) return { kind: "local-only", reason: "offline" };
  if (input.authenticatedTenantId !== input.envelope.tenantId) {
    return { kind: "refused", reason: "tower.tenant_mismatch" };
  }
  if (input.role === "viewer") {
    return { kind: "refused", reason: "tower.not_authorized" };
  }
  if (
    !input.envelope.redacted ||
    !input.envelope.encrypted ||
    input.envelope.containsSource ||
    input.envelope.containsPrompt ||
    input.envelope.containsSecret
  ) {
    return { kind: "refused", reason: "tower.unsafe_payload" };
  }
  if (!input.envelope.signed) {
    return { kind: "refused", reason: "tower.unverified_evidence" };
  }
  return {
    kind: "publish",
    tenantId: input.envelope.tenantId,
    projectId: input.envelope.projectId,
    bundleDigest: input.envelope.bundleDigest,
    remoteAuthority: "evidence-consumer",
  };
}

export function resolveControlTowerConflict(input: {
  readonly localBundleDigest: string;
  readonly remoteBundleDigest: string | null;
}):
  | { readonly kind: "in-sync" }
  | {
      readonly kind: "publish-local-evidence";
      readonly authoritativeDigest: string;
    } {
  return input.remoteBundleDigest === input.localBundleDigest
    ? { kind: "in-sync" }
    : {
        kind: "publish-local-evidence",
        authoritativeDigest: input.localBundleDigest,
      };
}

export type ControlTowerDataDecision =
  | {
      readonly kind: "authorized";
      readonly operation: "export" | "delete";
      readonly tenantId: string;
      readonly projectId: string;
    }
  | {
      readonly kind: "refused";
      readonly reason: "tower.tenant_mismatch" | "tower.not_authorized";
    };

export function authorizeControlTowerDataOperation(input: {
  readonly operation: "export" | "delete";
  readonly authenticatedTenantId: string;
  readonly requestedTenantId: string;
  readonly projectId: string;
  readonly role: TowerRole;
}): ControlTowerDataDecision {
  if (input.authenticatedTenantId !== input.requestedTenantId) {
    return { kind: "refused", reason: "tower.tenant_mismatch" };
  }
  if (input.role !== "administrator") {
    return { kind: "refused", reason: "tower.not_authorized" };
  }
  return {
    kind: "authorized",
    operation: input.operation,
    tenantId: input.requestedTenantId,
    projectId: input.projectId,
  };
}
