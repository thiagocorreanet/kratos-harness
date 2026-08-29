import {
  snapshotHostModelCatalog,
  type HostModelCatalog,
} from "../domain/model-roles/index.js";
import type { ModelRouting } from "../ports/index.js";

/** Capture one inert catalog snapshot at the host/runtime composition edge. */
export async function observeModelCatalog(
  routing: ModelRouting,
  host: "claude" | "codex",
): Promise<HostModelCatalog | null> {
  try {
    return snapshotHostModelCatalog(await routing.observe(host), host);
  } catch {
    return null;
  }
}
