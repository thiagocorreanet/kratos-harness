import type { ProjectProfileLeaf } from "./profile.js";

/**
 * One file read from disk, with the path it was read from.
 *
 * The path travels with the content because the evidence has to name the file
 * the operator will open, and a repository writes `Taskfile.yaml` as readily
 * as `Taskfile.yml`.
 */
export interface ManifestFile {
  readonly path: string;
  readonly content: string;
}

/** The four answers a command derivation can fill. */
export type CommandSlot = "test" | "lint" | "build" | "run";

const COMMAND_SLOTS: readonly CommandSlot[] = ["test", "lint", "build", "run"];

/** The longest evidence string the profile schema stores. */
const EVIDENCE_MAX_LENGTH = 256;

/** The longest command the profile schema stores. */
const COMMAND_MAX_LENGTH = 2048;

/**
 * How many workflow files one repository contributes, and how large each may
 * be.
 *
 * A ceiling on both is what keeps this reader a bounded pass over text rather
 * than an open invitation to parse whatever a repository happens to hold. Past
 * either limit the file is skipped, exactly as an unreadable manifest is.
 */
export const CI_WORKFLOW_MAX_FILES = 16;
export const CI_FILE_MAX_BYTES = 65_536;

/**
 * What a task name has to say before a command is attributed to a slot.
 *
 * Names are matched, never command text: `dotnet test --filter X` under a step
 * named `Install dependencies` is an install command, and guessing from the
 * verb is how a lint command becomes the test command. `run` is stated by a
 * word that means starting the thing, because "Run" alone is how every other
 * step begins.
 */
const SLOT_PATTERNS: readonly (readonly [CommandSlot, RegExp])[] = [
  ["test", /\b(?:tests?|testing)\b/iu],
  ["lint", /\b(?:lint|lints|linting|linter|format|formatting)\b/iu],
  ["build", /\b(?:build|builds|building|compile|compiles|compilation)\b/iu],
  ["run", /\b(?:start|starts|serve|serves|launch|launches)\b/iu],
];

/**
 * The one slot a name states, or nothing.
 *
 * A name that states two -- `Build and test` -- states neither for this
 * purpose: it names a step that does both, and half of it is not the answer to
 * either question.
 */
export function slotOfName(name: string): CommandSlot | null {
  let found: CommandSlot | null = null;
  for (const [slot, pattern] of SLOT_PATTERNS) {
    if (!pattern.test(name)) continue;
    if (found !== null) return null;
    found = slot;
  }
  return found;
}

/**
 * Record a derived command, unless a more specific source already answered.
 *
 * Every reader here is additive and none overwrites: precedence is the order
 * the callers run in, so the first answer for a slot is the most specific one
 * available.
 */
function offer(
  commands: Record<string, ProjectProfileLeaf<string>>,
  slot: CommandSlot,
  value: string,
  evidence: string,
): void {
  if (slot in commands) return;
  const command = value.trim();
  if (command.length === 0 || command.length > COMMAND_MAX_LENGTH) return;
  if (/[\r\n]/u.test(command)) return;
  if (evidence.length > EVIDENCE_MAX_LENGTH) return;
  commands[slot] = { status: "derived", value: command, evidence };
}

/** A YAML or TOML scalar with its quoting removed, if it carried any. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  if ((first === '"' || first === "'") && trimmed.endsWith(first)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function indentOf(line: string): number {
  let indent = 0;
  while (line[indent] === " ") indent += 1;
  return indent;
}

function isIgnorable(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

/** Split `key: value` into its two halves, or nothing when it is not a key. */
function keyOf(
  body: string,
): { readonly key: string; readonly value: string } | null {
  const match = /^([A-Za-z0-9_.\-$]+)\s*:(?:\s+(.*))?$/u.exec(body);
  if (match?.[1] === undefined) return null;
  return { key: match[1], value: match[2] ?? "" };
}

interface WorkflowStep {
  readonly job: string;
  readonly jobName: string | undefined;
  readonly name: string | undefined;
  readonly run: string;
}

interface StepDraft {
  /** Column the step's own keys sit at, past the `- ` that opened the item. */
  readonly contentIndent: number;
  name?: string;
  run?: string;
}

