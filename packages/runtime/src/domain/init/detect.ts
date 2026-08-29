import type { LanguagePolicyV1 } from "@kratos/contracts";

export interface LanguageConventionSample {
  readonly path: string;
  readonly content: string;
}

export interface LanguageConventionEvidence {
  readonly rootEntries: readonly string[];
  readonly sampleContent?: readonly LanguageConventionSample[];
}

export type DetectedLanguageConventions = Partial<
  Pick<
    LanguagePolicyV1,
    "conversation" | "documentation" | "comments" | "identifiers" | "commits"
  >
>;

const PT_BR_DOC_NAMES = /^(README|LEIAME)\.pt(-BR)?\.md$/i;
const PT_BR_LEIAME = /^LEIAME(\..+)?\.md$/i;
const EN_DOC_NAMES = /^README\.en\.md$/i;

const PT_BR_CONTENT_MARKERS = [
  /brazilian portuguese/i,
  /\bdocumentação\b/i,
  /\bdesenvolvimento\b/i,
  /\binstalação\b/i,
  /\bconfiguração\b/i,
  /\brequisitos\b/i,
  /\bvisão geral\b/i,
  /\blicença\b/i,
];

const EN_CONTENT_MARKERS = [
  /\bdocumentation\b/i,
  /\binstallation\b/i,
  /\bconfiguration\b/i,
  /\brequirements\b/i,
  /\boverview\b/i,
  /\blicense\b/i,
];

/**
 * Offline, deterministic repository language convention detection.
 *
 * Inspects root entries and provided sample contents without network calls or
 * unconstrained heuristic guesses.
 */
export function detectLanguageConventions(
  evidence: LanguageConventionEvidence,
): DetectedLanguageConventions {
  const result: {
    conversation?: "en" | "pt-BR";
    documentation?: "en" | "pt-BR";
    comments?: "en" | "pt-BR";
    identifiers?: "en" | "pt-BR";
    commits?: "en" | "pt-BR";
  } = {};

  for (const entry of evidence.rootEntries) {
    if (PT_BR_DOC_NAMES.test(entry) || PT_BR_LEIAME.test(entry)) {
      result.documentation = "pt-BR";
      break;
    }
    if (EN_DOC_NAMES.test(entry)) {
      result.documentation = "en";
      break;
    }
  }

  if (evidence.sampleContent !== undefined) {
    for (const sample of evidence.sampleContent) {
      if (result.documentation === undefined) {
        if (PT_BR_DOC_NAMES.test(sample.path) || PT_BR_LEIAME.test(sample.path)) {
          result.documentation = "pt-BR";
        } else if (EN_DOC_NAMES.test(sample.path)) {
          result.documentation = "en";
        } else if (
          PT_BR_CONTENT_MARKERS.some((pattern) => pattern.test(sample.content))
        ) {
          result.documentation = "pt-BR";
        } else if (
          EN_CONTENT_MARKERS.some((pattern) => pattern.test(sample.content))
        ) {
          result.documentation = "en";
        }
      }
    }
  }

  return Object.freeze(result);
}
