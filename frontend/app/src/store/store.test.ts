import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import type {
  CommandAction,
  SessionDescriptor,
  SystemDescriptor,
  ViewerCursor,
} from '../protocol/types'
import {
  appendGeneration,
  describeAction,
  foldRecordingSessions,
  rebindSession,
  selectionOfAction,
} from './store'

const SESSION = '11111111-2222-3333-4444-555555555555'
const OTHER = '66666666-7777-8888-9999-000000000000'

function system(generation: number): SystemDescriptor {
  return {
    id: 'simhark',
    label: 'simhark',
    kind: 'simhark',
    generation,
    capabilities: [],
  }
}

function session(
  id: string,
  lifecycle: SessionDescriptor['lifecycle'] = 'running',
): SessionDescriptor {
  return {
    id,
    label: id,
    kind: 'simulation',
    lifecycle,
    mutable: true,
    created_at_ns: 0,
    system_ids: ['simhark'],
    world_count: 1,
    live_frame: 0,
    terminal_error: null,
  }
}

function cursor(sessionId: string, live = true): ViewerCursor {
  return { id: 'cursor', session_id: sessionId, live, frame: live ? null : 42, world_ids: [] }
}

describe('foldRecordingSessions', () => {
  it('marks a session as recording when a start is accepted', () => {
    const next = foldRecordingSessions([], {
      type: 'start_recording',
      data: { session_id: SESSION },
    })
    assert.deepEqual(next, [SESSION])
  })

  it('reports no change when the session is already recording', () => {
    const next = foldRecordingSessions([SESSION], {
      type: 'start_recording',
      data: { session_id: SESSION },
    })
    assert.equal(next, null, 'a duplicate start must not trigger a notification')
  })

  it('clears only the session that stopped', () => {
    const next = foldRecordingSessions([SESSION, OTHER], {
      type: 'stop_recording',
      data: { session_id: SESSION },
    })
    assert.deepEqual(next, [OTHER])
  })

  it('reports no change when stopping something that was not recording', () => {
    assert.equal(
      foldRecordingSessions([OTHER], { type: 'stop_recording', data: { session_id: SESSION } }),
      null,
    )
  })

  it('ignores unrelated commands', () => {
    const action: CommandAction = {
      type: 'system',
      data: {
        system_id: 'crashpilot',
        command: { type: 'crash_pilot', data: { type: 'halt_all' } },
      },
    }
    assert.equal(foldRecordingSessions([SESSION], action), null)
  })
})

describe('rebindSession', () => {
  it('keeps a session the host still publishes', () => {
    const bound = rebindSession([session(OTHER), session(SESSION)], SESSION, cursor(SESSION))
    assert.equal(bound.activeSessionId, SESSION)
    assert.deepEqual(bound.cursor, cursor(SESSION))
  })

  it('adopts a session when the tab has none yet', () => {
    assert.equal(rebindSession([session(SESSION)], null, null).activeSessionId, SESSION)
  })

  it('re-points at the new session after a host restart', () => {
    // The restarted host hands out fresh ids, so the one this tab held is gone.
    // Holding on to it resolves to no active session, which reads as immutable
    // and disables every command until the page is reloaded.
    const bound = rebindSession([session(OTHER)], SESSION, null)
    assert.equal(bound.activeSessionId, OTHER)
  })

  it('drops a cursor whose session no longer exists', () => {
    const bound = rebindSession([session(OTHER)], SESSION, cursor(SESSION, false))
    assert.equal(bound.cursor, null, 'a detached cursor must not survive its session')
  })

  it('prefers a running session over an empty one', () => {
    const bound = rebindSession([session(SESSION, 'empty'), session(OTHER, 'running')], null, null)
    assert.equal(bound.activeSessionId, OTHER)
  })

  it('clears everything when the host publishes no sessions', () => {
    assert.deepEqual(rebindSession([], SESSION, cursor(SESSION)), {
      activeSessionId: null,
      cursor: null,
    })
  })
})

