import type { HostModelCatalog } from "../domain/model-roles/index.js";

/** Read-only host facts used to resolve configured model assignments. */
export interface ModelRouting {
  observe(host: "claude" | "codex"): Promise<HostModelCatalog | null>;
}
