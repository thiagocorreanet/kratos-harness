import type { EventV1 } from "@kratos/contracts";

import { canonicalizeJson } from "../schema/index.js";
import { EventIntegrityError, type EventContractFailure } from "./model.js";
import type { SchemaRegistry } from "../schema/index.js";

export const EVENT_RECORD_BYTES = 64 * 1024;
export const EVENT_STREAM_BYTES = 64 * 1024 * 1024;
export const EVENT_STREAM_COUNT = 100_000;

const encoder = new TextEncoder();

function contractVersion(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as Readonly<Record<string, unknown>>).stateContract;
}

function contractFailure(reasonCode: string): EventContractFailure | null {
  if (
    reasonCode === "contract.state_version_invalid" ||
    reasonCode === "contract.state_version_unsupported"
  ) {
    return reasonCode;
  }
  return null;
}

function validateEvent(
  value: unknown,
  schemaRegistry: SchemaRegistry,
): EventV1 {
  const validated = schemaRegistry.validate({
    id: "state.event",
    version: contractVersion(value),
    value,
    structuralReasonCode: "runtime.state_corrupt",
  });
  if (validated.kind === "valid") {
    if (validated.value.contractVersion === "1.1.0") {
      throw new EventIntegrityError("unsupported_policy");
    }
    return validated.value;
  }

  const reasonCode = validated.diagnostics
    .filter((diagnostic) => diagnostic.keyword === "version")
    .map((diagnostic) => contractFailure(diagnostic.reasonCode))
    .find((reason) => reason !== null);
  throw new EventIntegrityError("invalid_event", reasonCode ?? null);
}

export function parseEventLines(
  text: string,
  schemaRegistry: SchemaRegistry,
): readonly EventV1[] {
  if (encoder.encode(text).byteLength > EVENT_STREAM_BYTES) {
    throw new EventIntegrityError("resource_limit");
  }
  if (text === "") return [];
  if (text.includes("\r") || !text.endsWith("\n")) {
    throw new EventIntegrityError("non_canonical");
  }

  const lines = text.split("\n");
  lines.pop();
  if (lines.length > EVENT_STREAM_COUNT || lines.some((line) => line === "")) {
    throw new EventIntegrityError(
      lines.length > EVENT_STREAM_COUNT ? "resource_limit" : "non_canonical",
    );
  }

  return lines.map((line) => {
    if (encoder.encode(line).byteLength > EVENT_RECORD_BYTES) {
      throw new EventIntegrityError("resource_limit");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new EventIntegrityError("invalid_event");
    }
    const event = validateEvent(parsed, schemaRegistry);
    try {
      if (canonicalizeJson(event) !== line) {
        throw new EventIntegrityError("non_canonical");
      }
    } catch (error: unknown) {
      if (error instanceof EventIntegrityError) throw error;
      throw new EventIntegrityError("invalid_event");
    }
    return event;
  });
}