describe('appendGeneration', () => {
  it('records the first generation it sees', () => {
    const history = appendGeneration({}, system(1), 1000)
    assert.deepEqual(history.simhark, [{ generation: 1, at: 1000 }])
  })

  it('does not repeat an unchanged generation', () => {
    const first = appendGeneration({}, system(1), 1000)
    const second = appendGeneration(first, system(1), 2000)
    assert.equal(second, first, 'an unchanged generation must not allocate a new record')
  })

  it('appends when the system reloads', () => {
    const first = appendGeneration({}, system(1), 1000)
    const second = appendGeneration(first, system(2), 2000)
    assert.deepEqual(second.simhark, [
      { generation: 1, at: 1000 },
      { generation: 2, at: 2000 },
    ])
  })

  it('keeps the history bounded', () => {
    let history: ReturnType<typeof appendGeneration> = {}
    for (let generation = 1; generation <= 40; generation += 1) {
      history = appendGeneration(history, system(generation), generation)
    }
    assert.equal(history.simhark.length, 20)
    assert.equal(history.simhark[0].generation, 21, 'the oldest entries are dropped')
  })
})

describe('selectionOfAction', () => {
  it('names the robot a move acted on, so the feed can select it', () => {
    assert.deepEqual(
      selectionOfAction({
        type: 'system',
        data: {
          system_id: 'simhark',
          command: {
            type: 'simhark',
            data: {
              type: 'move_robot',
              data: {
                world_id: 2,
                team: 'yellow',
                id: 5,
                position: { x_mm: 0, y_mm: 0 },
              },
            },
          },
        },
      }),
      { kind: 'robot', worldId: 2, team: 'yellow', robotId: 5 },
    )
  })

  it('names the ball for a ball move', () => {
    assert.deepEqual(
      selectionOfAction({
        type: 'system',
        data: {
          system_id: 'simhark',
          command: {
            type: 'simhark',
            data: {
              type: 'move_ball',
              data: { world_id: 1, position: { x_mm: 10, y_mm: 20 } },
            },
          },
        },
      }),
      { kind: 'ball', worldId: 1 },
    )
  })

  it('returns null for commands that name no entity', () => {
    assert.equal(
      selectionOfAction({
        type: 'system',
        data: {
          system_id: 'simhark',
          command: { type: 'simhark', data: { type: 'pause' } },
        },
      }),
      null,
    )
    assert.equal(
      selectionOfAction({ type: 'start_recording', data: { session_id: SESSION } }),
      null,
    )
  })
})

describe('describeAction', () => {
  it('names a nested system command', () => {
    assert.equal(
      describeAction({
        type: 'system',
        data: {
          system_id: 'simhark',
          command: { type: 'simhark', data: { type: 'pause' } },
        },
      }),
      'simhark · simhark · pause',
    )
  })

  it('describes every action kind without throwing', () => {
    const actions: CommandAction[] = [
      { type: 'create_session', data: { label: 'x', kind: 'simulation', controller: null } },
      { type: 'set_session_lifecycle', data: { session_id: SESSION, lifecycle: 'paused' } },
      {
        type: 'set_viewer_cursor',
        data: { id: OTHER, session_id: SESSION, live: false, frame: 42, world_ids: [] },
      },
      { type: 'add_bookmark', data: { session_id: SESSION, frame: 7, label: 'x' } },
      { type: 'add_annotation', data: { session_id: SESSION, frame: 7, text: 'x' } },
      { type: 'start_recording', data: { session_id: SESSION } },
      { type: 'stop_recording', data: { session_id: SESSION } },
      {
        type: 'export',
        data: { session_id: SESSION, format: 'json', destination: null },
      },
    ]
    for (const action of actions) {
      const described = describeAction(action)
      assert.equal(typeof described, 'string')
      assert.ok(described.length > 0, `${action.type} must produce a summary`)
    }
  })

  it('distinguishes a detached cursor from a return to live', () => {
    const detached = describeAction({
      type: 'set_viewer_cursor',
      data: { id: OTHER, session_id: SESSION, live: false, frame: 900, world_ids: [] },
    })
    const live = describeAction({
      type: 'set_viewer_cursor',
      data: { id: OTHER, session_id: SESSION, live: true, frame: null, world_ids: [] },
    })
    assert.match(detached, /900/)
    assert.match(live, /live/)
  })
})
