// End-to-end check of the browser wire contract against a running host.
//
//   node --experimental-strip-types scripts/protocol-smoke.ts [http://127.0.0.1:8080]
//
// It exercises the parts of the codec that are easy to get silently wrong:
// the JSON handshake, named-MessagePack framing, and — above all — that a
// `Uuid` travels as 16 raw bytes rather than a string, in both directions.

import { decodeServerMessage, encodeClientMessage, randomUuid } from '../src/protocol/codec.ts'
import { PROTOCOL_VERSION } from '../src/protocol/types.ts'
import type { Bootstrap, ServerControl, ServerMessage } from '../src/protocol/types.ts'

const base = process.argv[2] ?? 'http://127.0.0.1:8080'
const browserInstanceId = randomUuid()

const failures: string[] = []
function check(condition: boolean, description: string): void {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${description}`)
  if (!condition) failures.push(description)
}

const bootstrap = (await (await fetch(`${base}/api/v1/bootstrap`)).json()) as Bootstrap
check(bootstrap.protocol_version === PROTOCOL_VERSION, 'bootstrap protocol version matches')
check(typeof bootstrap.asset_build_fingerprint === 'string', 'bootstrap carries an asset fingerprint')
check(Array.isArray(bootstrap.systems), 'bootstrap carries systems')

const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/api/v1/ws`)
socket.binaryType = 'arraybuffer'

const done = Promise.withResolvers<void>()
let handshaken = false
let sawInitialState = false
let commandId = ''

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
    check(control.type === 'hello_accepted', `handshake accepted (got ${control.type})`)
    if (control.type !== 'hello_accepted') {
      console.log('   ', JSON.stringify(control.data))
      done.resolve()
      return
    }
    handshaken = true
    return
  }

  const message = decodeServerMessage(event.data as ArrayBuffer) as ServerMessage

  if (message.type === 'initial_state') {
    sawInitialState = true
    check(true, 'initial_state decoded from named MessagePack')
    const session = message.data.sessions[0]
    if (session) {
      check(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session.id),
        `session id decoded as a uuid string (${session.id})`,
      )
    }

    // The real test of the encoder: a command whose id and origin carry uuids.
    // rmp-serde rejects a string where `Uuid` expects bytes, so an accepted
    // acknowledgement proves the byte encoding is right.
    const system = message.data.systems.find((entry) => entry.kind === 'crash_pilot')
    commandId = randomUuid()
    socket.send(
      encodeClientMessage({
        type: 'command',
        data: {
          id: commandId,
          origin: {
            browser_instance_id: browserInstanceId,
            panel_id: 'protocol-smoke',
            session_id: session?.id ?? null,
            viewer_cursor_id: null,
            client_sequence: 1,
            workstation_label: 'smoke-test',
          },
          action: system
            ? {
                type: 'system',
                data: {
                  system_id: system.id,
                  command: { type: 'crash_pilot', data: { type: 'stop_all' } },
                },
              }
            : { type: 'start_recording', data: { session_id: session!.id } },
        },
      }),
    )
    socket.send(encodeClientMessage({ type: 'ping', data: { nonce: 42 } }))
  }

  if (message.type === 'command_acknowledgement') {
    check(
      message.data.command_id === commandId,
      `acknowledgement carries the command uuid back (${message.data.status}: ${message.data.message || 'no message'})`,
    )
    check(
      message.data.status !== 'rejected' || !message.data.message.includes('MessagePack'),
      'command was not rejected as an undecodable frame',
    )
  }

  if (message.type === 'pong') {
    check(message.data.nonce === 42, 'pong echoes the ping nonce')
    done.resolve()
  }
}

socket.onerror = () => {
  failures.push('websocket error')
  done.resolve()
}

setTimeout(() => done.resolve(), 5000)
await done.promise
socket.close()

check(handshaken, 'handshake completed')
check(sawInitialState, 'initial state received')

console.log(failures.length === 0 ? '\nall checks passed' : `\n${failures.length} check(s) failed`)
process.exit(failures.length === 0 ? 0 : 1)
