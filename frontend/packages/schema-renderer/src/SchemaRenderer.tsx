import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { FieldRenderer } from "./FieldRenderer";
import {
  cx,
  sectionValue,
  updateObjectPath,
} from "./schema-utils";
import type {
  FormPart,
  JsonValue,
  PartLoadContext,
  PartSource,
  RegistryPart,
  RendererTab,
  RendererValues,
  SchemaPart,
  SchemaRendererProps,
} from "./types";
import styles from "./SchemaRenderer.module.scss";

export function SchemaRenderer({
  schema,
  values: controlledValues,
  defaultValues = {},
  onValuesChange,
  modeId: controlledModeId,
  defaultModeId,
  onModeChange,
  tabId: controlledTabId,
  defaultTabId,
  onTabChange,
  onRegistryEntryChange,
  loadPart,
  schemaRevision = 0,
  robots = [],
  disabled = false,
  theme = "simhark",
  density = "comfortable",
  className,
  classNames = {},
  style,
  renderFooter,
}: SchemaRendererProps) {
  const firstModeId =
    defaultModeId ?? schema.initialModeId ?? schema.modes?.[0]?.id;
  const firstTabId =
    defaultTabId ?? schema.initialTabId ?? schema.tabs[0]?.id ?? "";
  const [internalValues, setInternalValues] =
    useState<RendererValues>(defaultValues);
  const [internalModeId, setInternalModeId] = useState(firstModeId);
  const [internalTabId, setInternalTabId] = useState(firstTabId);
  const [registrySelections, setRegistrySelections] = useState<
    Record<string, string>
  >({});
  const values = controlledValues ?? internalValues;
  const requestedModeId = controlledModeId ?? internalModeId;
  const activeModeId = schema.modes?.some(
    (mode) => mode.id === requestedModeId,
  )
    ? requestedModeId
    : schema.modes?.[0]?.id;
  const requestedTabId = controlledTabId ?? internalTabId;
  const activeTab =
    schema.tabs.find((tab) => tab.id === requestedTabId) ?? schema.tabs[0];

  useEffect(() => {
    if (
      controlledTabId === undefined &&
      activeTab &&
      internalTabId !== activeTab.id
    ) {
      setInternalTabId(activeTab.id);
    }
  }, [activeTab, controlledTabId, internalTabId]);

  useEffect(() => {
    if (
      controlledModeId === undefined &&
      activeModeId !== internalModeId
    ) {
      setInternalModeId(activeModeId);
    }
  }, [activeModeId, controlledModeId, internalModeId]);

  function selectTab(tabId: string) {
    if (controlledTabId === undefined) {
      setInternalTabId(tabId);
    }
    onTabChange?.(tabId);
  }

  function selectMode(modeId: string) {
    if (controlledModeId === undefined) {
      setInternalModeId(modeId);
    }
    onModeChange?.(modeId);
  }

  function commitValue(
    partId: string,
    sectionId: string,
    fieldPath: string[],
    value: JsonValue,
    schemaValue: ReturnType<typeof sectionValue>,
  ) {
    const nextSection = updateObjectPath(schemaValue, fieldPath, value);
    const nextValues = {
      ...values,
      [partId]: {
        ...values[partId],
        [sectionId]: nextSection,
      },
    };
    if (controlledValues === undefined) {
      setInternalValues(nextValues);
    }
    onValuesChange?.(nextValues, {
      partId,
      sectionId,
      fieldPath,
      value,
    });
  }

  if (!activeTab) {
    return (
      <div
        className={cx(styles.root, styles.emptyDocument, classNames.root, className)}
        data-theme={theme}
        style={style}
      >
        <EmptyState
          title="No views available"
          description="Add at least one tab to the renderer schema."
        />
      </div>
    );
  }

  return (
    <section
      className={cx(styles.root, classNames.root, className)}
      data-theme={theme}
      data-density={density}
      style={style}
    >
      <header className={cx(styles.header, classNames.header)}>
        <div className={styles.heading}>
          <div className={styles.productMark} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <h2>{schema.title}</h2>
            {schema.description && <p>{schema.description}</p>}
          </div>
        </div>
        {schema.modes && schema.modes.length > 0 && (
          <div
            className={cx(styles.modes, classNames.modes)}
            role="group"
            aria-label="Renderer mode"
          >
            {schema.modes.map((mode) => (
              <button
                type="button"
                key={mode.id}
                className={cx(
                  styles.mode,
                  activeModeId === mode.id && styles.modeActive,
                )}
                title={mode.description}
                aria-pressed={activeModeId === mode.id}
                onClick={() => selectMode(mode.id)}
              >
                {mode.icon === "pulse" && <PulseIcon />}
                {mode.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <nav
        className={cx(styles.tabs, classNames.tabs)}
        aria-label={`${schema.title} views`}
      >
        {schema.tabs.map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab.id}
            className={cx(
              styles.tab,
              activeTab.id === tab.id && styles.tabActive,
            )}
            aria-selected={activeTab.id === tab.id}
            title={tab.description}
            onClick={() => selectTab(tab.id)}
          >
            <TabIcon icon={tab.icon} />
            <span>{tab.label}</span>
            {tab.badge && <small>{tab.badge}</small>}
          </button>
        ))}
      </nav>

      <main className={cx(styles.body, classNames.body)}>
        <PartSourceView
          source={activeTab.source}
          context={{
            documentId: schema.id,
            tabId: activeTab.id,
            modeId: activeModeId,
          }}
          revision={schemaRevision}
          loader={loadPart}
          values={values}
          robots={robots}
          disabled={disabled}
          classNames={classNames}
          registrySelections={registrySelections}
          onRegistrySelect={(registryId, entryId) =>
            {
              setRegistrySelections((current) => ({
                ...current,
                [registryId]: entryId,
              }));
              onRegistryEntryChange?.(registryId, entryId);
            }
          }
          onFieldChange={commitValue}
        />
      </main>

      {renderFooter && (
        <footer className={cx(styles.footer, classNames.footer)}>
          {renderFooter({
            activeTab,
            modeId: activeModeId,
            values,
          })}
        </footer>
      )}
    </section>
  );
}

interface PartSourceViewProps {
  source: PartSource;
  context: Omit<PartLoadContext, "signal">;
  revision: string | number;
  loader: SchemaRendererProps["loadPart"];
  values: RendererValues;
  robots: NonNullable<SchemaRendererProps["robots"]>;
  disabled: boolean;
  classNames: NonNullable<SchemaRendererProps["classNames"]>;
  registrySelections: Record<string, string>;
  onRegistrySelect: (registryId: string, entryId: string) => void;
  onFieldChange: (
    partId: string,
    sectionId: string,
    path: string[],
    value: JsonValue,
    schemaValue: ReturnType<typeof sectionValue>,
  ) => void;
}

function PartSourceView(props: PartSourceViewProps) {
  const { source, context, revision, loader } = props;
  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "loaded"; part: SchemaPart }
    | { status: "error"; message: string }
  >(
    source.kind === "inline"
      ? { status: "loaded", part: source.part }
      : { status: "loading" },
  );

  useEffect(() => {
    if (source.kind === "inline") {
      setState({ status: "loaded", part: source.part });
      return;
    }
    if (!loader) {
      setState({
        status: "error",
        message: `No loader was supplied for schema part “${source.key}”.`,
      });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });
    loader(source.key, { ...context, signal: controller.signal })
      .then((part) => {
        if (!controller.signal.aborted) {
          setState({ status: "loaded", part });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "The schema part could not be loaded.",
          });
        }
      });
    return () => controller.abort();
  }, [
    source,
    loader,
    context.documentId,
    context.tabId,
    context.modeId,
    context.parentPartId,
    context.entryId,
    revision,
    reloadCount,
  ]);

  if (state.status === "loading") {
    return <LoadingState />;
  }
  if (state.status === "error") {
    return (
      <EmptyState
        title="Could not load schema"
        description={state.message}
        action={
          <button
            type="button"
            className={styles.retryButton}
            onClick={() => setReloadCount((count) => count + 1)}
          >
            Try again
          </button>
        }
      />
    );
  }
  return <PartView {...props} part={state.part} />;
}

