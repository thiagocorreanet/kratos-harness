export interface Resolved<T> {
  readonly value: T;
  readonly source: "default" | "project" | "flag";
  readonly ref: string | null;
}

export interface FlagValue<T> {
  readonly value: T;
  readonly ref: string;
}

export interface ConfigurationLayers<T extends object> {
  readonly defaults: Partial<T>;
  readonly project: Partial<T>;
  readonly flags: Partial<{ [K in keyof T]: FlagValue<T[K]> }>;
}

type ResolvedKeys<T extends object, K extends readonly (keyof T & string)[]> = {
  readonly [P in K[number]]: Resolved<T[P]>;
};

function invalid(): never {
  throw new Error("Configuration layers are invalid");
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Apply closed configuration layers while preserving the winning source. */
export function resolveConfigurationLayers<
  T extends object,
  const K extends readonly (keyof T & string)[],
>(keys: K, layers: ConfigurationLayers<T>): ResolvedKeys<T, K> {
  const allowed = new Set<string>(keys);
  for (const layer of [layers.defaults, layers.project, layers.flags]) {
    if (Object.keys(layer).some((key) => !allowed.has(key))) invalid();
  }

  const resolved: Record<string, Resolved<unknown>> = {};
  for (const key of keys) {
    let value: unknown;
    let source: Resolved<unknown>["source"];
    let ref: string | null;

    if (hasOwn(layers.flags, key)) {
      const selected = layers.flags[key];
      if (
        selected?.value === undefined ||
        !/^--[a-z][a-z0-9-]*$/u.test(selected.ref)
      ) {
        invalid();
      }
      value = selected.value;
      source = "flag";
      ref = selected.ref;
    } else if (hasOwn(layers.project, key)) {
      value = layers.project[key];
      if (value === undefined) invalid();
      source = "project";
      ref = ".brain/config.json";
    } else if (hasOwn(layers.defaults, key)) {
      value = layers.defaults[key];
      if (value === undefined) invalid();
      source = "default";
      ref = null;
    } else {
      throw new Error("Configuration layers are incomplete");
    }
    resolved[key] = { value, source, ref };
  }
  return resolved as ResolvedKeys<T, K>;
}
