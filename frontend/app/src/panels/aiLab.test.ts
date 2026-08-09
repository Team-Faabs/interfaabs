import { describe, expect, it } from 'vitest'
import type { FormPart, RendererSchema } from '@faabs/schema-renderer'

import type { WorldState } from '../protocol/types'
import {
  findSelection,
  firstSelection,
  registrySchema,
  robotOptions,
  runActions,
  sectionValues,
  singular,
  type LabSchema,
} from './aiLab'

const form: FormPart = {
  kind: 'form',
  id: 'skills.pass_to',
  title: 'Pass To',
  sections: [
    {
      id: 'config',
      title: 'Configuration',
      schema: { name: 'PassToConfig', fields: [] },
      initialValue: {},
    },
    {
      id: 'params',
      title: 'Parameters',
      schema: {
        name: 'PassToParams',
        fields: [
          { key: 'passer', label: 'passer', ty: { type: 'robot' as const, options: 'both' as const } },
        ],
      },
      initialValue: { passer: 'R0' },
    },
  ],
}

const registryDocument: RendererSchema = {
  id: 'dehumanized-registry',
  title: 'Dehumanized AI Lab',
  tabs: [
    {
      id: 'skills',
      label: 'Skills',
      source: {
        kind: 'inline',
        part: {
          kind: 'registry',
          id: 'skills',
          title: 'Skills',
          entries: [
            { id: 'Pass To', label: 'Pass To', source: { kind: 'inline', part: form } },
            {
              id: 'Move To Ball',
              label: 'Move To Ball',
              source: { kind: 'inline', part: { ...form, id: 'skills.move_to_ball' } },
            },
          ],
        },
      },
    },
  ],
  initialTabId: 'skills',
}

describe('runActions', () => {
  it('refuses to start before anything is loaded', () => {
    const actions = runActions({ state: 'idle', hasSelection: true, stale: false, mutable: true })
    expect(actions.start).toBe(false)
    expect(actions.load).toBe(true)
    expect(actions.release).toBe(false)
  })

  it('allows exactly one start: none while running', () => {
    const actions = runActions({
      state: 'running',
      hasSelection: true,
      stale: false,
      mutable: true,
    })
    expect(actions.start).toBe(false)
    expect(actions.stop).toBe(true)
    // Loading a different configuration under a live instance is not offered.
    expect(actions.load).toBe(false)
  })

  it('allows starting again once a run has ended', () => {
    for (const state of ['stopped', 'finished', 'failed'] as const) {
      expect(runActions({ state, hasSelection: true, stale: false, mutable: true }).start).toBe(
        true,
      )
    }
  })

  it('refuses to start a selection the host has not loaded', () => {
    const actions = runActions({ state: 'loaded', hasSelection: true, stale: true, mutable: true })
    expect(actions.start).toBe(false)
    expect(actions.load).toBe(true)
  })

  it('offers nothing to a detached viewer', () => {
    const actions = runActions({
      state: 'loaded',
      hasSelection: true,
      stale: false,
      mutable: false,
    })
    expect(actions).toEqual({ load: false, start: false, stop: false, release: false })
  })
})

describe('registrySchema', () => {
  it('uses the published document directly when there are no match controls', () => {
    expect(registrySchema(registryDocument)?.id).toBe('dehumanized-registry')
  })

  it('builds one mode per side that exposes a registry', () => {
    const schema: LabSchema = {
      id: 'match-runner-dev',
      title: 'Match development',
      tabs: [],
      matchControls: {
        blueDeveloperSchema: registryDocument,
        yellowDeveloperSchema: null,
      },
    }
    const lab = registrySchema(schema)
    expect(lab?.modes?.map((mode) => mode.id)).toEqual(['blue'])
    expect(lab?.initialModeId).toBe('blue')
    expect(lab?.tabs).toHaveLength(1)
  })

  it('has no lab when no side exposes a registry', () => {
    expect(
      registrySchema({
        id: 'match-runner-dev',
        title: 'Match development',
        tabs: [],
        matchControls: { availableAis: [] },
      }),
    ).toBeNull()
  })
})

describe('selection', () => {
  it('starts on the first entry of a tab', () => {
    expect(firstSelection(registryDocument, 'skills')?.entry.id).toBe('Pass To')
  })

  it('finds an entry by registry and id', () => {
    expect(findSelection(registryDocument, 'skills', 'Move To Ball')?.form.id).toBe(
      'skills.move_to_ball',
    )
    expect(findSelection(registryDocument, 'plays', 'Pass To')).toBeNull()
  })

  it('falls back to a section default when the operator edited nothing', () => {
    expect(sectionValues(form, 'params', {})).toEqual({ passer: 'R0' })
    expect(sectionValues(form, 'params', { 'skills.pass_to': { params: { passer: 'R2' } } })).toEqual(
      { passer: 'R2' },
    )
    expect(sectionValues(form, 'nope', {})).toEqual({})
  })

  it('maps a plural registry id to a singular command kind', () => {
    expect(singular('skills')).toBe('skill')
    expect(singular('plays')).toBe('play')
    expect(singular('skill')).toBe('skill')
  })
})

describe('robotOptions', () => {
  const world = {
    robots: [
      { id: 0, team: 'blue', visible: true, infrared: true },
      { id: 1, team: 'blue', visible: false, infrared: null },
      { id: 0, team: 'yellow', visible: true, infrared: null },
    ],
  } as unknown as WorldState

  it('offers only the visible robots of the selected side', () => {
    expect(robotOptions(world, 'blue')).toEqual([
      { value: 'R0', label: 'Robot 0', team: 'own', detail: 'ball detected' },
    ])
    expect(robotOptions(world, 'yellow')).toHaveLength(1)
    expect(robotOptions(null, 'blue')).toEqual([])
  })
})
