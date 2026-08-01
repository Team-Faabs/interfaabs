import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { decode as decodeMsgpack } from '@msgpack/msgpack'

import { encodeClientMessage, uuidFromBytes, uuidToBytes } from './codec'

const UUID = '9f1c2d3e-4a5b-6c7d-8e9f-a0b1c2d3e4f5'

describe('uuid encoding', () => {
  it('round-trips through raw bytes', () => {
    assert.equal(uuidFromBytes(uuidToBytes(UUID)), UUID)
  })

  it('produces the 16 bytes rmp-serde expects, not a string', () => {
    const bytes = uuidToBytes(UUID)
    assert.equal(bytes.length, 16)
    assert.equal(bytes[0], 0x9f)
    assert.equal(bytes[15], 0xf5)
  })

  it('rejects something that is not a uuid', () => {
    assert.throws(() => uuidToBytes('bench-left'), /not a uuid/)
  })
})

describe('client message encoding', () => {
  const origin = {
    browser_instance_id: UUID,
    panel_id: 'field',
    session_id: UUID,
    viewer_cursor_id: null,
    client_sequence: 7,
    // A label that looks like a uuid must stay a string.
    workstation_label: UUID,
  }

  it('encodes command and origin uuids as binary and leaves labels alone', () => {
    const encoded = encodeClientMessage({
      type: 'command',
      data: {
        id: UUID,
        origin,
        action: {
          type: 'system',
          data: {
            system_id: 'simhark',
            command: { type: 'simhark', data: { type: 'pause' } },
          },
        },
      },
    })

    const decoded = decodeMsgpack(encoded) as {
      type: string
      data: {
        id: unknown
        origin: Record<string, unknown>
        action: { type: string; data: Record<string, unknown> }
      }
    }

    assert.equal(decoded.type, 'command')
    assert.ok(decoded.data.id instanceof Uint8Array, 'command id must be bytes')
    assert.equal((decoded.data.id as Uint8Array).length, 16)
    assert.ok(decoded.data.origin.browser_instance_id instanceof Uint8Array)
    assert.ok(decoded.data.origin.session_id instanceof Uint8Array)
    assert.equal(decoded.data.origin.viewer_cursor_id, null)
    assert.equal(
      decoded.data.origin.workstation_label,
      UUID,
      'a uuid-shaped label must not be re-encoded as bytes',
    )
  })

  it('keeps the adjacent enum tagging the host expects', () => {
    const encoded = encodeClientMessage({
      type: 'command',
      data: {
        id: UUID,
        origin: { ...origin, session_id: null },
        action: {
          type: 'system',
          data: {
            system_id: 'crashpilot',
            command: { type: 'crash_pilot', data: { type: 'halt_all' } },
          },
        },
      },
    })

    const decoded = decodeMsgpack(encoded) as {
      data: { action: { type: string; data: { command: { type: string; data?: unknown } } } }
    }

    assert.equal(decoded.data.action.type, 'system')
    assert.equal(decoded.data.action.data.command.type, 'crash_pilot')
    // Unit variants carry a tag and no `data`, which is what serde's adjacent
    // tagging produces and what the host's deserialiser accepts.
    assert.deepEqual(decoded.data.action.data.command.data, { type: 'halt_all' })
  })

  it('encodes session-scoped actions with a binary session id', () => {
    const encoded = encodeClientMessage({
      type: 'command',
      data: {
        id: UUID,
        origin,
        action: { type: 'start_recording', data: { session_id: UUID } },
      },
    })
    const decoded = decodeMsgpack(encoded) as {
      data: { action: { data: { session_id: unknown } } }
    }
    assert.ok(decoded.data.action.data.session_id instanceof Uint8Array)
  })

  it('leaves a ping untouched', () => {
    const decoded = decodeMsgpack(
      encodeClientMessage({ type: 'ping', data: { nonce: 42 } }),
    ) as { type: string; data: { nonce: number } }
    assert.equal(decoded.type, 'ping')
    assert.equal(decoded.data.nonce, 42)
  })
})
