export interface ErrorObject {
  readonly keyword: string;
  readonly instancePath: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export type ValidateFunction = ((value: unknown) => boolean) & {
  errors: readonly ErrorObject[] | null;
};

type JsonSchema = Readonly<Record<string, unknown>>;

function object(value: unknown): JsonSchema | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonSchema)
    : null;
}

function schemaId(schema: JsonSchema): string {
  if (typeof schema.$id !== "string" || schema.$id.length === 0) {
    throw new Error("Schema has no identifier");
  }
  return schema.$id;
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => equal(value, right[index]))
    );
  }
  const leftObject = object(left);
  const rightObject = object(right);
  if (leftObject === null || rightObject === null) return false;
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return (
    equal(leftKeys, rightKeys) &&
    leftKeys.every((key) => equal(leftObject[key], rightObject[key]))
  );
}

function valueType(value: unknown, type: string): boolean {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return object(value) !== null;
    case "string":
      return typeof value === "string";
    default:
      throw new Error(`Unsupported schema type: ${type}`);
  }
}

function resolvePointer(root: JsonSchema, fragment: string): JsonSchema {
  let current: unknown = root;
  for (const encoded of fragment.split("/").slice(1)) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    current = object(current)?.[key];
  }
  const resolved = object(current);
  if (resolved === null) throw new Error("Schema reference is unresolved");
  return resolved;
}

function resolveReference(
  reference: string,
  root: JsonSchema,
  schemas: ReadonlyMap<string, JsonSchema>,
): { readonly root: JsonSchema; readonly schema: JsonSchema } {
  const hash = reference.indexOf("#");
  const identifier = hash < 0 ? reference : reference.slice(0, hash);
  const fragment = hash < 0 ? "" : reference.slice(hash + 1);
  const targetRoot = identifier === "" ? root : schemas.get(identifier);
  if (targetRoot === undefined) throw new Error("Schema reference is unknown");
  return {
    root: targetRoot,
    schema: fragment === "" ? targetRoot : resolvePointer(targetRoot, fragment),
  };
}

function addError(
  errors: ErrorObject[],
  keyword: string,
  instancePath: string,
  params: Readonly<Record<string, unknown>> = {},
): void {
  errors.push({ keyword, instancePath, params });
}

