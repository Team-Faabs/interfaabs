import type { ChangeEvent } from "react";
import {
  defaultValueForType,
  teamName,
  unitLabel,
} from "./schema-utils";
import type {
  FieldSchema,
  JsonObject,
  JsonValue,
  RobotOption,
} from "./types";
import styles from "./SchemaRenderer.module.scss";

interface FieldRendererProps {
  field: FieldSchema;
  value: JsonValue | undefined;
  onChange: (value: JsonValue) => void;
  robots: RobotOption[];
  disabled: boolean;
  depth?: number;
}

const generatedRobots: RobotOption[] = Array.from({ length: 16 }, (_, id) => ({
  value: `R${id}`,
  label: `Robot ${id}`,
}));

function NumberInput({
  field,
  value,
  onChange,
  disabled,
}: FieldRendererProps) {
  if (field.ty.type !== "float" && field.ty.type !== "u32") {
    return null;
  }

  const options = field.ty.options;
  const suffix = unitLabel(options.unit);
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = event.target.valueAsNumber;
    onChange(
      Number.isNaN(parsed)
        ? options.min ?? 0
        : field.ty.type === "u32"
          ? Math.max(0, Math.round(parsed))
          : parsed,
    );
  };

  return (
    <div className={styles.inputShell}>
      <input
        className={styles.input}
        type="number"
        aria-label={field.label}
        min={options.min ?? undefined}
        max={options.max ?? undefined}
        step={field.ty.type === "u32" ? 1 : "any"}
        value={typeof value === "number" ? value : options.min ?? 0}
        placeholder={field.placeholder}
        disabled={disabled}
        onChange={handleChange}
      />
      {suffix && <span className={styles.unit}>{suffix}</span>}
    </div>
  );
}

function ObjectFields({
  field,
  value,
  onChange,
  robots,
  disabled,
  depth = 0,
}: FieldRendererProps) {
  if (field.ty.type !== "object") {
    return null;
  }

  const object =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonObject)
      : {};

  return (
    <div className={styles.nestedFields}>
      {field.ty.options.fields.map((child) => (
        <FieldRenderer
          key={child.key}
          field={child}
          value={object[child.key] ?? defaultValueForType(child.ty)}
          robots={robots}
          disabled={disabled}
          depth={depth + 1}
          onChange={(next) => onChange({ ...object, [child.key]: next })}
        />
      ))}
      {field.ty.options.fields.length === 0 && (
        <span className={styles.emptyInline}>No fields</span>
      )}
    </div>
  );
}

export function FieldRenderer({
  field,
  value,
  onChange,
  robots,
  disabled,
  depth = 0,
}: FieldRendererProps) {
  const type = field.ty;

  if (type.type === "object") {
    return (
      <fieldset className={styles.nestedGroup}>
        <legend>{field.label}</legend>
        {field.description && (
          <p className={styles.fieldDescription}>{field.description}</p>
        )}
        <ObjectFields
          field={field}
          value={value}
          onChange={onChange}
          robots={robots}
          disabled={disabled}
          depth={depth}
        />
      </fieldset>
    );
  }

  if (type.type === "list") {
    const list = Array.isArray(value) ? value : [];
    return (
      <div className={styles.listField}>
        <div className={styles.fieldHeading}>
          <div>
            <label>{field.label}</label>
            {field.description && (
              <p className={styles.fieldDescription}>{field.description}</p>
            )}
          </div>
          <button
            type="button"
            className={styles.smallButton}
            disabled={disabled}
            onClick={() =>
              onChange([...list, defaultValueForType(type.options.item)])
            }
          >
            <PlusIcon />
            Add
          </button>
        </div>
        {list.length === 0 ? (
          <div className={styles.emptyList}>No items added</div>
        ) : (
          <div className={styles.listItems}>
            {list.map((item, index) => (
              <div className={styles.listItem} key={index}>
                <FieldRenderer
                  field={{
                    key: String(index),
                    label: `Item ${index + 1}`,
                    ty: type.options.item,
                  }}
                  value={item}
                  robots={robots}
                  disabled={disabled}
                  depth={depth + 1}
                  onChange={(next) =>
                    onChange(
                      list.map((current, itemIndex) =>
                        itemIndex === index ? next : current,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={`Remove item ${index + 1}`}
                  disabled={disabled}
                  onClick={() =>
                    onChange(list.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (type.type === "bool") {
    return (
      <label className={styles.booleanField}>
        <span className={styles.booleanCopy}>
          <span className={styles.fieldLabel}>{field.label}</span>
          {field.description && (
            <span className={styles.fieldDescription}>{field.description}</span>
          )}
        </span>
        <input
          className={styles.switchInput}
          type="checkbox"
          aria-label={field.label}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className={styles.switchTrack} aria-hidden="true">
          <span />
        </span>
      </label>
    );
  }

  let control;
  if (type.type === "float" || type.type === "u32") {
    control = (
      <NumberInput
        field={field}
        value={value}
        onChange={onChange}
        robots={robots}
        disabled={disabled}
      />
    );
  } else if (type.type === "vec2") {
    const vector =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as JsonObject)
        : {};
    const suffix = unitLabel(type.options.unit);
    control = (
      <div className={styles.vector}>
        {(["x", "y"] as const).map((axis) => (
          <div className={styles.axisInput} key={axis}>
            <span>{axis.toUpperCase()}</span>
            <input
              className={styles.input}
              type="number"
              aria-label={`${field.label} ${axis.toUpperCase()}`}
              step="any"
              value={typeof vector[axis] === "number" ? vector[axis] : 0}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...vector,
                  [axis]: Number.isNaN(event.target.valueAsNumber)
                    ? 0
                    : event.target.valueAsNumber,
                })
              }
            />
            {suffix && <span className={styles.unit}>{suffix}</span>}
          </div>
        ))}
      </div>
    );
  } else if (type.type === "enum") {
    control = (
      <div className={styles.selectShell}>
        <select
          className={styles.select}
          aria-label={field.label}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {type.options.options.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon />
      </div>
    );
  } else if (type.type === "robot") {
    const requestedTeam = teamName(type.options);
    const options = (robots.length > 0 ? robots : generatedRobots).filter(
      (robot) =>
        requestedTeam === "both" ||
        robot.team === undefined ||
        robot.team === requestedTeam,
    );
    control = (
      <div className={styles.selectShell}>
        <span className={styles.robotDot} data-team={requestedTeam} />
        <select
          className={`${styles.select} ${styles.robotSelect}`}
          aria-label={field.label}
          value={
            typeof value === "string" || typeof value === "number" ? value : "R0"
          }
          disabled={disabled}
          onChange={(event) => {
            const option = options.find(
              (candidate) => String(candidate.value) === event.target.value,
            );
            onChange(option?.value ?? event.target.value);
          }}
        >
          {options.map((robot) => (
            <option value={robot.value} key={robot.value}>
              {robot.label}
              {robot.detail ? ` · ${robot.detail}` : ""}
            </option>
          ))}
        </select>
        <ChevronDownIcon />
      </div>
    );
  }

  return (
    <div className={styles.field}>
      <div className={styles.fieldCopy}>
        <span className={styles.fieldLabel}>{field.label}</span>
        {field.description && (
          <p className={styles.fieldDescription}>{field.description}</p>
        )}
      </div>
      <div className={styles.control}>{control}</div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.5 6h11M8 3.5h4M6.5 6l.6 10h5.8l.6-10M8.5 8.5v5M11.5 8.5v5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className={styles.chevron} viewBox="0 0 20 20" aria-hidden="true">
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}