/**
 * The `run:` steps a GitHub workflow declares, with the job and step that
 * named them.
 *
 * This is a bounded pass over indented text, not a YAML implementation: no
 * anchor is resolved, no file includes another, nothing is evaluated. A
 * construct it does not model -- a block scalar, a matrix expression -- yields
 * no step rather than a guessed one, which is the same silence an unreadable
 * manifest produces.
 */
export function readWorkflowSteps(content: string): readonly WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  let inJobs = false;
  let jobIndent: number | undefined;
  let job: { readonly id: string; name?: string } | undefined;
  let jobBodyIndent: number | undefined;
  let stepsIndent: number | undefined;
  let step: StepDraft | undefined;

  const flush = (): void => {
    if (step?.run !== undefined && job !== undefined) {
      steps.push({
        job: job.id,
        jobName: job.name,
        name: step.name,
        run: step.run,
      });
    }
    step = undefined;
  };

  const assign = (draft: StepDraft, body: string): void => {
    const entry = keyOf(body);
    if (entry === null) return;
    if (entry.key === "name") draft.name = unquote(entry.value);
    // A block scalar is many commands under one key; the single-line form is
    // the only one that answers "what does this project run".
    if (entry.key === "run" && !/^[|>]/u.test(entry.value.trim())) {
      const command = unquote(entry.value);
      if (command.length > 0) draft.run = command;
    }
  };

  for (const line of content.split("\n")) {
    if (isIgnorable(line)) continue;
    // YAML forbids tabs in indentation, so a file using them is one this
    // reader cannot place in a tree and does not try to.
    if (/^\s*\t/u.test(line)) return [];
    const indent = indentOf(line);
    const body = line.slice(indent);

    if (!inJobs) {
      if (indent === 0 && /^jobs\s*:/u.test(body)) inJobs = true;
      continue;
    }

    if (indent === 0) {
      flush();
      inJobs = false;
      job = undefined;
      continue;
    }

    if (
      stepsIndent !== undefined &&
      indent >= stepsIndent &&
      body.startsWith("-")
    ) {
      flush();
      const rest = body.slice(1);
      const offset = rest.length - rest.trimStart().length;
      step = { contentIndent: indent + 1 + offset };
      assign(step, rest.trim());
      continue;
    }

    if (step !== undefined && indent >= step.contentIndent) {
      if (indent === step.contentIndent) assign(step, body);
      continue;
    }

    flush();
    jobIndent ??= indent;

    if (indent === jobIndent) {
      const entry = keyOf(body);
      job = entry === null ? undefined : { id: entry.key };
      jobBodyIndent = undefined;
      stepsIndent = undefined;
      continue;
    }

    if (job === undefined || indent < jobIndent) continue;
    jobBodyIndent ??= indent;
    if (indent !== jobBodyIndent) continue;
    const entry = keyOf(body);
    if (entry === null) continue;
    if (entry.key === "name") job.name = unquote(entry.value);
    if (entry.key === "steps") stepsIndent = indent;
  }

  flush();
  return steps;
}

/** How many `run:` steps a job declares, keyed by job identifier. */
function countRunSteps(
  steps: readonly WorkflowStep[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const step of steps) {
    counts.set(step.job, (counts.get(step.job) ?? 0) + 1);
  }
  return counts;
}

/**
 * Derive commands from what the repository's CI actually runs.
 *
 * The command is a literal string a maintainer wrote for this repository, so
 * it is more specific evidence than any convention about its ecosystem -- and
 * less specific than what the project declares about itself, which is why this
 * runs after the manifest readers and before the toolchain defaults.
 *
 * A job name answers only for a job that runs a single command: `test` is what
 * the job is for, but in a job of six steps it says nothing about which of
 * them is the test, and `npm ci` under a job named `test` is not the test
 * command.
 */
export function deriveWorkflowCommands(
  workflows: readonly ManifestFile[],
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  for (const workflow of workflows) {
    let steps: readonly WorkflowStep[];
    try {
      steps = readWorkflowSteps(workflow.content);
    } catch {
      // A workflow this reader cannot place is skipped, never fatal.
      continue;
    }
    const runsPerJob = countRunSteps(steps);
    for (const step of steps) {
      const stated = step.name === undefined ? null : slotOfName(step.name);
      const slot =
        stated ??
        (runsPerJob.get(step.job) === 1
          ? slotOfName(step.jobName ?? step.job)
          : null);
      if (slot === null) continue;
      const where =
        step.name === undefined
          ? `job:${step.job}`
          : `job:${step.job}/step:${step.name}`;
      offer(commands, slot, step.run, `${workflow.path}#${where}`);
    }
  }
}