function validateSchema(
  schema: JsonSchema,
  value: unknown,
  instancePath: string,
  root: JsonSchema,
  schemas: ReadonlyMap<string, JsonSchema>,
  errors: ErrorObject[],
): boolean {
  const initial = errors.length;
  if (typeof schema.$ref === "string") {
    const resolved = resolveReference(schema.$ref, root, schemas);
    validateSchema(
      resolved.schema,
      value,
      instancePath,
      resolved.root,
      schemas,
      errors,
    );
    return errors.length === initial;
  }

  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : null;
  if (oneOf !== null) {
    let matches = 0;
    for (const candidate of oneOf) {
      const candidateSchema = object(candidate);
      if (candidateSchema === null) throw new Error("Invalid oneOf schema");
      const candidateErrors: ErrorObject[] = [];
      validateSchema(
        candidateSchema,
        value,
        instancePath,
        root,
        schemas,
        candidateErrors,
      );
      if (candidateErrors.length === 0) matches += 1;
    }
    if (matches !== 1) addError(errors, "oneOf", instancePath);
  }

  if (Array.isArray(schema.allOf)) {
    for (const candidate of schema.allOf) {
      const candidateSchema = object(candidate);
      if (candidateSchema === null) throw new Error("Invalid allOf schema");
      validateSchema(
        candidateSchema,
        value,
        instancePath,
        root,
        schemas,
        errors,
      );
    }
  }

  const condition = object(schema.if);
  if (condition !== null) {
    const conditionErrors: ErrorObject[] = [];
    validateSchema(
      condition,
      value,
      instancePath,
      root,
      schemas,
      conditionErrors,
    );
    const branch = object(
      conditionErrors.length === 0 ? schema.then : schema.else,
    );
    if (branch !== null) {
      validateSchema(branch, value, instancePath, root, schemas, errors);
    }
  }

  if (typeof schema.type === "string" && !valueType(value, schema.type)) {
    addError(errors, "type", instancePath);
    return false;
  }
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter(
      (candidate): candidate is string => typeof candidate === "string",
    );
    if (types.length !== schema.type.length)
      throw new Error("Invalid type list");
    if (!types.some((type) => valueType(value, type))) {
      addError(errors, "type", instancePath);
      return false;
    }
  }

  if ("const" in schema && !equal(value, schema.const)) {
    addError(errors, "const", instancePath);
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => equal(candidate, value))
  ) {
    addError(errors, "enum", instancePath);
  }

  if (typeof value === "string") {
    const length = Array.from(value).length;
    if (typeof schema.minLength === "number" && length < schema.minLength) {
      addError(errors, "minLength", instancePath);
    }
    if (typeof schema.maxLength === "number" && length > schema.maxLength) {
      addError(errors, "maxLength", instancePath);
    }
    if (typeof schema.pattern === "string") {
      const pattern = new RegExp(schema.pattern, "u");
      if (!pattern.test(value)) addError(errors, "pattern", instancePath);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      addError(errors, "minimum", instancePath);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      addError(errors, "maximum", instancePath);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      addError(errors, "minItems", instancePath);
    }
    if (
      schema.uniqueItems === true &&
      value.some((item, index) =>
        value.slice(0, index).some((other) => equal(item, other)),
      )
    ) {
      addError(errors, "uniqueItems", instancePath);
    }
    const itemSchema = object(schema.items);
    if (itemSchema !== null) {
      value.forEach((item, index) =>
        validateSchema(
          itemSchema,
          item,
          `${instancePath}/${String(index)}`,
          root,
          schemas,
          errors,
        ),
      );
    }
  }

  const record = object(value);
  if (record !== null) {
    const properties = object(schema.properties) ?? {};
    if (Array.isArray(schema.required)) {
      for (const property of schema.required) {
        if (typeof property !== "string")
          throw new Error("Invalid requirement");
        if (!Object.hasOwn(record, property)) {
          addError(errors, "required", instancePath, {
            missingProperty: property,
          });
        }
      }
    }
    for (const [property, propertySchemaValue] of Object.entries(properties)) {
      if (!Object.hasOwn(record, property)) continue;
      const propertySchema = object(propertySchemaValue);
      if (propertySchema === null) throw new Error("Invalid property schema");
      validateSchema(
        propertySchema,
        record[property],
        `${instancePath}/${pointerSegment(property)}`,
        root,
        schemas,
        errors,
      );
    }
    const unknown = Object.keys(record).filter(
      (property) => !Object.hasOwn(properties, property),
    );
    if (schema.additionalProperties === false) {
      for (const property of unknown) {
        addError(errors, "additionalProperties", instancePath, {
          additionalProperty: property,
        });
      }
    } else {
      const additionalSchema = object(schema.additionalProperties);
      if (additionalSchema !== null) {
        for (const property of unknown) {
          validateSchema(
            additionalSchema,
            record[property],
            `${instancePath}/${pointerSegment(property)}`,
            root,
            schemas,
            errors,
          );
        }
      }
    }
  }

  return errors.length === initial;
}

/** Dependency-free JSON Schema subset used only by the offline plugin build. */
export class Ajv2020 {
  readonly #schemas = new Map<string, JsonSchema>();

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor, @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function -- the options parameter exists only for `ajv` constructor parity; this offline subset honours none of them
  public constructor(_options: Readonly<Record<string, unknown>> = {}) {}

  public addSchema(value: object): void {
    const schema = object(value);
    if (schema === null) throw new Error("Schema must be an object");
    const id = schemaId(schema);
    if (this.#schemas.has(id)) throw new Error("Duplicate schema identifier");
    this.#schemas.set(id, schema);
  }

  public getSchema(id: string): ValidateFunction | undefined {
    const schema = this.#schemas.get(id);
    if (schema === undefined) return undefined;
    const validate = ((value: unknown): boolean => {
      const errors: ErrorObject[] = [];
      validateSchema(schema, value, "", schema, this.#schemas, errors);
      validate.errors = errors.length === 0 ? null : errors;
      return errors.length === 0;
    }) as ValidateFunction;
    validate.errors = null;
    return validate;
  }
}
