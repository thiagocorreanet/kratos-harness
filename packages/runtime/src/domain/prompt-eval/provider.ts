import type { TokenConsumption } from "./model.js";

export interface ModelInvocationRequest {
  readonly systemPrompt: string;
  readonly userMessage: string;
  readonly temperature?: number | undefined;
}

export interface ModelInvocationResponse {
  readonly rawReply: string;
  readonly durationMs: number;
  readonly consumption: TokenConsumption;
}

export interface EvaluationModelProvider {
  invoke(request: ModelInvocationRequest): Promise<ModelInvocationResponse>;
  gradeSemantic?(
    rubric: string,
    reply: string,
  ): Promise<{ passed: boolean; reason?: string | undefined }>;
}

export type DeterministicReplayProvider = EvaluationModelProvider;