function PartView({
  part,
  context,
  ...props
}: PartSourceViewProps & { part: SchemaPart }) {
  switch (part.kind) {
    case "form":
      return <FormView {...props} context={context} part={part} />;
    case "registry":
      return <RegistryView {...props} context={context} part={part} />;
    case "empty":
      return (
        <EmptyState title={part.title} description={part.description} />
      );
  }
}

function RegistryView({
  part,
  context,
  classNames,
  registrySelections,
  onRegistrySelect,
  ...props
}: Omit<PartSourceViewProps, "source"> & { part: RegistryPart }) {
  const initialEntry =
    part.initialEntryId ?? part.entries[0]?.id ?? "";
  const selectedEntryId = registrySelections[part.id] ?? initialEntry;
  const selectedEntry =
    part.entries.find((entry) => entry.id === selectedEntryId) ??
    part.entries[0];

  return (
    <div className={cx(styles.registryLayout, classNames.registry)}>
      <aside className={styles.registryPanel}>
        <div className={styles.registryHeading}>
          <span className={styles.eyebrow}>Registry</span>
          <h3>{part.title}</h3>
          {part.description && <p>{part.description}</p>}
        </div>
        <div className={styles.registryEntries}>
          {part.entries.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={cx(
                styles.registryEntry,
                selectedEntry?.id === entry.id && styles.registryEntryActive,
              )}
              onClick={() => onRegistrySelect(part.id, entry.id)}
            >
              <span className={styles.registryEntryIcon}>
                <NodeIcon />
              </span>
              <span className={styles.registryEntryCopy}>
                <strong>{entry.label}</strong>
                {entry.description && <small>{entry.description}</small>}
              </span>
              {entry.badge && <em>{entry.badge}</em>}
              <ChevronRightIcon />
            </button>
          ))}
        </div>
      </aside>
      <div className={styles.registryContent}>
        {selectedEntry ? (
          <PartSourceView
            {...props}
            classNames={classNames}
            registrySelections={registrySelections}
            onRegistrySelect={onRegistrySelect}
            source={selectedEntry.source}
            context={{
              ...context,
              parentPartId: part.id,
              entryId: selectedEntry.id,
            }}
          />
        ) : (
          <EmptyState
            title="Registry is empty"
            description="No entries were returned for this view."
          />
        )}
      </div>
    </div>
  );
}

