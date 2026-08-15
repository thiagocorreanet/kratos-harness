import type { MigrationV1 } from "@kratos/contracts";

import {
  authorizeMigration,
  completeMigration,
  plannedMigration,
  rollBackMigration,
  type MigrationAction,
} from "../migration/index.js";
import { planOf, type Effect } from "../effects.js";
import { resultFor } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type {
  CommandObservation,
  CommandSpec,
  Decision,
  Invocation,
} from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "migration" }>;

const ROOT_FLAG: CommandSpec["flags"] = [
  {
    name: "--root",
    kind: "value",
    valueLabel: "<path>",
    summary: "Operate on the project rooted at this path.",
  },
];

export const migrateBrainCommand: CommandSpec = observingCommand(
  "migration",
  {
    path: ["migrate", "brain"],
    summary: "Preview or execute the legacy sibling Brain migration.",
    flags: [
      ...ROOT_FLAG,
      {
        name: "--source-contract",
        kind: "value",
        valueLabel: "<0.9.0|go-v3@0.6.5>",
        summary: "Declare the legacy contract being migrated.",
      },
      {
        name: "--yes",
        kind: "boolean",
        summary: "Authorize the exact digest-bound migration plan.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => migrateBrain(invocation, observation),
);

export const migrateRollbackCommand: CommandSpec = observingCommand(
  "migration",
  {
    path: ["migrate", "rollback"],
    summary: "Roll back files created by one completed migration.",
    flags: ROOT_FLAG,
    positionals: { min: 1, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => migrateRollback(observation),
);

function migrateBrain(
  invocation: Invocation,
  observation: Observation,
): Decision {
  const operation = observation.operation;
  if (operation.kind !== "brain") return corrupt();
  const sourceContract =
    invocation.flags.get("--source-contract") ?? "go-v3@0.6.5";
  if (sourceContract !== "0.9.0" && sourceContract !== "go-v3@0.6.5") {
    return usage();
  }
  if (operation.plan.kind === "nothing_to_migrate") {
    return orientation("No legacy sibling Brain state was found.");
  }
  if (operation.plan.kind === "ambiguous") {
    return blocked("More than one legacy Brain candidate was discovered.");
  }
  if (operation.plan.kind === "blocked") {
    return blocked(
      `Migration is blocked by ${String(operation.plan.blocking.length)} conflicting or unsupported entry.`,
    );
  }
  const copies = operation.plan.actions.filter(
    (action): action is Extract<MigrationAction, { readonly kind: "copy" }> =>
      action.kind === "copy",
  );
  if (copies.length === 0) {
    return orientation(
      "Every legacy file already has identical project-owned content.",
    );
  }
  if (invocation.flags.get("--yes") !== true) {
    return orientation(
      `Migration plan ${operation.plan.planDigest} would copy ${String(copies.length)} file and ${String(operation.plan.requiredBytes)} byte. Re-run with --yes to authorize this exact plan.`,
    );
  }
  const root = `.brain/migrations/${operation.migrationId}`;
  const authorizationRef = `${root}/authorization.json`;
  const rollbackRef = `${root}/rollback.json`;
  const sources = new Map(operation.sourceFiles.map((file) => [file.path, file]));
  const conversion = (
    copy: Extract<MigrationAction, { readonly kind: "copy" }>,
  ): MigrationV1["conversions"][number] => ({
    payloadContract: `artifact:${copy.sha256.slice(0, 24)}`,
    sourceDigest: copy.sha256,
    destinationDigest: copy.sha256,
  });
  const firstCopy = copies[0];
  if (firstCopy === undefined) return corrupt();
  const conversions: MigrationV1["conversions"] = [
    conversion(firstCopy),
    ...copies.slice(1).map(conversion),
  ];
  const planned = plannedMigration({
    migrationId: operation.migrationId,
    sourceContract,
    planDigest: operation.plan.planDigest,
    authorizationRef,
    backupDigest: operation.backupDigest,
    conversions,
    rollbackRef,
    now: operation.now,
  });
  const authorized = authorizeMigration(
    planned,
    operation.plan.planDigest,
    authorizationRef,
    operation.now,
  );
  if (authorized === null) return corrupt();
  const completed = completeMigration(
    authorized,
    copies.map(({ target }) => target),
    operation.now,
  );
  if (completed === null) return corrupt();
  const copyEffects: Effect[] = [];
  for (const copy of copies) {
    const source = sources.get(copy.source);
    if (source === undefined || source.sha256 !== copy.sha256) return corrupt();
    copyEffects.push({
      kind: "write_file",
      path: copy.target,
      content: source.content,
    });
  }
  const receiptRef = `${root}/receipt.json`;
  return {
    result: resultFor("trail.ok", {
      summary: `Completed migration plan ${operation.plan.planDigest}.`,
      stateChanged: true,
      evidence: [
        { kind: "artifact", ref: receiptRef },
        ...copies.map(({ target }) => ({ kind: "artifact" as const, ref: target })),
      ],
    }),
    rootMode: "initialize",
    plan: planOf(
      ...copyEffects,
      {
        kind: "write_file",
        path: authorizationRef,
        content: `${JSON.stringify({ migrationId: operation.migrationId, planDigest: operation.plan.planDigest, authorizedAt: operation.now }, null, 2)}\n`,
      },
      {
        kind: "write_file",
        path: rollbackRef,
        content: `${JSON.stringify({ migrationId: operation.migrationId, backupDigest: operation.backupDigest, targets: copies.map(({ target }) => target).sort() }, null, 2)}\n`,
      },
      {
        kind: "write_file",
        path: receiptRef,
        content: `${JSON.stringify(completed, null, 2)}\n`,
      },
    ),
    humanStdout: null,
    payload: null,
  };
}

function migrateRollback(observation: Observation): Decision {
  const operation = observation.operation;
  if (
    operation.kind !== "rollback" ||
    operation.receipt === null ||
    operation.targets.length === 0
  ) {
    return corrupt();
  }
  const rolledBack = rollBackMigration(
    operation.receipt,
    operation.receipt.backupDigest,
    operation.now,
  );
  if (rolledBack === null) return usage();
  const receiptRef = `.brain/migrations/${operation.migrationId}/receipt.json`;
  return {
    result: resultFor("trail.ok", {
      summary: `Rolled back migration ${operation.migrationId}.`,
      stateChanged: true,
      evidence: [{ kind: "artifact", ref: receiptRef }],
    }),
    plan: planOf(
      ...operation.targets.map((path) => ({ kind: "delete_file" as const, path })),
      {
        kind: "write_file",
        path: receiptRef,
        content: `${JSON.stringify(rolledBack, null, 2)}\n`,
      },
    ),
    humanStdout: null,
    payload: null,
  };
}

function orientation(summary: string): Decision {
  return {
    result: resultFor("runtime.orientation_ok", { summary }),
    plan: planOf(),
    humanStdout: `${summary}\n`,
    payload: null,
  };
}

function blocked(why: string): Decision {
  return {
    result: resultFor("brain_migration_pending", { why: [why] }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function usage(): Decision {
  return {
    result: resultFor("trail.uso", {
      why: ["The migration arguments do not satisfy the command contract."],
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function corrupt(): Decision {
  return {
    result: resultFor("runtime.state_corrupt", {
      why: ["Migration state or its rollback receipt is unreadable."],
      evidence: [{ kind: "artifact", ref: ".brain/migrations" }],
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
