/** Result of resolving one requested mutation target against the project. */
export type TargetInspection =
  | { readonly kind: "inside"; readonly path: string }
  | { readonly kind: "escape" }
  | { readonly kind: "uninspectable" };

/** Read-only canonical inspection used before a host is allowed to mutate. */
export interface TargetInspector {
  inspect(target: string): Promise<TargetInspection>;
}
