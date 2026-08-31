import type { EventV1, EventV1_1, EventV1_2 } from "@kratos/contracts";
import type { EventDraftV1 } from "@kratos/runtime/domain/events";
import { describe, expectTypeOf, it } from "vitest";

type EventV1Draft = Omit<EventV1, "previousHash" | "eventHash">;
type EventV1_1Draft = Omit<EventV1_1, "previousHash" | "eventHash">;
type EventV1_2Draft = Omit<EventV1_2, "previousHash" | "eventHash">;

describe("event draft type boundary", () => {
  it("accepts unsealed drafts for every readable event revision", () => {
    expectTypeOf<EventV1Draft>().toExtend<EventDraftV1>();
    expectTypeOf<EventV1_1Draft>().toExtend<EventDraftV1>();
    expectTypeOf<EventV1_2Draft>().toExtend<EventDraftV1>();
  });

  it("rejects sealed events for every readable event revision", () => {
    expectTypeOf<EventV1>().not.toExtend<EventDraftV1>();
    expectTypeOf<EventV1_1>().not.toExtend<EventDraftV1>();
    expectTypeOf<EventV1_2>().not.toExtend<EventDraftV1>();
  });
});
