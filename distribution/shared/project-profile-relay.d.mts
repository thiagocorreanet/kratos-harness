export interface ProjectProfileQuestion {
  readonly key: string;
  readonly prompt: string;
}

export declare const projectProfileQuestions: readonly ProjectProfileQuestion[];

export declare function shapeProfileLeaf(leaf: unknown): unknown;

export declare function relayProjectProfileAnswers(
  answers: Readonly<Record<string, unknown>> | null | undefined,
): unknown;
