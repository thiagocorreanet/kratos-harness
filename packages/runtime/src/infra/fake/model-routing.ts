import type { HostModelCatalog } from "../../domain/model-roles/index.js";
import type { ModelRouting } from "../../ports/model-routing.js";

function snapshotCatalog(catalog: HostModelCatalog): HostModelCatalog {
  return Object.freeze({
    host: catalog.host,
    defaults: Object.freeze({
      planner: Object.freeze({ ...catalog.defaults.planner }),
      implementer: Object.freeze({ ...catalog.defaults.implementer }),
      judge: Object.freeze({ ...catalog.defaults.judge }),
    }),
    models: Object.freeze(
      catalog.models.map(({ canonicalModel, aliases, efforts }) =>
        Object.freeze({
          canonicalModel,
          aliases: Object.freeze([...aliases]),
          efforts: Object.freeze([...efforts]),
        }),
      ),
    ),
  });
}

/**
 * Fixed host facts for deterministic tests. Missing facts stay missing: this
 * fake never synthesizes a catalog or derives one from a selected model.
 */
export function fixedModelRouting(
  catalogs: readonly HostModelCatalog[],
): ModelRouting {
  const snapshots = new Map<"claude" | "codex", HostModelCatalog>();
  for (const catalog of catalogs) {
    if (snapshots.has(catalog.host)) {
      throw new Error(`Duplicate model catalog for ${catalog.host}`);
    }
    snapshots.set(catalog.host, snapshotCatalog(catalog));
  }
  return Object.freeze({
    observe: (host: "claude" | "codex") =>
      Promise.resolve(snapshots.get(host) ?? null),
  });
}
