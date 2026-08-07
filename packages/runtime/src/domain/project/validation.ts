import type { ProjectConfigV1 } from "@mestre-yoda/contracts";

export type ConfigurationValidation =
  | { readonly kind: "valid"; readonly value: ProjectConfigV1 }
  | { readonly kind: "invalid" };

/** Pure seam implemented by the schema registry owned by RUN-04. */
export type ConfigurationValidator = (
  value: unknown,
) => ConfigurationValidation;
