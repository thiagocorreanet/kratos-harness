import {
  OperationResultContractError,
  validateOperationPublicText,
  validateOperationResult,
} from "@kratos/contracts";

import type { Result } from "./result.js";

export class ResultContractError extends Error {
  constructor(detail: string) {
    super(`Result contract validation failed: ${detail}`);
    this.name = "ResultContractError";
  }
}

/** Validate command-owned text before it reaches either public stream. */
export function validatePublicText(text: string): string {
  try {
    return validateOperationPublicText(text);
  } catch (error) {
    if (error instanceof OperationResultContractError) {
      throw new ResultContractError(error.message);
    }
    throw error;
  }
}

/** Prove a result may be published before a renderer writes any bytes. */
export function validateResult(result: Result): Result {
  try {
    return validateOperationResult(result);
  } catch (error) {
    if (error instanceof OperationResultContractError) {
      throw new ResultContractError(error.message);
    }
    throw error;
  }
}
