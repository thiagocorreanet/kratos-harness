import type {
  Clock,
  Environment,
  FileSystem,
  Git,
  Ids,
  ModelRouting,
  Output,
} from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import { compareGitPaths } from "../../packages/runtime/src/domain/git/index.js";

/**
 * Behavior every implementation of a port must share.
 *
 * A port with two implementations has two chances to disagree, so the suite
 * that proves the Node implementation is the same suite run against the fake.
 * A fake that quietly diverges fails here rather than letting in-memory tests
 * pass while the real runtime misbehaves.
 */

export interface Disposable<T> {
  readonly port: T;
  // A function property rather than a method, so destructuring it does not
  // detach a `this` the implementation might have needed.
  readonly dispose: () => Promise<void>;
}

export function describeClockContract(
  label: string,
  factory: () => Clock,
): void {
  describe(`Clock contract: ${label}`, () => {
    it("returns a valid instant", () => {
      expect(Number.isNaN(factory().now().getTime())).toBe(false);
    });

    it("does not hand out a mutable shared instant", () => {
      const clock = factory();
      const first = clock.now();
      first.setFullYear(1990);
      expect(clock.now().getFullYear()).not.toBe(1990);
    });
  });
}

export function describeIdsContract(label: string, factory: () => Ids): void {
  describe(`Ids contract: ${label}`, () => {
    it("never repeats within one provider", () => {
      const ids = factory();
      const produced = Array.from({ length: 100 }, () => ids.next());
      expect(new Set(produced).size).toBe(100);
    });

    it("produces safe opaque identifiers", () => {
      expect(factory().next()).toMatch(/^[A-Za-z0-9_-]{1,64}$/u);
    });
  });
}

export function describeFileSystemContract(
  label: string,
  factory: () => Promise<Disposable<FileSystem>>,
): void {
  describe(`FileSystem contract: ${label}`, () => {
    async function withFileSystem(
      body: (fileSystem: FileSystem) => Promise<void>,
    ): Promise<void> {
      const { port, dispose } = await factory();
      try {
        await body(port);
      } finally {
        await dispose();
      }
    }

    it("round-trips a written file", async () => {
      await withFileSystem(async (fileSystem) => {
        await fileSystem.write("a.txt", "hello");
        expect(await fileSystem.read("a.txt")).toBe("hello");
        expect(await fileSystem.stat("a.txt")).toEqual({
          kind: "file",
          size: 5,
        });
      });
    });

    it("creates parent directories for a nested write", async () => {
      await withFileSystem(async (fileSystem) => {
        await fileSystem.write("nested/deep/a.txt", "x");
        expect(await fileSystem.read("nested/deep/a.txt")).toBe("x");
        expect((await fileSystem.stat("nested"))?.kind).toBe("directory");
      });
    });

    it("reports a missing path as null rather than throwing", async () => {
      await withFileSystem(async (fileSystem) => {
        expect(await fileSystem.stat("missing.txt")).toBeNull();
      });
    });

    it("rejects reading a missing file", async () => {
      await withFileSystem(async (fileSystem) => {
        await expect(fileSystem.read("missing.txt")).rejects.toThrow();
      });
    });

    it("lists entries in sorted order", async () => {
      await withFileSystem(async (fileSystem) => {
        await fileSystem.write("b.txt", "b");
        await fileSystem.write("a.txt", "a");
        await fileSystem.makeDirectory("c");
        expect(await fileSystem.list(".")).toEqual(["a.txt", "b.txt", "c"]);
      });
    });

    it("overwrites an existing file", async () => {
      await withFileSystem(async (fileSystem) => {
        await fileSystem.write("a.txt", "first");
        await fileSystem.write("a.txt", "second");
        expect(await fileSystem.read("a.txt")).toBe("second");
      });
    });

    it("removes a file and forgets it", async () => {
      await withFileSystem(async (fileSystem) => {
        await fileSystem.write("a.txt", "a");
        await fileSystem.remove("a.txt");
        expect(await fileSystem.stat("a.txt")).toBeNull();
      });
    });

    it("reports size in bytes, not UTF-16 code units", async () => {
      await withFileSystem(async (fileSystem) => {
        await fileSystem.write("accented.txt", "héllo");
        // "héllo" is 5 code units but 6 UTF-8 bytes. Any policy that budgets or
        // compares by size would pass in memory and misbehave on disk if the
        // two disagreed here.
        expect((await fileSystem.stat("accented.txt"))?.size).toBe(6);
      });
    });

    it("removes a directory", async () => {
      await withFileSystem(async (fileSystem) => {
        await fileSystem.makeDirectory("gone");
        await fileSystem.remove("gone");
        expect(await fileSystem.stat("gone")).toBeNull();
      });
    });

    it("returns an empty listing when there is nothing to enumerate", async () => {
      await withFileSystem(async (fileSystem) => {
        // Nothing to list is an empty listing, not an error. Both
        // implementations must agree on this, or a caller enumerating state
        // would behave differently in memory than on disk.
        expect(await fileSystem.list("missing-directory")).toEqual([]);
        await fileSystem.write("a-file.txt", "x");
        expect(await fileSystem.list("a-file.txt")).toEqual([]);
      });
    });

    it("makes a directory idempotently", async () => {
      await withFileSystem(async (fileSystem) => {
        await fileSystem.makeDirectory("d");
        await fileSystem.makeDirectory("d");
        expect((await fileSystem.stat("d"))?.kind).toBe("directory");
      });
    });

    it.each([
      "../escape.txt",
      "/absolute.txt",
      "a/../../escape.txt",
      "",
      "C:/win.txt",
      "a\\b.txt",
      "a\u0000b.txt",
      "a\nb.txt",
    ])("refuses the unsafe path %j", async (path) => {
      await withFileSystem(async (fileSystem) => {
        await expect(fileSystem.write(path, "x")).rejects.toThrow(
          "escapes the project",
        );
      });
    });
  });
}

