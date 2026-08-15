import type { Decision, Invocation } from "./spec.js";

/** Invoke a resolved pure command handler. */
export function dispatch(invocation: Invocation): Decision {
  return invocation.command.handler(invocation);
}