function FormView({
  part,
  values,
  robots,
  disabled,
  classNames,
  onFieldChange,
}: Omit<PartSourceViewProps, "source"> & { part: FormPart }) {
  return (
    <div className={cx(styles.formPage, classNames.form)}>
      <div className={styles.formHeader}>
        <div>
          {part.eyebrow && (
            <span className={styles.eyebrow}>{part.eyebrow}</span>
          )}
          <h3>{part.title}</h3>
          {part.description && <p>{part.description}</p>}
        </div>
        {part.status && (
          <span className={styles.status}>
            <span />
            {part.status}
          </span>
        )}
      </div>
      <div className={styles.sections}>
        {part.sections.map((section) => {
          const currentValue = sectionValue(
            values,
            part.id,
            section.id,
            section.schema,
            section.initialValue,
          );
          return (
            <section
              className={cx(styles.section, classNames.section)}
              key={section.id}
            >
              <div className={styles.sectionHeading}>
                <div>
                  <h4>{section.title}</h4>
                  {section.description && <p>{section.description}</p>}
                </div>
                <span className={styles.schemaName}>
                  {section.schema.name}
                </span>
              </div>
              <div className={styles.fields}>
                {section.schema.fields.map((field) => (
                  <div className={classNames.field} key={field.key}>
                    <FieldRenderer
                      field={field}
                      value={currentValue[field.key]}
                      robots={robots}
                      disabled={disabled}
                      onChange={(value) =>
                        onFieldChange(
                          part.id,
                          section.id,
                          [field.key],
                          value,
                          currentValue,
                        )
                      }
                    />
                  </div>
                ))}
                {section.schema.fields.length === 0 && (
                  <div className={styles.emptySection}>
                    <CheckIcon />
                    <span>
                      <strong>No configuration required</strong>
                      <small>This section is ready with its defaults.</small>
                    </span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className={styles.loading} aria-live="polite">
      <span className={styles.loadingOrb} />
      <div>
        <strong>Loading schema</strong>
        <small>Fetching the selected definition…</small>
      </div>
      <span className={styles.loadingLine} />
      <span className={styles.loadingLine} />
      <span className={styles.loadingLineShort} />
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon}>
        <SchemaIcon />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

function TabIcon({ icon }: { icon?: RendererTab["icon"] }) {
  switch (icon) {
    case "playbook":
      return <PlaybookIcon />;
    case "bolt":
      return <BoltIcon />;
    case "analysis":
      return <AnalysisIcon />;
    default:
      return <SchemaIcon />;
  }
}

function PulseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 2.5a7.5 7.5 0 1 1-5.3 2.2" />
    </svg>
  );
}

function PlaybookIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="5" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="10" cy="15" r="1.5" />
      <path d="M6.4 5.5c3.2 1 4 3.2 3.7 7.8M13.6 5.6c-1.8.8-2.8 2-3.2 3.7" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m11.4 2.5-6 9h4.2l-1 6 6-9h-4.2l1-6Z" />
    </svg>
  );
}

function AnalysisIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 16.5h13M5 14V9m5 5V4m5 10v-3" />
    </svg>
  );
}

function NodeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" />
      <circle cx="4" cy="5" r="1.4" />
      <circle cx="16" cy="5" r="1.4" />
      <path d="m5.2 5.8 3.1 2.7M14.8 5.8l-3.1 2.7M10 12.5v3.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className={styles.chevronRight} viewBox="0 0 20 20" aria-hidden="true">
      <path d="m8 5 5 5-5 5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.5 10.2 3 3 6-6.5" />
    </svg>
  );
}

function SchemaIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" />
      <path d="M10 7h3a4 4 0 0 1 4 4v3M7 10v7h7" />
    </svg>
  );
}
