export { renderHelp, usageLine } from "./help.js";
export { DEFAULT_REGISTRY } from "./commands.js";
export { dispatch } from "./dispatch.js";
export { initCommand } from "./init.js";
export {
  memoryMigrationApplyArgv,
  renderMemoryMigrationApply,
} from "./migration.js";
export {
  renderApplyInstructions,
  renderPosixCommand,
  renderPowerShellCommand,
} from "./shell-argument.js";
export { hookCommand } from "./hook.js";
export { guardWriteCommand, scopeRecordCommand } from "./write-guard.js";
export { objectiveCommand } from "./objective.js";
export { adaptersCommand } from "./adapters.js";
export { agentRecordCommand } from "./agent.js";
export { approveCommand } from "./approval.js";
export {
  auditCommand,
  dashboardCommand,
  evidenceBundleCommand,
  repairCommand,
} from "./observability.js";
export { continueCommand, doneCommand, startCommand } from "./workflow.js";
export {
  budgetsCommand,
  doctorCommand,
  explainCommand,
  handoffCommand,
  statsCommand,
  statusCommand,
} from "./diagnostics.js";
export { narrateCommand } from "./narrate.js";
export { repairResolveCommand } from "./repair-resolve.js";
export { observingCommand } from "./observed.js";
export {
  RETIRED_COMMANDS,
  RETIRED_COMMAND_SPECS,
  retiredCommand,
  retiredWhy,
} from "./retired.js";
export type { RetiredCommandName } from "./retired.js";
export {
  parseArguments,
  parseGlobals,
  parseInvocation,
  resolveCommand,
} from "./parse.js";
export type {
  ArgumentParse,
  GlobalParse,
  ParseOutcome,
  Resolution,
} from "./parse.js";
export { GLOBAL_FLAGS } from "./spec.js";
export type {
  CommandHandler,
  CommandObservation,
  CommandPrerequisite,
  CommandRegistry,
  CommandSpec,
  Decision,
  FlagSpec,
  Globals,
  Invocation,
  JsonContractId,
  GuardWriteOutcome,
  ScopeRecordOutcome,
} from "./spec.js";
