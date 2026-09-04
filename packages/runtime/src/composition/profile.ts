import type { Invocation } from "../domain/cli/index.js";
import { deriveProjectProfile } from "../domain/init/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import type { RuntimePorts } from "../ports/index.js";

import type { Observed } from "./init.js";
import { readOnlyPorts } from "./read-only.js";
import {
  observeManifestContents,
  observeRepositoryEvidence,
} from "./repository.js";
import { anchorPorts, resolveCommandRoot } from "./root.js";
import { createSchemaRegistry } from "./schema.js";

/**
 * Observe the derived project profile without deciding anything from it.
 *
 * This is the same composition `init` performs before it resolves answers --
 * the bounded scan, the declarative manifests, and the pure derivation over
 * both. It is repeated here rather than shared through `init` because `init`
 * cannot run until the interview is over, and the interview is exactly when
 * the candidates are needed.
 *
 * The ports are read-only. Publishing what a repository looks like must not be
 * the thing that creates state in it.
 */
export async function observeProjectProfile(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry = createSchemaRegistry(),
): Promise<Observed> {
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return { kind: "failure", result: root.result };
  const anchored = readOnlyPorts(anchorPorts(root.target, ports));

  const evidence = await observeRepositoryEvidence(anchored.fileSystem);
  const manifests = await observeManifestContents(
    anchored.fileSystem,
    evidence,
  );
  return {
    kind: "observed",
    observation: {
      kind: "project-profile",
      derived: deriveProjectProfile(evidence, manifests),
    },
    ports: anchored,
  };
}
