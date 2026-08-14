import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bundleLockWorker,
  disposeLockWorker,
  runWorker,
  temporaryProject,
} from "./support/lock-workers.js";

const instant = "2026-08-11T00:00:00.000Z";
const expiry = "2026-08-11T00:00:30.000Z";
const contenders = 8;
const rounds = 4;
const testTimeoutMilliseconds = 120_000;

interface Conflict {
  readonly owner: string;
  readonly resource: string;
  readonly expiresAt: string;
  readonly retryable: boolean;
  readonly recovery: string;
}

interface Outcome {
  readonly kind: string;
  readonly conflict?: Conflict;
  readonly evidence?: readonly string[];
  readonly lease?: { readonly owner: string; readonly fencingToken: number };
}

interface Round {
  readonly outcomes: readonly Outcome[];
  readonly output: string;
  readonly root: string;
}

function acquisition(index: number, resource: string): unknown {
  return {
    idPrefix: `worker-${String(index)}`,
    now: instant,
    owner: `codex:worker-${String(index)}`,
    resource,
    stateRevision: 0,
    ttlMs: 30_000,
  };
}

/** One round of simultaneous acquisitions of the same resource. */
async function contend(resource: string): Promise<Round> {
  return await temporaryProject(async (root) => {
    const results = await Promise.all(
      Array.from(
        { length: contenders },
        async (_unused, index) =>
          await runWorker("acquire", root, acquisition(index, resource)),
      ),
    );
    return {
      outcomes: results.map(({ value }) => value as Outcome),
      output: results.map(({ output }) => output).join(""),
      root,
    };
  });
}

async function contendRepeatedly(resource: string): Promise<readonly Round[]> {
  const collected: Round[] = [];
  for (let round = 0; round < rounds; round += 1) {
    collected.push(await contend(resource));
  }
  return collected;
}

beforeAll(async () => {
  await bundleLockWorker();
});

afterAll(async () => {
  await disposeLockWorker();
});

describe("lock admission under real process contention", () => {
  it(
    "never admits two contenders to the same resource",
    async () => {
      const played = await contendRepeatedly("run:run-01");
      for (const { outcomes } of played) {
        const acquired = outcomes.filter(({ kind }) => kind === "acquired");
        expect(acquired.length).toBeLessThanOrEqual(1);
        // A winner opens exactly one fencing epoch. A second acquisition over
        // the same empty history would also open token 1, so the token is what
        // proves the exclusion rather than the count on its own.
        for (const outcome of acquired)
          expect(outcome.lease?.fencingToken).toBe(1);
      }
      // Rounds where nobody wins are a liveness gap this suite records rather
      // than tolerates silently; issue #99 leaves the admission re-election
      // that closes it undone.
      expect(
        played.filter(({ outcomes }) =>
          outcomes.some(({ kind }) => kind === "acquired"),
        ).length,
      ).toBeGreaterThan(0);
    },
    testTimeoutMilliseconds,
  );

  it(
    "never reports a concurrent publisher as corrupt state",
    async () => {
      // `RUN-07` shipped with losing contenders receiving
      // `runtime.state_corrupt` naming another worker's in-flight candidate
      // directory. Nothing a sibling does inside the protocol may be reported
      // as damage.
      const played = await contendRepeatedly("run:run-01");
      expect(
        played.flatMap(({ outcomes }) =>
          outcomes.filter(({ kind }) => kind === "corrupt"),
        ),
      ).toEqual([]);
    },
    testTimeoutMilliseconds,
  );

  it(
    "refuses losing contenders with a complete, actionable conflict",
    async () => {
      const played = await contendRepeatedly("run:run-01");
      const conflicts = played.flatMap(({ outcomes }) =>
        outcomes.filter(({ kind }) => kind === "conflict"),
      );
      expect(conflicts.length).toBeGreaterThan(0);
      for (const outcome of conflicts) {
        const conflict = outcome.conflict;
        // Owner, scope, expiry, retryability, and the safe next action, with
        // nothing else and nothing missing.
        expect(Object.keys(conflict ?? {}).sort()).toEqual([
          "expiresAt",
          "owner",
          "recovery",
          "resource",
          "retryable",
        ]);
        expect(conflict?.owner).toMatch(/^codex:worker-\d$/u);
        expect(conflict?.expiresAt).toBe(expiry);
        expect(conflict?.retryable).toBe(true);
        expect(conflict?.recovery).toBe("wait_or_takeover");
      }
    },
    testTimeoutMilliseconds,
  );

  it(
    "keeps worker output silent and evidence free of the project root",
    async () => {
      const played = await contendRepeatedly("run:run-01");
      for (const { outcomes, output, root } of played) {
        // Anything printed would be port text or a project path escaping into
        // a channel the protocol does not control.
        expect(output).toBe("");
        expect(JSON.stringify(outcomes)).not.toContain(root);
        for (const outcome of outcomes) {
          for (const ref of outcome.evidence ?? []) {
            expect(ref).toMatch(/^\.brain\/(locks|transactions)\//u);
          }
        }
      }
    },
    testTimeoutMilliseconds,
  );
});
