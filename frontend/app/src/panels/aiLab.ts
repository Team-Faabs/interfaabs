// Decision logic behind the AI Lab panel, kept separate from the JSX so the
// rules that matter — when an entry may be started, and what "started" means —
// are testable without a DOM.

import { mergeObjectDefaults } from '@faabs/schema-renderer'
import type {
  FormPart,
  JsonObject,
  RegistryEntry,
  RegistryPart,
  RendererSchema,
  RendererValues,
  RobotOption,
} from '@faabs/schema-renderer'

import type { DeveloperRunState, WorldState } from '../protocol/types'

export interface Selection {
  kind: string
  entry: RegistryEntry
  form: FormPart
}

export interface MatchControls {
  availableAis?: Array<{ id: string; label: string }>
  blueAi?: string | null
  yellowAi?: string | null
  blueDeveloperSchema?: RendererSchema | null
  yellowDeveloperSchema?: RendererSchema | null
  teleportBallOnNoProgress?: boolean
}

export type LabSchema = RendererSchema & { matchControls?: MatchControls }

/** Which of the four lifecycle buttons the operator may press right now. */
export interface RunActions {
  load: boolean
  start: boolean
  stop: boolean
  release: boolean
}

export function runActions({
  state,
  hasSelection,
  stale,
  mutable,
}: {
  state: DeveloperRunState
  hasSelection: boolean
  /** The form now shows a different entry than the one the host has loaded. */
  stale: boolean
  mutable: boolean
}): RunActions {
  const running = state === 'running'
  return {
    // Loading during a run would swap the configuration out from under a live
    // instance, so it waits until the run has ended.
    load: mutable && !running && hasSelection,
    // Starting needs something loaded, and needs the loaded thing to still be
    // what the operator is looking at.
    start: mutable && !running && state !== 'idle' && !stale,
    stop: mutable && running,
    release: mutable && state !== 'idle',
  }
}

/**
 * The document the registry browser renders.
 *
 * In a dev match the host publishes a match-control document and hangs each
 * side's registry off `matchControls`; otherwise the published schema is
 * already the registry document with one mode per controllable side.
 */
export function registrySchema(schema: LabSchema | null): RendererSchema | null {
  if (!schema) return null
  const controls = schema.matchControls
  if (!controls) return schema.tabs?.length ? schema : null

  const targets = [
    controls.blueDeveloperSchema
      ? { id: 'blue', label: 'Blue team', schema: controls.blueDeveloperSchema }
      : null,
    controls.yellowDeveloperSchema
      ? { id: 'yellow', label: 'Yellow team', schema: controls.yellowDeveloperSchema }
      : null,
  ].filter(
    (target): target is { id: string; label: string; schema: RendererSchema } => target !== null,
  )
  if (targets.length === 0) return null

  return {
    ...targets[0].schema,
    modes: targets.map(({ id, label }) => ({
      id,
      label,
      description: `Invoke against the ${label.toLowerCase()} controller`,
      icon: 'pulse' as const,
    })),
    initialModeId: targets[0].id,
  }
}

export function firstSelection(schema: RendererSchema, tabId: string): Selection | null {
  const tab = schema.tabs.find((candidate) => candidate.id === tabId)
  if (!tab || tab.source.kind !== 'inline' || tab.source.part.kind !== 'registry') return null
  const registry = tab.source.part
  const entry =
    registry.entries.find((candidate) => candidate.id === registry.initialEntryId) ??
    registry.entries[0]
  return entry ? selectionFromEntry(registry, entry) : null
}

export function findSelection(
  schema: RendererSchema,
  registryId: string,
  entryId: string,
): Selection | null {
  for (const tab of schema.tabs) {
    if (tab.source.kind !== 'inline' || tab.source.part.kind !== 'registry') continue
    const registry = tab.source.part
    if (registry.id !== registryId) continue
    const entry = registry.entries.find((candidate) => candidate.id === entryId)
    return entry ? selectionFromEntry(registry, entry) : null
  }
  return null
}

function selectionFromEntry(registry: RegistryPart, entry: RegistryEntry): Selection | null {
  if (entry.source.kind !== 'inline' || entry.source.part.kind !== 'form') return null
  return { kind: registry.id, entry, form: entry.source.part }
}

export function sectionValues(
  form: FormPart,
  sectionId: string,
  values: RendererValues,
): JsonObject {
  const section = form.sections.find((candidate) => candidate.id === sectionId)
  if (!section) return {}
  return mergeObjectDefaults(section.schema, values[form.id]?.[section.id], section.initialValue)
}

/** `skills` → `skill`: the registry tab id is plural, the command kind is not. */
export function singular(kind: string): string {
  return kind.endsWith('s') ? kind.slice(0, -1) : kind
}

export function robotOptions(world: WorldState | null, modeId: string): RobotOption[] {
  if (!world) return []
  return world.robots
    .filter((robot) => robot.team === modeId && robot.visible)
    .map((robot) => ({
      value: `R${robot.id}`,
      label: `Robot ${robot.id}`,
      team: 'own' as const,
      detail: robot.infrared ? 'ball detected' : undefined,
    }))
}
