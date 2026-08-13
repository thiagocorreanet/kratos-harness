import {
  executeManagedMutation,
  prepareLeaseGuard,
} from "@mestre-yoda/runtime/composition";
import type { LeaseGuard } from "@mestre-yoda/runtime/domain/locks";
import { describe, expect, it } from "vitest";

import {
  callerPlan,
  guardedFixture,
  guardedRenewal,
  type GuardedFixture,
} from "./support/lease-guard.js";
import {
  acquireRequest,
  releaseRequest,
  renewRequest,
  takeoverRequest,
} from "./support/lock-contract.js";

const RESOURCE = "run:run-01" as const;
const OWNER_A = "codex:session-01";
const OWNER_B = "codex:session-02";
const DESTINATION = ".brain/runs/run-01/result.json";
const TTL_MS = 30_000;

/**
 * The clock advances by this much before every action.
 *
 * Eleven seconds is chosen so that a lease taken at the first step is writable
 * at the second and third, inside the skew window at the fourth, and eligible
 * for takeover at the fifth. A step that divided the TTL evenly would step over
 * the skew window entirely and leave that state untested.
 */
const STEP_MS = 11_000;
const SKEW_MS = 5_000;

const ACTIONS = [
  "acquire-a",
  "acquire-b",
  "renew-a",
  "release-a",
  "takeover-b",
  "commit-a",
] as const;

type Action = (typeof ACTIONS)[number];

type Outcome =
  | "acquired"
  | "renewed"
  | "released"
  | "taken_over"
  | "conflict"
  | "committed"
  | "refused";

/**
 * What the lease specification says must be true after a sequence of actions,
 * written from the published state rules rather than from the implementation:
 * acquire and takeover increment the fencing token by exactly one, renew and
 * release preserve it, a fresh acquisition starts at one, and only an expired
 * lease past the skew window may be taken over.
 */
interface Model {
  readonly phase: "empty" | "held" | "released";
  readonly owner: string | null;
  readonly token: number;
  readonly expiresAt: number;
}

const EMPTY: Model = {
  phase: "empty",
  owner: null,
  token: 0,
  expiresAt: 0,
};

function timeState(now: number, expiresAt: number) {
  if (now < expiresAt) return "writable" as const;
  return now < expiresAt + SKEW_MS
    ? ("skew" as const)
    : ("takeover_eligible" as const);
}

function step(
  model: Model,
  action: Action,
  now: number,
): { readonly model: Model; readonly outcome: Outcome } {
  const held = model.phase === "held";
  const time = held ? timeState(now, model.expiresAt) : "writable";
  const writableByA = held && model.owner === OWNER_A && time === "writable";
  switch (action) {
    case "acquire-a":
    case "acquire-b": {
      const owner = action === "acquire-a" ? OWNER_A : OWNER_B;
      if (model.phase === "empty") {
        return {
          model: { phase: "held", owner, token: 1, expiresAt: now + TTL_MS },
          outcome: "acquired",
        };
      }
      if (model.phase === "released") {
        return {
          model: {
            phase: "held",
            owner,
            token: model.token + 1,
            expiresAt: now + TTL_MS,
          },
          outcome: "acquired",
        };
      }
      return { model, outcome: "conflict" };
    }
    case "renew-a":
      return writableByA
        ? { model: { ...model, expiresAt: now + TTL_MS }, outcome: "renewed" }
        : { model, outcome: "conflict" };
    case "release-a":
      return writableByA
        ? {
            model: { ...model, phase: "released", expiresAt: now },
            outcome: "released",
          }
        : { model, outcome: "conflict" };
    case "takeover-b":
      // A takeover needs a lease to observe and an expiry the skew window no
      // longer covers. It does not care who held it, only that nobody does.
      return held && time === "takeover_eligible"
        ? {
            model: {
              phase: "held",
              owner: OWNER_B,
              token: model.token + 1,
              expiresAt: now + TTL_MS,
            },
            outcome: "taken_over",
          }
        : { model, outcome: "conflict" };
    case "commit-a":
      // A guarded commit renews under the hood, so it both requires and
      // extends the same authority a plain renewal does.
      return writableByA
        ? { model: { ...model, expiresAt: now + TTL_MS }, outcome: "committed" }
        : { model, outcome: "refused" };
  }
}

/** Whichever guard the runtime would hand worker A after its last success. */
async function currentGuard(
  subject: GuardedFixture,
): Promise<LeaseGuard | null> {
  return (await subject.locks.inspect(RESOURCE)).guard;
}