/**
 * Properties every `Git.observe()` implementation must satisfy, whether the
 * repository is real or faked. The classification semantics themselves --
 * which state maps to which `kind`, how a change is parsed -- are `RUN-08`'s
 * own suite (`tests/git-observation.test.ts`, `tests/git-scenarios.test.ts`);
 * what is shared here is only what both implementations must already agree
 * on regardless of the repository observed.
 */
export function describeGitContract(
  label: string,
  factory: () => Promise<Disposable<Git>>,
): void {
  describe(`Git contract: ${label}`, () => {
    it("returns a kind from the closed set", async () => {
      const { port, dispose } = await factory();
      try {
        expect([
          "observed",
          "git_absent",
          "not_a_repository",
          "timeout",
          "command_failed",
          "unreadable",
        ]).toContain((await port.observe()).kind);
      } finally {
        await dispose();
      }
    });

    it("resolves rather than rejecting", async () => {
      const { port, dispose } = await factory();
      try {
        await expect(port.observe()).resolves.toBeDefined();
      } finally {
        await dispose();
      }
    });

    it("carries evidence that never contains output bytes", async () => {
      const { port, dispose } = await factory();
      try {
        for (const record of (await port.observe()).evidence) {
          expect(Object.keys(record).sort()).toEqual([
            "argv",
            "exitCode",
            "outcome",
            "stderrBytes",
            "stderrSha256",
            "stdoutBytes",
            "stdoutSha256",
          ]);
        }
      } finally {
        await dispose();
      }
    });

    it("returns changes sorted by path bytes", async () => {
      const { port, dispose } = await factory();
      try {
        const observation = await port.observe();
        if (observation.kind !== "observed") return;
        const paths = observation.repository.changes.map(
          (change) => change.path,
        );

        expect([...paths]).toEqual([...paths].sort(compareGitPaths));
      } finally {
        await dispose();
      }
    });

    it("observes the same repository equally twice", async () => {
      const { port, dispose } = await factory();
      try {
        expect(await port.observe()).toEqual(await port.observe());
      } finally {
        await dispose();
      }
    });
  });
}

export function describeEnvironmentContract(
  label: string,
  factory: () => Environment,
): void {
  describe(`Environment contract: ${label}`, () => {
    it("returns undefined for an unset variable", () => {
      expect(factory().get("KRATOS_DEFINITELY_UNSET_VARIABLE")).toBeUndefined();
    });

    it("returns a non-empty working directory", () => {
      expect(factory().workingDirectory().length).toBeGreaterThan(0);
    });
  });
}

export function describeOutputContract(
  label: string,
  factory: () => Output,
): void {
  describe(`Output contract: ${label}`, () => {
    it("accepts both channels without throwing", () => {
      const output = factory();
      expect(() => {
        output.structured("{}\n");
        output.human("ok\n");
      }).not.toThrow();
    });
  });
}

/**
 * A model catalog is an observation, never a routing command. Its narrow
 * surface prevents a host integration from acquiring project-write authority.
 */
export function describeModelRoutingContract(
  label: string,
  factory: () => ModelRouting,
): void {
  describe(`ModelRouting contract: ${label}`, () => {
    it("returns null when no catalog was supplied for a host", async () => {
      expect(await factory().observe("claude")).toBeNull();
    });

    it("exposes observation only", () => {
      expect(Object.keys(factory()).sort()).toEqual(["observe"]);
    });
  });
}
