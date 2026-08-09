// MessagePack framing for the WebSocket transport.
//
// The host encodes with `rmp_serde::to_vec_named`, whose config reports
// `is_human_readable() == false`. Two consequences drive everything here:
//
//   1. Structs are maps with string keys, and enum variants are strings, so
//      the decoded shape matches `protocol/types.ts` directly.
//   2. `Uuid` is *not* a string. It serialises as its 16 raw bytes, which
//      decode to a `Uint8Array`. Nothing else in the protocol carries a byte
//      string, so a blanket 16-byte-array-to-uuid conversion on decode is
//      unambiguous. Encoding converts back explicitly at the few known sites.

import { decode as decodeMsgpack, encode as encodeMsgpack } from '@msgpack/msgpack'

import type { ClientMessage, ServerMessage, Uuid } from './types'

const HEX: string[] = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, '0'),
)

export function uuidFromBytes(bytes: Uint8Array): Uuid {
  let out = ''
  for (let index = 0; index < 16; index += 1) {
    out += HEX[bytes[index]]
    if (index === 3 || index === 5 || index === 7 || index === 9) out += '-'
  }
  return out
}

export function uuidToBytes(uuid: Uuid): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  if (hex.length !== 32) throw new Error(`not a uuid: ${uuid}`)
  const bytes = new Uint8Array(16)
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

export function randomUuid(): Uuid {
  // `crypto.randomUUID` needs a secure context; the host may well be served
  // over plain HTTP on the bench, so fall back to a v4 built from random bytes.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return uuidFromBytes(bytes)
}

export const NIL_UUID: Uuid = '00000000-0000-0000-0000-000000000000'

/** Recursively rewrite 16-byte arrays as uuid strings. */
function reviveUuids(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return value.length === 16 ? uuidFromBytes(value) : value
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = reviveUuids(value[index])
    }
    return value
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      record[key] = reviveUuids(record[key])
    }
    return record
  }
  return value
}

export function decodeServerMessage(frame: ArrayBuffer | Uint8Array): ServerMessage {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame)
  return reviveUuids(decodeMsgpack(bytes)) as ServerMessage
}

/**
 * Rewrite the uuid-typed fields of a client message into raw bytes. The set of
 * uuid positions is small and fixed, so this stays explicit rather than
 * guessing from string shape — a workstation label that happened to look like a
 * uuid must not be re-encoded as bytes.
 */
function toWire(message: ClientMessage): unknown {
  if (message.type === 'ping') return message

  const command = message.data
  const origin = command.origin
  const action = command.action

  const wireAction: Record<string, unknown> = { type: action.type }
  switch (action.type) {
    case 'set_viewer_cursor':
      wireAction.data = {
        ...action.data,
        id: uuidToBytes(action.data.id),
        session_id: uuidToBytes(action.data.session_id),
      }
      break
    case 'set_session_lifecycle':
    case 'add_bookmark':
    case 'add_annotation':
    case 'start_recording':
    case 'stop_recording':
    case 'export':
      wireAction.data = {
        ...action.data,
        session_id: uuidToBytes(action.data.session_id),
      }
      break
    default:
      // `system` and `create_session` carry no uuid of their own.
      if ('data' in action) wireAction.data = action.data
      break
  }

  return {
    type: 'command',
    data: {
      id: uuidToBytes(command.id),
      origin: {
        ...origin,
        browser_instance_id: uuidToBytes(origin.browser_instance_id),
        session_id: origin.session_id ? uuidToBytes(origin.session_id) : null,
        viewer_cursor_id: origin.viewer_cursor_id
          ? uuidToBytes(origin.viewer_cursor_id)
          : null,
      },
      action: wireAction,
    },
  }
}

export function encodeClientMessage(message: ClientMessage): Uint8Array {
  return encodeMsgpack(toWire(message))
}
