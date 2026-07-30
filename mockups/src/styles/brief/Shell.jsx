import { useState } from 'react'
import './shell.css'
import Field from '../../shared/Field'
import * as F from '../../fixtures'

// ═══════════════════════════════════════════════════════
// Style F — Brief
// Same information as A/B/C, but never all at once. Navigation is a
// single segmented control naming the three jobs — Operate, Review,
// Diagnose — and each one shows only the two companion panels that job
// needs. Nothing is hidden behind a tab the operator has to remember;
// it is hidden behind the job they are already doing.
// ═══════════════════════════════════════════════════════

const THEME = {
  pitch: '#252c26',
  boundary: '#191e1a',
  line: 'rgba(240,236,227,0.4)',
  blue: '#7aa5e8',
  yellow: '#dfb05c',
  ball: '#e8834a',
  target: '#b295e0',
  kick: '#6fbf8b',
  select: '#f5f1e8',
  uncertain: '#dfb05c',
  velocity: 'rgba(245,241,232,0.32)',
  robotEdge: '#12140f',
  robotLabel: '#12140f',
  heat: '#e0705c',
  zone: '#7aa5e8',
  keepout: 'rgba(245,241,232,0.24)',
  fieldText: 'rgba(240,236,227,0.5)',
  alert: '#e0705c',
}

const WORKSPACES = [
  { id: 'operate', label: 'Operate', hint: 'command the squad' },
  { id: 'review', label: 'Review', hint: 'scrub the recording' },
  { id: 'diagnose', label: 'Diagnose', hint: 'inspect the stack' },
]

// Each job draws only the overlays that job reads.
const OVERLAYS = {
  operate: { heat: false, zone: false, keepout: false, hologram: false },
  review: { heat: false, keepout: false, trajectory: false, hologram: false, kick: false },
  diagnose: { heat: false, trajectory: false, kick: false, prediction: false },
}

