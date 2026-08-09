import type {
  FieldType,
  JsonObject,
  JsonValue,
  ObjectSchema,
  RendererValues,
  TeamName,
  TeamSchema,
  UnitName,
  UnitSchema,
} from "./types";

export function unitName(unit: UnitSchema): UnitName {
  return typeof unit === "string" ? unit : unit.type;
}

export function teamName(team: TeamSchema): TeamName {
  return typeof team === "string" ? team : team.type;
}

export function unitLabel(unit: UnitSchema): string {
  switch (unitName(unit)) {
    case "millimeters":
      return "mm";
    case "degrees":
      return "°";
    case "millimeters_per_second":
      return "mm/s";
    default:
      return "";
  }
}

export function defaultValueForType(type: FieldType): JsonValue {
  switch (type.type) {
    case "bool":
      return false;
    case "float":
    case "u32":
      return type.options.min ?? 0;
    case "vec2":
      return { x: 0, y: 0 };
    case "enum":
      return type.options.options[0]?.value ?? "";
    case "robot":
      return "R0";
    case "object":
      return defaultValueForObject(type.options);
    case "list":
      return [];
  }
}

export function defaultValueForObject(schema: ObjectSchema): JsonObject {
  return Object.fromEntries(
    schema.fields.map((field) => [
      field.key,
      defaultValueForType(field.ty),
    ]),
  );
}

export function mergeObjectDefaults(
  schema: ObjectSchema,
  value?: JsonObject,
  initialValue?: JsonObject,
): JsonObject {
  return {
    ...defaultValueForObject(schema),
    ...initialValue,
    ...value,
  };
}

export function updateObjectPath(
  object: JsonObject,
  path: string[],
  value: JsonValue,
): JsonObject {
  if (path.length === 0) {
    return object;
  }

  const [head, ...tail] = path;
  if (tail.length === 0) {
    return { ...object, [head]: value };
  }

  const child = object[head];
  const childObject =
    child && typeof child === "object" && !Array.isArray(child)
      ? (child as JsonObject)
      : {};

  return {
    ...object,
    [head]: updateObjectPath(childObject, tail, value),
  };
}

export function sectionValue(
  values: RendererValues,
  partId: string,
  sectionId: string,
  schema: ObjectSchema,
  initialValue?: JsonObject,
): JsonObject {
  return mergeObjectDefaults(
    schema,
    values[partId]?.[sectionId],
    initialValue,
  );
}

export function cx(
  ...classNames: Array<string | undefined | null | false>
): string {
  return classNames.filter(Boolean).join(" ");
}
