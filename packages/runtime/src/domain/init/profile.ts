/** A single answer about a project command or convention. */
export type ProjectProfileLeaf<T> =
  | { readonly status: "resolved"; readonly value: T }
  | { readonly status: "not-applicable"; readonly reason: string }
  | { readonly status: "unresolved" };

export interface ResolvedProjectProfile {
  readonly commands: {
    readonly test: ProjectProfileLeaf<string>;
    readonly lint: ProjectProfileLeaf<string>;
    readonly build: ProjectProfileLeaf<string>;
    readonly run: ProjectProfileLeaf<string>;
  };
  readonly paths: {
    readonly source: ProjectProfileLeaf<readonly string[]>;
    readonly tests: ProjectProfileLeaf<readonly string[]>;
    readonly configuration: ProjectProfileLeaf<readonly string[]>;
  };
  readonly conventions: {
    readonly directoryLayout: ProjectProfileLeaf<string>;
    readonly naming: ProjectProfileLeaf<string>;
    readonly implementationLanguages: ProjectProfileLeaf<readonly string[]>;
  };
}

export interface PartialProjectProfile {
  readonly commands?: Partial<ResolvedProjectProfile["commands"]>;
  readonly paths?: Partial<ResolvedProjectProfile["paths"]>;
  readonly conventions?: Partial<ResolvedProjectProfile["conventions"]>;
}

const unresolved = (): ProjectProfileLeaf<never> => ({
  status: "unresolved",
});

/** Return the complete profile used when no project answer has been supplied. */
export function unresolvedProjectProfile(): ResolvedProjectProfile {
  return {
    commands: {
      test: unresolved(),
      lint: unresolved(),
      build: unresolved(),
      run: unresolved(),
    },
    paths: {
      source: unresolved(),
      tests: unresolved(),
      configuration: unresolved(),
    },
    conventions: {
      directoryLayout: unresolved(),
      naming: unresolved(),
      implementationLanguages: unresolved(),
    },
  };
}

/**
 * Resolve each profile leaf without observing the host or filesystem.
 * Explicit answers intentionally include `unresolved`, which clears a
 * persisted answer instead of falling through to it.
 */
export function resolveProjectProfile(
  explicit: PartialProjectProfile | undefined,
  persisted: ResolvedProjectProfile | undefined,
): ResolvedProjectProfile {
  return {
    commands: {
      test: select(explicit?.commands?.test, persisted?.commands.test),
      lint: select(explicit?.commands?.lint, persisted?.commands.lint),
      build: select(explicit?.commands?.build, persisted?.commands.build),
      run: select(explicit?.commands?.run, persisted?.commands.run),
    },
    paths: {
      source: select(explicit?.paths?.source, persisted?.paths.source),
      tests: select(explicit?.paths?.tests, persisted?.paths.tests),
      configuration: select(
        explicit?.paths?.configuration,
        persisted?.paths.configuration,
      ),
    },
    conventions: {
      directoryLayout: select(
        explicit?.conventions?.directoryLayout,
        persisted?.conventions.directoryLayout,
      ),
      naming: select(
        explicit?.conventions?.naming,
        persisted?.conventions.naming,
      ),
      implementationLanguages: select(
        explicit?.conventions?.implementationLanguages,
        persisted?.conventions.implementationLanguages,
      ),
    },
  };
}

/** Return unresolved profile paths in the stable document order. */
export function unresolvedProjectProfileKeys(
  profile: ResolvedProjectProfile,
): readonly string[] {
  const entries: readonly (readonly [string, ProjectProfileLeaf<unknown>])[] = [
    ["projectProfile.commands.test", profile.commands.test],
    ["projectProfile.commands.lint", profile.commands.lint],
    ["projectProfile.commands.build", profile.commands.build],
    ["projectProfile.commands.run", profile.commands.run],
    ["projectProfile.paths.source", profile.paths.source],
    ["projectProfile.paths.tests", profile.paths.tests],
    ["projectProfile.paths.configuration", profile.paths.configuration],
    [
      "projectProfile.conventions.directoryLayout",
      profile.conventions.directoryLayout,
    ],
    ["projectProfile.conventions.naming", profile.conventions.naming],
    [
      "projectProfile.conventions.implementationLanguages",
      profile.conventions.implementationLanguages,
    ],
  ];
  return entries
    .filter(([, leaf]) => leaf.status === "unresolved")
    .map(([key]) => key);
}

function select<T>(
  explicit: ProjectProfileLeaf<T> | undefined,
  persisted: ProjectProfileLeaf<T> | undefined,
): ProjectProfileLeaf<T> {
  return explicit ?? persisted ?? unresolved();
}
