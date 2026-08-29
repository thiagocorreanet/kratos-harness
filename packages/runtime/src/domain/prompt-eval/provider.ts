import type { TokenConsumption } from "./model.js";

export interface ModelInvocationRequest {
  readonly systemPrompt: string;
  readonly userMessage: string;
  readonly temperature?: number;
}

export interface ModelInvocationResponse {
  readonly rawReply: string;
  readonly durationMs: number;
  readonly consumption: TokenConsumption;
}

export interface EvaluationModelProvider {
  invoke(request: ModelInvocationRequest): Promise<ModelInvocationResponse>;
  gradeSemantic?(rubric: string, reply: string): Promise<{ passed: boolean; reason?: string }>;
}

export type DeterministicReplayProvider = EvaluationModelProvider;
