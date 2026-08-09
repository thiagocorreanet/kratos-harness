import type { ContractId } from "../../domain/schema/index.js";

export interface EmbeddedSchemaEntry {
  readonly id: ContractId;
  readonly family: "state" | "host";
  readonly version: string;
  readonly path: string;
  readonly schema: object;
}
