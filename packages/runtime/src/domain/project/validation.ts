import type { ReadableProjectConfig } from "@kratos/contracts";

export type ConfigurationValidation =
  | { readonly kind: "valid"; readonly value: ReadableProjectConfig }
  | { readonly kind: "invalid" };

/** Pure seam implemented by the schema registry owned by RUN-04. */
export type ConfigurationValidator = (
  value: unknown,
) => ConfigurationValidation;
