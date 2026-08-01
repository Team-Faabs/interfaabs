// Feed-shaped panels: the command feed with origin and acknowledgement, the
// event list, and the timeline with bookmarks and seeking.

import { useMemo, useState } from 'react'

import { useLiveTick, useMeta, usePrimaryWorld, useStore } from '../store/hooks'
import type { EntitySelection } from '../store/store'
import { Button, Empty, Segmented, TextInput } from '../ui/primitives'
import { canMutate, systemIdOfKind } from '../util/systems'
import { formatClockMs, formatNs, relativeTime } from '../util/format'
import './feeds.css'

export function CommandFeedPanel() {
  const store = useStore()
  const meta = useMeta()
  const [filter, setFilter] = useState('')

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle
      ? meta.feed.filter(
          (entry) =>
            entry.summary.toLowerCase().includes(needle) ||
            entry.panelId.toLowerCase().includes(needle) ||
            entry.message.toLowerCase().includes(needle),
        )
      : meta.feed
  }, [meta.feed, filter])

  return (
    <div className="fd">
      <div className="fd-bar">
        <TextInput
          placeholder="Filter commands…"
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value)}
        />
        <span className="fd-origin ui-dim">
          {meta.lastCommandOrigin
            ? `last · ${meta.lastCommandOrigin.workstation_label ?? 'unlabelled'} / ${
                meta.lastCommandOrigin.panel_id
              } · #${meta.lastCommandOrigin.client_sequence}`
            : 'no accepted command yet'}
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty
          title="No commands"
          hint="Every command issued from any connected browser appears here with its origin and the host's acknowledgement."
        />
      ) : (
        <div className="ui-scroll">
          <table className="ui-table">
            <tbody>
              {rows.map((entry) => (
                <tr
                  key={entry.commandId}
                  className={[
                    entry.status === 'rejected' || entry.status === 'failed' ? 'is-error' : '',
                    entry.target ? 'fd-selectable' : '',
                    entry.target && sameSelection(entry.target, meta.selection)
                      ? 'is-selected'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={entry.target ? 'Select this entity on the field' : undefined}
                  onClick={() => entry.target && store.setSelection(entry.target)}
                >
                  <td className="num fd-time">{formatClockMs(entry.at)}</td>
                  <td>{entry.summary}</td>
                  <td className="dim">
                    {entry.origin.workstation_label ?? '—'} / {entry.panelId}
                  </td>
                  <td className="num">{entry.rttMs === null ? '—' : `${entry.rttMs} ms`}</td>
                  <td className={statusClass(entry.status)}>{entry.status}</td>
                  <td className="dim fd-message">{entry.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function sameSelection(
  a: EntitySelection,
  b: EntitySelection | null,
): boolean {
  return (
    b !== null &&
    a.kind === b.kind &&
    a.worldId === b.worldId &&
    a.team === b.team &&
    a.robotId === b.robotId
  )
}

function statusClass(status: string): string {
  if (status === 'rejected' || status === 'failed') return 'bad'
  if (status === 'pending') return 'warn'
  return 'ok'
}

export function EventsPanel() {
  const meta = useMeta()
  const [kind, setKind] = useState<'all' | 'match' | 'problems'>('all')

  const rows = useMemo(() => {
    if (kind === 'match') {
      return meta.events.filter((event) => !event.kind.startsWith('lifecycle'))
    }
    if (kind === 'problems') {
      return meta.events.filter((event) => event.severity !== 'info')
    }
    return meta.events
  }, [meta.events, kind])

  return (
    <div className="fd">
      <div className="fd-bar">
        <Segmented
          size="sm"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: `All ${meta.events.length}` },
            { value: 'match', label: 'Match' },
            { value: 'problems', label: 'Problems' },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <Empty title="No events" hint="Referee decisions, lifecycle changes, bookmarks and data-loss markers land here." />
      ) : (
        <div className="ui-scroll">
          <table className="ui-table">
            <tbody>
              {[...rows].reverse().map((event) => (
                <tr key={event.id} className={event.severity === 'error' ? 'is-error' : ''}>
                  <td className="num fd-time">{formatNs(event.at_ns)}</td>
                  <td className="tag">{event.kind}</td>
                  <td>{event.label}</td>
                  <td className="dim">
                    {event.worldId === null ? '' : `world ${event.worldId}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * Timeline and transport. The head detaches from the live head as soon as the
 * operator scrubs, which is what puts the whole shell into review.
 */
export function TimelinePanel() {
  const store = useStore()
  const meta = useMeta()
  const world = usePrimaryWorld()
  useLiveTick()

  const session = meta.sessions.find((entry) => entry.id === meta.activeSessionId) ?? null
  const liveFrame = session?.live_frame ?? world?.frame ?? 0
  const cursorFrame = meta.cursor?.live === false ? (meta.cursor.frame ?? 0) : liveFrame
  const simharkId = systemIdOfKind(meta, 'simhark')
  const mutable = canMutate(meta)
  const [bookmarkLabel, setBookmarkLabel] = useState('')

  const seek = (frame: number) => {
    if (!session) return
    store.setLive('timeline', false, frame)
    if (simharkId) {
      store.send('timeline', {
        type: 'system',
        data: {
          system_id: simharkId,
          command: { type: 'simhark', data: { type: 'seek', data: { frame } } },
        },
      })
    }
  }

  if (!session) {
    return <Empty title="No session" hint="Open a session to scrub its timeline." />
  }

  const progress = liveFrame > 0 ? cursorFrame / liveFrame : 0
  const spanNs = store.nowSimNs()

  return (
    <div className="tl">
      <div className="tl-row">
        <span className="ui-mono tl-time">frame {cursorFrame.toLocaleString()}</span>
        <div
          className="tl-track"
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
            seek(Math.round(ratio * liveFrame))
          }}
        >
          <div className="tl-fill" style={{ width: `${progress * 100}%` }} />
          {meta.events.map((event) => {
            // Events carry simulation time; the newest world's simulation time
            // is the right edge of the track. Guard the first frames, when the
            // span is still zero.
            const at = spanNs > 0 ? Math.max(0, Math.min(1, event.at_ns / spanNs)) : 0
            return (
              <i
                key={event.id}
                className={`tl-ev tl-ev--${event.severity}`}
                style={{ left: `${at * 100}%` }}
                title={event.label}
              />
            )
          })}
          <div className="tl-head" style={{ left: `${progress * 100}%` }} />
        </div>
        <span className="ui-mono tl-time">
          {world ? formatNs(world.simulation_time_ns) : '—'}
        </span>
      </div>

      <div className="tl-row tl-row--actions">
        {meta.cursor?.live === false ? (
          <Button tone="warn" size="sm" onClick={() => store.setLive('timeline', true)}>
            Return to live
          </Button>
        ) : (
          <span className="ui-dim tl-note">Following the live head</span>
        )}
        <div className="ui-grow" />
        <TextInput
          placeholder="Bookmark label…"
          value={bookmarkLabel}
          onChange={(event) => setBookmarkLabel(event.currentTarget.value)}
        />
        <Button
          size="sm"
          disabled={!mutable || bookmarkLabel.trim() === ''}
          onClick={() => {
            store.send('timeline', {
              type: 'add_bookmark',
              data: { session_id: session.id, frame: cursorFrame, label: bookmarkLabel.trim() },
            })
            setBookmarkLabel('')
          }}
        >
          Bookmark
        </Button>
        <Button
          size="sm"
          disabled={!mutable || bookmarkLabel.trim() === ''}
          onClick={() => {
            store.send('timeline', {
              type: 'add_annotation',
              data: { session_id: session.id, frame: cursorFrame, text: bookmarkLabel.trim() },
            })
            setBookmarkLabel('')
          }}
        >
          Annotate
        </Button>
      </div>
    </div>
  )
}

export function AlertsList() {
  const store = useStore()
  const meta = useMeta()
  if (meta.alerts.length === 0) {
    return <Empty title="No alerts" hint="Health, recording and data-loss problems appear here." />
  }
  return (
    <div className="ui-scroll">
      {meta.alerts.map((alert) => (
        <div key={alert.id} className={`fd-alert fd-alert--${alert.level}`}>
          <div>
            <b>{alert.title}</b>
            <span>{alert.body}</span>
            <i>{relativeTime(alert.at)}</i>
          </div>
          <button onClick={() => store.dismissAlert(alert.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
