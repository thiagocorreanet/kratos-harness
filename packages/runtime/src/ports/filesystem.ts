/** Result of resolving one requested mutation target against the project. */
export type TargetInspection =
  | {
      readonly kind: "inside";
      readonly lexicalPath: string;
      readonly canonicalPath: string;
    }
  | { readonly kind: "escape" }
  | { readonly kind: "uninspectable" };

/** One request's read-only inspections against a pinned project-root identity. */
export interface TargetInspectionSession {
  inspect(target: string): Promise<TargetInspection>;
}

/** Capture a project-root identity before a host is allowed to mutate. */
export interface TargetInspector {
  capture(): Promise<TargetInspectionSession>;
}