async function runAction(
  subject: GuardedFixture,
  action: Action,
  guardOfA: LeaseGuard | null,
): Promise<Outcome> {
  switch (action) {
    case "acquire-a":
    case "acquire-b": {
      const outcome = await subject.locks.acquire(
        acquireRequest({
          owner: action === "acquire-a" ? OWNER_A : OWNER_B,
        }),
      );
      return outcome.kind === "acquired" ? "acquired" : "conflict";
    }
    case "renew-a": {
      // Without a prior acquisition there is no guard to renew, and inventing
      // one would test request validation rather than scheduling.
      if (guardOfA === null) return "conflict";
      const outcome = await subject.locks.renew(renewRequest(guardOfA));
      return outcome.kind === "renewed" ? "renewed" : "conflict";
    }
    case "release-a": {
      if (guardOfA === null) return "conflict";
      const outcome = await subject.locks.release(releaseRequest(guardOfA));
      return outcome.kind === "released" ? "released" : "conflict";
    }
    case "takeover-b": {
      // A taker observes the lease it intends to seize; a stale observation is
      // what the renew and commit paths exercise.
      const observed = await currentGuard(subject);
      if (observed === null) return "conflict";
      const outcome = await subject.locks.takeover(
        takeoverRequest(observed, OWNER_B),
      );
      return outcome.kind === "taken_over" ? "taken_over" : "conflict";
    }
    case "commit-a": {
      if (guardOfA === null) return "refused";
      try {
        const binding = await prepareLeaseGuard(
          guardedRenewal(guardOfA),
          subject.services,
        );
        await executeManagedMutation(
          callerPlan(subject.storage),
          { rootMode: "existing", leaseGuard: binding },
          subject.services,
        );
        return "committed";
      } catch {
        return "refused";
      }
    }
  }
}

function permutations<Value>(values: readonly Value[]): (readonly Value[])[] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(
      (rest) => [value, ...rest],
    ),
  );
}

/**
 * Every schedule that opens with an acquisition.
 *
 * A schedule whose leading actions all conflict reaches the same state as the
 * schedule with that prefix removed, so those are redundant rather than
 * unexplored. The complete set stays available behind
 * `YODA_TEST_EXHAUSTIVE_LOCK_SCHEDULES=1` for the same reason the event-chain
 * corpus keeps its wider sweep: coverage that is worth having occasionally is
 * not worth paying for on every push.
 */
const schedules = permutations(ACTIONS).filter(
  (schedule) =>
    process.env.YODA_TEST_EXHAUSTIVE_LOCK_SCHEDULES === "1" ||
    schedule[0] === "acquire-a" ||
    schedule[0] === "acquire-b",
);

describe("lock schedules", () => {
  it("enumerates a deterministic, seed-free corpus", () => {
    expect(permutations(ACTIONS)).toHaveLength(720);
    expect(new Set(schedules.map((schedule) => schedule.join(","))).size).toBe(
      schedules.length,
    );
  });

  it.each(
    schedules.map(
      (schedule) => [schedule.join(" → "), schedule] as [string, Action[]],
    ),
  )("preserves fencing across %s", async (label, schedule) => {
    const subject = guardedFixture();
    let model = EMPTY;
    let guardOfA: LeaseGuard | null = null;
    let now = 0;
    let highestToken = 0;
    let committedAtToken: number | null = null;

    for (const action of schedule) {
      now += STEP_MS;
      subject.advance(STEP_MS);
      const expected = step(model, action, now);
      const where = `${label} @ ${action}`;

      const outcome = await runAction(subject, action, guardOfA);
      expect(outcome, where).toBe(expected.outcome);

      const observation = await subject.locks.inspect(RESOURCE);
      expect(observation.lease?.fencingToken ?? 0, where).toBe(
        expected.model.token,
      );
      // One lease file means one owner; the property worth asserting is that it
      // is the owner the specification predicts, not merely that it is unique.
      expect(observation.lease?.owner ?? null, where).toBe(
        expected.model.owner,
      );
      expect(
        observation.lease?.fencingToken ?? 0,
        where,
      ).toBeGreaterThanOrEqual(highestToken);

      if (outcome === "committed") committedAtToken = expected.model.token;
      // Only worker A's own successes refresh worker A's guard. Refreshing it
      // from whatever the lock currently holds would hand A the authority of
      // the very worker that superseded it.
      if (
        action.endsWith("-a") &&
        outcome !== "conflict" &&
        outcome !== "refused"
      ) {
        guardOfA = await currentGuard(subject);
      }
      highestToken = expected.model.token;
      model = expected.model;
    }

    const files = subject.storage.snapshot().files;
    expect(Object.hasOwn(files, DESTINATION), label).toBe(
      committedAtToken !== null,
    );
    if (committedAtToken !== null) {
      // A published caller effect is whole, and the token it published under
      // was authoritative then and was never superseded downwards after.
      expect(files[DESTINATION], label).toBe("first");
      expect(committedAtToken, label).toBeLessThanOrEqual(highestToken);
    }
  });
});
