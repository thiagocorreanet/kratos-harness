import { KRATOS_VERSION } from "@kratos/contracts";

import { planOf } from "../effects.js";
import { buildHandshakeResponse } from "../handshake.js";
import { resultFor } from "../result/index.js";
import { renderHelp } from "./help.js";
import { initCommand } from "./init.js";
import { hookCommand } from "./hook.js";
import {
  memoryArchiveCommand,
  memoryCaptureCommand,
  memoryCurateCommand,
  memoryListCommand,
  memoryMergeCommand,
  memoryPromoteCommand,
  memoryReinforceCommand,
} from "./memory.js";
import { objectiveCommand } from "./objective.js";
import { profileDeriveCommand } from "./profile.js";
import { continueCommand, doneCommand, startCommand } from "./workflow.js";
import {
  budgetsCommand,
  doctorCommand,
  explainCommand,
  handoffCommand,
  metricsRefreshCommand,
  statsCommand,
  statusCommand,
} from "./diagnostics.js";
import { RETIRED_COMMAND_SPECS } from "./retired.js";
import { adaptersCommand } from "./adapters.js";
import { agentRecordCommand } from "./agent.js";
import { approveCommand } from "./approval.js";
import { evidenceRecordCommand } from "./evidence.js";
import {
  gapsRecordCommand,
  gapsResolveCommand,
  gapsWaiveCommand,
  gatesRecordCommand,
} from "./gaps.js";
import {
  migrateBrainCommand,
  migrateConfigCommand,
  migrateMemoryCommand,
  migrateRollbackCommand,
} from "./migration.js";
import { guardWriteCommand, scopeRecordCommand } from "./write-guard.js";
import { unlockStopLossCommand } from "./unlock.js";
import { narrateCommand } from "./narrate.js";
import { repairResolveCommand } from "./repair-resolve.js";
import {
  auditCommand,
  dashboardCommand,
  evidenceBundleCommand,
  repairCommand,
} from "./observability.js";
import type {
  CommandRegistry,
  CommandSpec,
  Decision,
  Invocation,
} from "./spec.js";

function orientation(summary: string, humanStdout: string): Decision {
  return {
    result: resultFor("runtime.orientation_ok", { summary }),
    plan: planOf(),
    humanStdout,
    payload: null,
  };
}

const helpCommand: CommandSpec = {
  path: ["help"],
  summary: "Print the command usage text.",
  flags: [],
  positionals: { min: 0, max: 0 },
  jsonContract: "result@1.0.0",
  prerequisite: "none",
  handler: (invocation: Invocation): Decision =>
    orientation(
      "The runtime published its command usage text.",
      renderHelp(invocation.registry),
    ),
};

const versionCommand: CommandSpec = {
  path: ["version"],
  summary: "Print the runtime version.",
  flags: [],
  positionals: { min: 0, max: 0 },
  jsonContract: "result@1.0.0",
  prerequisite: "none",
  handler: (): Decision =>
    orientation(`Runtime version ${KRATOS_VERSION}.`, `${KRATOS_VERSION}\n`),
};

const handshakeCommand: CommandSpec = {
  path: ["handshake"],
  summary: "Report the contract versions this runtime carries.",
  flags: [],
  positionals: { min: 0, max: 0 },
  jsonContract: "adapter-message@1.0.0",
  prerequisite: "none",
  handler: (): Decision => {
    const message = buildHandshakeResponse("cli");
    return {
      result: resultFor("runtime.orientation_ok", {
        summary: "The runtime reported the contract versions it carries.",
      }),
      plan: planOf(),
      humanStdout: `${JSON.stringify(message)}\n`,
      payload: message,
    };
  },
};

export const DEFAULT_REGISTRY: CommandRegistry = [
  adaptersCommand,
  agentRecordCommand,
  approveCommand,
  auditCommand,
  budgetsCommand,
  continueCommand,
  dashboardCommand,
  doctorCommand,
  doneCommand,
  evidenceBundleCommand,
  evidenceRecordCommand,
  explainCommand,
  gapsRecordCommand,
  gapsResolveCommand,
  gapsWaiveCommand,
  guardWriteCommand,
  gatesRecordCommand,
  handoffCommand,
  handshakeCommand,
  helpCommand,
  initCommand,
  hookCommand,
  migrateBrainCommand,
  migrateConfigCommand,
  migrateMemoryCommand,
  migrateRollbackCommand,
  metricsRefreshCommand,
  memoryCaptureCommand,
  memoryCurateCommand,
  memoryListCommand,
  memoryPromoteCommand,
  memoryReinforceCommand,
  memoryMergeCommand,
  memoryArchiveCommand,
  narrateCommand,
  objectiveCommand,
  profileDeriveCommand,
  repairCommand,
  repairResolveCommand,
  startCommand,
  statsCommand,
  statusCommand,
  scopeRecordCommand,
  unlockStopLossCommand,
  versionCommand,
  ...RETIRED_COMMAND_SPECS,
];
