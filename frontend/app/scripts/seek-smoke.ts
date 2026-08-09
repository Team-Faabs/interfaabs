// Checks the detached-cursor seek path end to end against a running host.
//
//   node --experimental-strip-types scripts/seek-smoke.ts [http://127.0.0.1:8080]
//
// An unrecorded session must be rejected with a message rather than silently
// succeeding, and a live envelope must never carry a cursor id — those are the
// two ways this feature could look like it works while doing nothing.

import { decodeServerMessage, encodeClientMessage, randomUuid } from '../src/protocol/codec.ts'
import { PROTOCOL_VERSION } from '../src/protocol/types.ts'
import type { Bootstrap, ServerControl, ServerMessage } from '../src/protocol/types.ts'

const base = process.argv[2] ?? 'http://127.0.0.1:8080'
const browserInstanceId = randomUuid()
const cursorId = randomUuid()

const failures: string[] = []
function check(condition: boolean, description: string): void {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${description}`)
  if (!condition) failures.push(description)
}

const bootstrap = (await (await fetch(`${base}/api/v1/bootstrap`)).json()) as Bootstrap
const sessionId = bootstrap.sessions[0]?.id
if (!sessionId) {
  console.log('FAIL host has no session to seek in')
  process.exit(1)
}

const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/api/v1/ws`)
socket.binaryType = 'arraybuffer'
const done = Promise.withResolvers<void>()

let seekCommandId = ''
let sawCursorScopedState = false
let liveEnvelopesSeen = 0
let liveEnvelopeWithCursor = 0

socket.onopen = () => {
  socket.send(
    JSON.stringify({
      protocol_version: PROTOCOL_VERSION,
      asset_build_fingerprint: bootstrap.asset_build_fingerprint,
      browser_instance_id: browserInstanceId,
    }),
  )
}

socket.onmessage = (event) => {
  if (typeof event.data === 'string') {
    const control = JSON.parse(event.data) as ServerControl
    if (control.type !== 'hello_accepted') {
      check(false, `handshake accepted (got ${control.type})`)
      done.resolve()
    }
    return
  }

  const message = decodeServerMessage(event.data as ArrayBuffer) as ServerMessage

  if (message.type === 'initial_state') {
    for (const envelope of message.data.snapshots) {
      liveEnvelopesSeen += 1
      if (envelope.cursor_id) liveEnvelopeWithCursor += 1
    }
    seekCommandId = randomUuid()
    socket.send(
      encodeClientMessage({
        type: 'command',
        data: {
          id: seekCommandId,
          origin: {
            browser_instance_id: browserInstanceId,
            panel_id: 'seek-smoke',
            session_id: sessionId,
            viewer_cursor_id: null,
            client_sequence: 1,
            workstation_label: 'seek-smoke',
          },
          action: {
            type: 'set_viewer_cursor',
            data: {
              id: cursorId,
              session_id: sessionId,
              live: false,
              frame: 5,
              world_ids: [],
            },
          },
        },
      }),
    )
  }

  if (message.type === 'state') {
    if (message.data.cursor_id) {
      sawCursorScopedState = true
      check(
        message.data.cursor_id === cursorId,
        'a seeked envelope is tagged with the cursor that asked for it',
      )
    } else {
      liveEnvelopesSeen += 1
    }
  }

  if (message.type === 'command_acknowledgement' && message.data.command_id === seekCommandId) {
    const { status, message: text } = message.data
    console.log(`     seek acknowledged as ${status}: ${text || '(no message)'}`)

    if (status === 'rejected') {
      // The honest outcome for a session with no recording behind it.
      check(
        /not recorded/.test(text),
        'an unrecorded session is rejected with an explanatory message',
      )
    } else {
      check(status === 'applied', 'a seekable session acknowledges the seek as applied')
      check(sawCursorScopedState, 'applied seek delivered cursor-scoped state')
    }
    done.resolve()
  }
}

socket.onerror = () => {
  failures.push('websocket error')
  done.resolve()
}

setTimeout(() => done.resolve(), 6000)
await done.promise
socket.close()

check(
  liveEnvelopeWithCursor === 0,
  `live envelopes carry no cursor id (${liveEnvelopesSeen} seen, ${liveEnvelopeWithCursor} tagged)`,
)

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`)
process.exit(failures.length === 0 ? 0 : 1)
