import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import { isObjectPrototypeEnvironmentSafe } from "../packages/runtime/src/infra/schema/prototype-environment.js";

const intrinsic = () => undefined;

afterEach(() => {
  vi.doUnmock("node:vm");
  vi.resetModules();
});

async function expectRejectedTrustedRealm(value: unknown): Promise<void> {
  vi.resetModules();
  vi.doMock("node:vm", () => ({ runInNewContext: () => value }));
  const environment =
    await import("../packages/runtime/src/infra/schema/prototype-environment.js");

  expect(environment.isObjectPrototypeEnvironmentSafe()).toBe(false);
  expect(() => {
    environment.assertObjectPrototypeEnvironmentSafe();
  }).toThrow(new Error("Embedded schema registry is invalid"));
}

describe("schema intrinsic environment", () => {
  it.each([
    ["a non-object result", null],
    ["the wrong tuple length", []],
    [
      "a null object prototype",
      [null, intrinsic, intrinsic, intrinsic, intrinsic],
    ],
    [
      "a non-callable function prototype",
      [{}, null, intrinsic, intrinsic, intrinsic],
    ],
    [
      "a non-callable function call",
      [{}, intrinsic, null, intrinsic, intrinsic],
    ],
    ["a non-callable toString", [{}, intrinsic, intrinsic, null, intrinsic]],
    ["a non-callable Array", [{}, intrinsic, intrinsic, intrinsic, null]],
    [
      "a proxied function prototype",
      [{}, new Proxy(intrinsic, {}), intrinsic, intrinsic, intrinsic],
    ],
    [
      "a proxied function call",
      [{}, intrinsic, new Proxy(intrinsic, {}), intrinsic, intrinsic],
    ],
    [
      "a proxied toString",
      [{}, intrinsic, intrinsic, new Proxy(intrinsic, {}), intrinsic],
    ],
    [
      "a proxied Array",
      [{}, intrinsic, intrinsic, intrinsic, new Proxy(intrinsic, {})],
    ],
  ] as const)("rejects %s from the trusted realm", async (_name, value) => {
    await expectRejectedTrustedRealm(value);
  });

  it("sanitizes a trusted-realm construction failure", async () => {
    vi.resetModules();
    vi.doMock("node:vm", () => ({
      runInNewContext() {
        throw new Error("attacker-controlled vm failure");
      },
    }));
    const environment =
      await import("../packages/runtime/src/infra/schema/prototype-environment.js");

    expect(environment.isObjectPrototypeEnvironmentSafe()).toBe(false);
    expect(() => {
      environment.assertObjectPrototypeEnvironmentSafe();
    }).toThrow(new Error("Embedded schema registry is invalid"));
  });

  it("rejects an accessor-backed Function.prototype.call without invoking it", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Function.prototype,
      "call",
    );
    let calls = 0;
    let safe: boolean;
    Object.defineProperty(Function.prototype, "call", {
      configurable: true,
      get() {
        calls += 1;
        return intrinsic;
      },
    });
    try {
      safe = isObjectPrototypeEnvironmentSafe();
    } finally {
      if (descriptor !== undefined)
        Object.defineProperty(Function.prototype, "call", descriptor);
    }

    expect(calls).toBe(0);
    expect(safe).toBe(false);
  });

  it("rejects a missing Function.prototype.call", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Function.prototype,
      "call",
    );
    Reflect.deleteProperty(Function.prototype, "call");
    let safe: boolean;
    try {
      safe = isObjectPrototypeEnvironmentSafe();
    } finally {
      if (descriptor !== undefined)
        Object.defineProperty(Function.prototype, "call", descriptor);
    }

    expect(safe).toBe(false);
  });

  it("fails closed when reflection throws during comparison", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Reflect, "ownKeys");
    Object.defineProperty(Reflect, "ownKeys", {
      configurable: true,
      value() {
        throw new Error("attacker-controlled reflection failure");
      },
      writable: true,
    });
    let safe: boolean;
    try {
      safe = isObjectPrototypeEnvironmentSafe();
    } finally {
      if (descriptor !== undefined)
        Object.defineProperty(Reflect, "ownKeys", descriptor);
    }

    expect(safe).toBe(false);
  });

  it.each([
    ["a value of another type", 7],
    ["a proxied callable", new Proxy(Array.from, {})],
  ] as const)("rejects %s in an intrinsic data property", (_name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(Array, "from");
    Object.defineProperty(Array, "from", {
      ...descriptor,
      value,
    });
    let safe: boolean;
    try {
      safe = isObjectPrototypeEnvironmentSafe();
    } finally {
      if (descriptor !== undefined)
        Object.defineProperty(Array, "from", descriptor);
    }

    expect(safe).toBe(false);
  });

  it("rejects an intrinsic descriptor with changed flags", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array, "from");
    Object.defineProperty(Array, "from", {
      ...descriptor,
      enumerable: descriptor?.enumerable !== true,
    });
    let safe: boolean;
    try {
      safe = isObjectPrototypeEnvironmentSafe();
    } finally {
      if (descriptor !== undefined)
        Object.defineProperty(Array, "from", descriptor);
    }

    expect(safe).toBe(false);
  });

  it("rejects an accessor replacing an intrinsic data property without invoking it", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array, "from");
    let calls = 0;
    Object.defineProperty(Array, "from", {
      configurable: true,
      get() {
        calls += 1;
        return intrinsic;
      },
    });
    let safe: boolean;
    try {
      safe = isObjectPrototypeEnvironmentSafe();
    } finally {
      if (descriptor !== undefined)
        Object.defineProperty(Array, "from", descriptor);
    }

    expect(calls).toBe(0);
    expect(safe).toBe(false);
  });

  it("rejects a different intrinsic key with the same key count", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array, "from");
    Reflect.deleteProperty(Array, "from");
    Object.defineProperty(Array, "attackerFrom", descriptor ?? {});
    let safe: boolean;
    try {
      safe = isObjectPrototypeEnvironmentSafe();
    } finally {
      Reflect.deleteProperty(Array, "attackerFrom");
      if (descriptor !== undefined)
        Object.defineProperty(Array, "from", descriptor);
    }

    expect(safe).toBe(false);
  });

  it("rejects a proxied intrinsic object", () => {
    const prototype = Object.getPrototypeOf(Array.prototype) as object;
    Object.setPrototypeOf(Array.prototype, new Proxy(prototype, {}));
    let safe: boolean;
    try {
      safe = isObjectPrototypeEnvironmentSafe();
    } finally {
      Object.setPrototypeOf(Array.prototype, prototype);
    }

    expect(safe).toBe(false);
  });

  it("rejects a broken intrinsic alias", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    );
    const foreignValues = runInNewContext("Array.prototype.values") as unknown;
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      ...descriptor,
      value: foreignValues,
    });
    let safe: boolean;
    try {
      safe = isObjectPrototypeEnvironmentSafe();
    } finally {
      if (descriptor !== undefined)
        Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
    }

    expect(safe).toBe(false);
  });
});