export default function Brief({ params }) {
  const initial = params?.get('ws')
  const [ws, setWs] = useState(
    WORKSPACES.some((w) => w.id === initial) ? initial : 'operate',
  )
  const review = ws === 'review'

  return (
    <div className={`br br--${ws}`}>
      {/* ═══ header: identity, the one navigation control, halt ═══ */}
      <header className="br-top">
        <div className="br-id">
          <b>
            {F.session.blue} <span>vs</span> {F.session.yellow}
          </b>
          <em>
            {F.session.division} · {F.session.simTime}
          </em>
        </div>

        <nav className="br-seg">
          {WORKSPACES.map((w) => (
            <button key={w.id} className={ws === w.id ? 'on' : ''} onClick={() => setWs(w.id)}>
              {w.label}
            </button>
          ))}
        </nav>

        <div className="br-right">
          <span className={`br-live ${review ? 'is-review' : ''}`}>
            <i />
            {review ? 'Reviewing' : 'Live'}
          </span>
          <button className="br-halt">Halt all</button>
        </div>
      </header>

      {/* ═══ one line of context for the chosen job ═══ */}
      <div className="br-subhead">
        <b>{WORKSPACES.find((w) => w.id === ws).label}</b>
        <span>{WORKSPACES.find((w) => w.id === ws).hint}</span>
        <div className="br-grow" />
        {ws === 'operate' && <span className="br-sub-note">1 robot selected · 12 tracked</span>}
        {ws === 'review' && <span className="br-sub-note">8 events · playhead 04:07.1</span>}
        {ws === 'diagnose' && <span className="br-sub-note br-sub-note--warn">2 warnings</span>}
      </div>

      <div className="br-body">
        {/* ═══ the field is the hero in every workspace ═══ */}
        <main className="br-stage">
          <Field
            theme={THEME}
            review={review}
            showLabels={false}
            overlays={OVERLAYS[ws]}
          />

          <div className="br-transport">
            <button>⏮</button>
            <button className="on">⏸</button>
            <button>⏭</button>
            <span className="br-vsep" />
            <button>{F.session.speed}</button>
          </div>

          {review && <span className="br-veil">Read-only</span>}
        </main>

        {/* ═══ exactly two companion panels, chosen by the job ═══ */}
        <aside className="br-side">
          {ws === 'operate' && (
            <>
              <div className="br-card br-card--lead">
                <div className="br-card-head">
                  <span className="br-chip">B3</span>
                  <div>
                    <b>bangka · robot 3</b>
                    <em>FREE · POS → 980, 1250</em>
                  </div>
                </div>
                <div className="br-form">
                  <label>
                    <span>State</span>
                    <select defaultValue="STATE_FREE">
                      <option>STATE_FREE</option>
                    </select>
                  </label>
                  <label>
                    <span>Task</span>
                    <select defaultValue="TASK_POS">
                      <option>TASK_POS</option>
                    </select>
                  </label>
                  <label>
                    <span>X (mm)</span>
                    <input defaultValue="980" />
                  </label>
                  <label>
                    <span>Y (mm)</span>
                    <input defaultValue="1250" />
                  </label>
                </div>
                <div className="br-formfoot">
                  <button className="br-ghost">More fields</button>
                  <button className="br-go">Send</button>
                </div>
              </div>

              <div className="br-card">
                <div className="br-card-title">
                  Squad<span>12</span>
                </div>
                <div className="br-rows">
                  {F.robots.map((r) => (
                    <div
                      className={`br-row ${r.selected ? 'sel' : ''} ${r.ignored ? 'err' : ''}`}
                      key={r.team + r.id}
                    >
                      <span className={`br-tag br-tag--${r.team}`}>
                        {r.team === 'blue' ? 'B' : 'Y'}
                        {r.id}
                      </span>
                      <span className="br-row-main">{F.short(r.task)}</span>
                      <span className="br-row-meta">
                        {r.ignored ? 'stale' : `${r.speed.toFixed(1)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {ws === 'review' && (
            <>
              <div className="br-card br-card--lead">
                <div className="br-card-title">Events</div>
                <div className="br-events">
                  {F.timeline.map((e) => (
                    <button className={`br-event br-event--${e.kind}`} key={e.id}>
                      <i />
                      <span className="br-event-label">{e.label}</span>
                      <span className="br-event-t">
                        {String(Math.floor(e.at * 12)).padStart(2, '0')}:
                        {String(Math.floor((e.at * 12 * 60) % 60)).padStart(2, '0')}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="br-card br-card--fit">
                <div className="br-card-title">At the playhead</div>
                <div className="br-kv">
                  <div>
                    <span>Score</span>
                    <b>
                      {F.referee.scoreBlue} — {F.referee.scoreYellow}
                    </b>
                  </div>
                  <div>
                    <span>Stage</span>
                    <b>Second half</b>
                  </div>
                  <div>
                    <span>Command</span>
                    <b>{F.referee.command}</b>
                  </div>
                  <div>
                    <span>Frame</span>
                    <b>1 704 220</b>
                  </div>
                </div>
                <button className="br-wide">Return to live</button>
              </div>
            </>
          )}

          {ws === 'diagnose' && (
            <>
              <div className="br-card br-card--lead">
                <div className="br-card-title">
                  Warnings<span>2</span>
                </div>
                {F.alerts.map((a) => (
                  <div className="br-warn" key={a.title}>
                    <b>{a.title}</b>
                    <span>{a.body}</span>
                  </div>
                ))}
              </div>

              <div className="br-card">
                <div className="br-card-title">Health</div>
                <div className="br-health">
                  {F.health.map((h) => (
                    <div className={h.ok ? '' : 'bad'} key={h.label}>
                      <i />
                      <span>{h.label}</span>
                      <b>{h.value}</b>
                    </div>
                  ))}
                </div>
                <div className="br-card-title br-card-title--sub">Recent commands</div>
                <div className="br-rows">
                  {F.commandFeed.slice(0, 6).map((c, i) => (
                    <div className={`br-row ${c.status === 'error' ? 'err' : ''}`} key={i}>
                      <span className="br-row-t">{c.t.slice(0, 8)}</span>
                      <span className="br-row-main">{c.body}</span>
                      <span className="br-row-meta">{c.rtt}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ═══ timeline, always present, always the same size ═══ */}
      <div className="br-timeline">
        <span>00:00</span>
        <div className="br-track">
          <div className="br-track-fill" style={{ width: `${F.playhead * 100}%` }} />
          {F.timeline.map((e) => (
            <i
              key={e.id}
              className={`br-ev br-ev--${e.kind}`}
              style={{ left: `${e.at * 100}%` }}
              title={e.label}
            />
          ))}
          <div
            className="br-playhead"
            style={{ left: `${(review ? F.reviewHead : F.playhead) * 100}%` }}
          />
        </div>
        <span>{F.session.simTime}</span>
        <button className="br-token">{F.debugToken}</button>
      </div>
    </div>
  )
}
