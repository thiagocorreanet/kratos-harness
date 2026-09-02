export { DEFAULT_LANGUAGE_POLICY, resolveInitAnswers } from "./answers.js";
export type {
  ModelResolutionSubject,
  ModelResolutionRefusal,
  ResolvedAnswers,
  ResolvedInitAnswers,
  ResolvedModelRoles,
  ResolvedRoleMap,
} from "./answers.js";
export {
  resolveProjectProfile,
  unresolvedProjectProfile,
  unresolvedProjectProfileKeys,
} from "./profile.js";
export type {
  PartialProjectProfile,
  ProjectProfileLeaf,
  ResolvedProjectProfile,
} from "./profile.js";
export { detectLanguageConventions } from "./detect.js";
export type {
  DetectedLanguageConventions,
  LanguageConventionEvidence,
  LanguageConventionSample,
} from "./detect.js";
export {
  MANAGED_SECTION_BEGIN,
  MANAGED_SECTION_END,
  extractManagedSection,
  planManagedFile,
} from "./managed-section.js";
export type {
  ManagedFileAuthorization,
  ManagedFileObservation,
  ManagedFilePlan,
} from "./managed-section.js";
export { destinationsOf, skeletonEffects } from "./skeleton.js";
export { renderStackProfile } from "./stack-profile.js";
export {
  profileStack,
  SCAN_EXCLUDED_DIRECTORIES,
  SCAN_MAX_DEPTH,
  SCAN_MAX_ENTRIES,
  STACK_IDS,
} from "./stack.js";
export type {
  DetectedLanguage,
  DetectedStack,
  LanguageId,
  ObservedEvidence,
  ObservedExtension,
  RepositoryEvidence,
  StackId,
  StackProfile,
} from "./stack.js";
export {
  assertPermissionProvenance,
  deriveHostPermissions,
} from "./permissions.js";
export type {
  GitEvidence,
  HostPermissionsResult,
  PermissionOrigin,
  PermissionProvenance,
} from "./permissions.js";
export { generateHostStackRules, renderStackRuleContent } from "./rules.js";
