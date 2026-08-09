import type { CSSProperties, ReactNode } from "react";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type UnitName =
  | "none"
  | "millimeters"
  | "degrees"
  | "millimeters_per_second";

/**
 * serde's internally-tagged enum produces `{ type: "millimeters" }`.
 * A plain string is accepted too, which is convenient for hand-authored schemas.
 */
export type UnitSchema = UnitName | { type: UnitName };
export type TeamName = "own" | "opp" | "both";
export type TeamSchema = TeamName | { type: TeamName };

export interface NumberSchema {
  unit: UnitSchema;
  min: number | null;
  max: number | null;
}

export interface Vec2Schema {
  unit: UnitSchema;
}

export interface EnumOption {
  label: string;
  value: string;
}

export interface EnumSchema {
  options: EnumOption[];
}

export interface ListSchema {
  item: FieldType;
}

export type FieldType =
  | { type: "bool" }
  | { type: "float"; options: NumberSchema }
  | { type: "u32"; options: NumberSchema }
  | { type: "vec2"; options: Vec2Schema }
  | { type: "enum"; options: EnumSchema }
  | { type: "list"; options: ListSchema }
  | { type: "object"; options: ObjectSchema }
  | { type: "robot"; options: TeamSchema };

export interface FieldSchema {
  key: string;
  label: string;
  ty: FieldType;
  /**
   * Optional UI metadata. Rust ignores this today, but services may enrich the
   * serialized schema before sending it to the renderer.
   */
  description?: string;
  placeholder?: string;
}

export interface ObjectSchema {
  name: string;
  fields: FieldSchema[];
}

export interface RendererMode {
  id: string;
  label: string;
  description?: string;
  icon?: "pulse";
}

export interface FormSection {
  id: string;
  title: string;
  description?: string;
  schema: ObjectSchema;
  initialValue?: JsonObject;
}

export interface FormPart {
  kind: "form";
  id: string;
  title: string;
  description?: string;
  eyebrow?: string;
  sections: FormSection[];
  status?: string;
}

export interface RegistryEntry {
  id: string;
  label: string;
  description?: string;
  badge?: string;
  source: PartSource;
}

export interface RegistryPart {
  kind: "registry";
  id: string;
  title: string;
  description?: string;
  entries: RegistryEntry[];
  initialEntryId?: string;
}

export interface EmptyPart {
  kind: "empty";
  id: string;
  title: string;
  description?: string;
}

export type SchemaPart = FormPart | RegistryPart | EmptyPart;

export type PartSource =
  | { kind: "inline"; part: SchemaPart }
  | { kind: "deferred"; key: string };

export interface RendererTab {
  id: string;
  label: string;
  description?: string;
  badge?: string;
  icon?: "playbook" | "bolt" | "analysis" | "schema";
  source: PartSource;
}

export interface RendererSchema {
  id: string;
  title: string;
  description?: string;
  modes?: RendererMode[];
  initialModeId?: string;
  tabs: RendererTab[];
  initialTabId?: string;
}

export interface PartLoadContext {
  documentId: string;
  tabId: string;
  modeId?: string;
  parentPartId?: string;
  entryId?: string;
  signal: AbortSignal;
}

export type PartLoader = (
  key: string,
  context: PartLoadContext,
) => Promise<SchemaPart>;

export interface RobotOption {
  value: string | number;
  label: string;
  team?: Exclude<TeamName, "both">;
  detail?: string;
}

/**
 * Values are keyed by form part id and then section id. This keeps values
 * stable while the user moves through tabs or while registry schemas unload.
 */
export type RendererValues = Record<string, Record<string, JsonObject>>;

export interface ValueChangeDetail {
  partId: string;
  sectionId: string;
  fieldPath: string[];
  value: JsonValue;
}

export interface SchemaRendererClassNames {
  root: string;
  header: string;
  modes: string;
  tabs: string;
  body: string;
  registry: string;
  form: string;
  section: string;
  field: string;
  footer: string;
}

export interface SchemaRendererProps {
  schema: RendererSchema;
  values?: RendererValues;
  defaultValues?: RendererValues;
  onValuesChange?: (
    values: RendererValues,
    detail: ValueChangeDetail,
  ) => void;
  modeId?: string;
  defaultModeId?: string;
  onModeChange?: (modeId: string) => void;
  tabId?: string;
  defaultTabId?: string;
  onTabChange?: (tabId: string) => void;
  onRegistryEntryChange?: (registryId: string, entryId: string) => void;
  loadPart?: PartLoader;
  /**
   * Increment or replace this value to refetch the currently visible deferred
   * schema parts. Changing `schema` itself also updates the navigation.
   */
  schemaRevision?: string | number;
  robots?: RobotOption[];
  disabled?: boolean;
  theme?: "simhark" | "interfaabs";
  density?: "comfortable" | "compact";
  className?: string;
  classNames?: Partial<SchemaRendererClassNames>;
  style?: CSSProperties;
  renderFooter?: (context: {
    activeTab: RendererTab;
    modeId?: string;
    values: RendererValues;
  }) => ReactNode;
}
