import { expect, it } from "vitest";

it("triggers the intentional CI unit-test failure", () => {
  expect("observed").toBe("expected");
});
