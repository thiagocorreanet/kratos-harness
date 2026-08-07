import type { ProjectConfigV1 } from "@mestre-yoda/contracts";

interface Rooted {
  /** Internal absolute path. It must never be copied to public output. */
  readonly root: string;
}

export type ProjectResolution =
  | (Rooted & {
      readonly kind: "initialized";
      readonly configuration: ProjectConfigV1;
    })
  | (Rooted & { readonly kind: "root-only" })
  | (Rooted & {
      readonly kind: "migration-pending";
      readonly reasonCode: "brain_migration_pending";
    })
  | (Rooted & {
      readonly kind: "marker-unusable";
      readonly reasonCode: "guard.project_marker_corrupt";
    })
  | (Rooted & {
      readonly kind: "configuration-unusable";
      readonly reasonCode:
        | "guard.config_missing"
        | "guard.config_corrupt"
        | "contract.state_version_invalid"
        | "contract.state_version_unsupported";
    })
  | {
      readonly kind: "not-found";
      readonly reasonCode: "guard.config_missing";
    }
  | { readonly kind: "refused"; readonly reasonCode: "trail.uso" };
