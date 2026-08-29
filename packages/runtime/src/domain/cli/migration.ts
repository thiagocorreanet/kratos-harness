import type { MigrationV1 } from "@kratos/contracts";

import {
  authorizeMigration,
  completeMigration,
  plannedMigration,
  rollBackConfigMigration,
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

export const migrateConfigCommand: CommandSpec = observingCommand(
  "migration",
  {
    path: ["migrate", "config"],
    summary: "Preview or execute the project configuration upgrade.",
    flags: [
      ...ROOT_FLAG,
      {
        name: "--answers",
        kind: "value",
        valueLabel: "<path>",
        summary: "Read explicit enabled hosts and role answers from a file.",
      },
      {
        name: "--yes",
        kind: "boolean",
        summary: "Authorize the exact digest-bound configuration plan.",
      },
      {
        name: "--plan-digest",
        kind: "value",
        valueLabel: "<sha256>",
        summary: "Authorize the exact write-set digest printed by preview.",
      },
      {
        name: "--plan-time",
        kind: "value",
        valueLabel: "<instant>",
        summary: "Reuse the exact plan instant printed by preview.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => migrateConfig(invocation, observation),
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
  const sources = new Map(
    operation.sourceFiles.map((file) => [file.path, file]),
  );
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
    if (source?.sha256 !== copy.sha256) return corrupt();
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
        ...copies.map(({ target }) => ({
          kind: "artifact" as const,
          ref: target,
        })),
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

function migrateConfig(
  invocation: Invocation,
  observation: Observation,
): Decision {
  const operation = observation.operation;
  if (operation.kind === "config-current") {
    return orientation(
      `Project configuration ${operation.sha256} is already current.`,
    );
  }
  if (operation.kind !== "config") return corrupt();

  const details = configPlanDetails(operation);
  if (invocation.flags.get("--yes") !== true) {
    return {
      result: resultFor("runtime.orientation_ok", {
        summary: `Configuration migration plan ${operation.planDigest} is ready.`,
        why: details,
      }),
      plan: planOf(),
      humanStdout: `${[
        "Configuration migration preview",
        `Plan digest: ${operation.planDigest}`,
        `Plan time: ${operation.now}`,
        ...details,
        `Apply command: ${configApplyCommand(invocation, operation.planDigest, operation.now)}`,
      ].join("\n")}\n`,
      payload: null,
    };
  }
  if (
    invocation.flags.get("--plan-digest") !== operation.planDigest ||
    invocation.flags.get("--plan-time") !== operation.now
  ) {
    return usage();
  }
  return {
    result: resultFor("trail.ok", {
      summary: `Completed configuration migration plan ${operation.planDigest}.`,
      stateChanged: true,
      evidence: operation.writes.map(({ path: ref }) => ({
        kind: "artifact" as const,
        ref,
      })),
      why: operation.defaulted.map((path) => `defaulted: ${path}`),
    }),
    plan: planOf(
      ...operation.guards.map(({ path, content, expected }) => ({
        kind: "write_file" as const,
        path,
        content,
        expected,
      })),
      ...operation.writes.map(({ path, content, expected }) => ({
        kind: "write_file" as const,
        path,
        content,
        expected,
      })),
    ),
    humanStdout: null,
    payload: null,
  };
}

function configPlanDetails(
  operation: Extract<Observation["operation"], { readonly kind: "config" }>,
): string[] {
  const details = [
    `Source SHA-256: ${operation.source.sha256}`,
    `Destination SHA-256: ${operation.destinationDigest}`,
    `Answers ${operation.answers.ref} SHA-256: ${operation.answers.sha256}`,
    ...operation.catalogs.map(
      ({ host, sha256 }) => `Catalog ${host} SHA-256: ${sha256}`,
    ),
    `Confirmed hosts: ${operation.hosts.join(", ")}`,
    "Assignments:",
  ];
  const roles = ["planner", "implementer", "judge"] as const;
  for (const host of operation.hosts) {
    const assignments = operation.destination.modelRoles[host];
    for (const role of roles) {
      const assignment = assignments?.[role];
      if (assignment === undefined) continue;
      const value =
        typeof assignment === "string"
          ? assignment
          : `${assignment.model}@${assignment.effort}`;
      const defaulted = operation.defaulted.includes(
        `modelRoles.${host}.${role}`,
      );
      details.push(
        `${host}.${role} = ${value}${defaulted ? " (defaulted)" : ""}`,
      );
    }
  }
  details.push(
    "Writes:",
    ...operation.writes.map(({ path, sha256 }) => `- ${path} sha256=${sha256}`),
  );
  return details;
}

function configApplyCommand(
  invocation: Invocation,
  planDigest: string,
  planTime: string,
): string {
  const arguments_: string[] = ["kratos", "migrate", "config"];
  for (const flag of ["--root", "--answers"] as const) {
    const value = invocation.flags.get(flag);
    if (typeof value === "string") arguments_.push(flag, shellArgument(value));
  }
  arguments_.push(
    "--yes",
    "--plan-digest",
    planDigest,
    "--plan-time",
    planTime,
  );
  return arguments_.join(" ");
}

function shellArgument(value: string): string {
  return /^[a-zA-Z0-9._/@:-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function migrateRollback(observation: Observation): Decision {
  const operation = observation.operation;
  if (
    operation.kind !== "rollback" ||
    operation.receipt === null ||
    (operation.targets.length === 0 && operation.replacement === null)
  ) {
    return corrupt();
  }
  if (operation.receipt.stateContract === "1.1.0") {
    const replacement = operation.replacement;
    if (replacement === null) return corrupt();
    const rolledBack = rollBackConfigMigration(
      operation.receipt,
      replacement.backupDigest,
      replacement.destinationDigest,
      operation.now,
    );
    if (rolledBack === null) return corrupt();
    const receiptRef = `.brain/migrations/${operation.migrationId}/receipt.json`;
    return {
      result: resultFor("trail.ok", {
        summary: `Rolled back migration ${operation.migrationId}.`,
        stateChanged: true,
        evidence: [
          { kind: "artifact", ref: receiptRef },
          { kind: "artifact", ref: replacement.destinationRef },
        ],
      }),
      plan: planOf(
        ...replacement.guards.map(({ path, content, expected }) => ({
          kind: "write_file" as const,
          path,
          content,
          expected,
        })),
        {
          kind: "write_file",
          path: replacement.destinationRef,
          content: replacement.content,
          expected: replacement.expected,
        },
        {
          kind: "write_file",
          path: receiptRef,
          content: json(rolledBack),
          expected: replacement.receiptExpected,
        },
      ),
      humanStdout: null,
      payload: null,
    };
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
      ...operation.targets.map((path) => ({
        kind: "delete_file" as const,
        path,
      })),
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