/**
 * Derive commands from a Taskfile's named tasks.
 *
 * The task runner is the command: `task test` is what a maintainer types, and
 * what the task expands to is the runner's business rather than the profile's.
 */
export function deriveTaskfileCommands(
  file: ManifestFile,
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  const names = new Set<string>();
  let tasksIndent: number | undefined;
  let nameIndent: number | undefined;

  for (const line of file.content.split("\n")) {
    if (isIgnorable(line)) continue;
    const indent = indentOf(line);
    const body = line.slice(indent);
    if (tasksIndent === undefined) {
      if (indent === 0 && /^tasks\s*:/u.test(body)) tasksIndent = indent;
      continue;
    }
    if (indent <= tasksIndent) break;
    nameIndent ??= indent;
    if (indent !== nameIndent) continue;
    const entry = keyOf(body);
    if (entry !== null) names.add(entry.key);
  }

  for (const slot of COMMAND_SLOTS) {
    if (!names.has(slot)) continue;
    offer(commands, slot, `task ${slot}`, `${file.path}#tasks.${slot}`);
  }
}

/**
 * Derive commands from a justfile's recipes.
 *
 * A recipe is declared at the left margin and its body is indented, which is
 * the same shape the Makefile reader already relies on.
 */
export function deriveJustfileCommands(
  file: ManifestFile,
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  const names = new Set<string>();

  for (const line of file.content.split("\n")) {
    if (isIgnorable(line)) continue;
    if (indentOf(line) > 0 || line.startsWith("\t")) continue;
    const match = /^@?([a-zA-Z0-9_-]+)(?:\s+[^:]*)?:(?!=)/u.exec(line);
    if (match?.[1] !== undefined) names.add(match[1]);
  }

  for (const slot of COMMAND_SLOTS) {
    if (!names.has(slot)) continue;
    offer(commands, slot, `just ${slot}`, `${file.path}:${slot}`);
  }
}

/**
 * Derive commands from the tasks a mise configuration names.
 *
 * Both spellings state the same thing: a `[tasks.test]` table, or a `test =`
 * entry under `[tasks]`.
 */
export function deriveMiseCommands(
  file: ManifestFile,
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  const names = new Set<string>();
  let inTasks = false;

  for (const line of file.content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      const table = /^\[+\s*([^\]]*?)\s*\]+$/u.exec(trimmed)?.[1];
      inTasks = table === "tasks";
      const named = /^tasks\.["']?([A-Za-z0-9_-]+)["']?$/u.exec(table ?? "");
      if (named?.[1] !== undefined) names.add(named[1]);
      continue;
    }
    if (!inTasks) continue;
    const key = /^["']?([A-Za-z0-9_-]+)["']?\s*=/u.exec(trimmed)?.[1];
    if (key !== undefined) names.add(key);
  }

  for (const slot of COMMAND_SLOTS) {
    if (!names.has(slot)) continue;
    offer(commands, slot, `mise run ${slot}`, `${file.path}#tasks.${slot}`);
  }
}

/** The devcontainer lifecycle keys that can carry named commands. */
const DEVCONTAINER_LIFECYCLE = [
  "onCreateCommand",
  "updateContentCommand",
  "postCreateCommand",
  "postStartCommand",
  "postAttachCommand",
] as const;

/**
 * Derive commands from the named lifecycle commands of a devcontainer.
 *
 * Only the object form is read, because only there does a maintainer give each
 * command a name -- and a name is what this reader attributes from. The string
 * form is one unnamed command whose purpose nothing states.
 */
export function deriveDevcontainerCommands(
  file: ManifestFile,
  commands: Record<string, ProjectProfileLeaf<string>>,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch {
    // A configuration with comments, or none at all, derives nothing.
    return;
  }
  if (typeof parsed !== "object" || parsed === null) return;
  const document = parsed as Record<string, unknown>;

  for (const lifecycle of DEVCONTAINER_LIFECYCLE) {
    const entry = document[lifecycle];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    for (const [name, command] of Object.entries(
      entry as Record<string, unknown>,
    )) {
      if (typeof command !== "string") continue;
      const slot = slotOfName(name);
      if (slot === null) continue;
      offer(commands, slot, command, `${file.path}#${lifecycle}.${name}`);
    }
  }
}
