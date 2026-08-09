import { useState } from 'react'
import './shell.css'
import Field from '../../shared/Field'
import * as F from '../../fixtures'

const THEME = {
  pitch: '#0d3b2a',
  boundary: '#071a13',
  line: 'rgba(223,243,234,0.82)',
  blue: '#4d8dff',
  yellow: '#ffd23f',
  ball: '#ff7a3c',
  target: '#a78bfa',
  kick: '#32d7c4',
  select: '#ffffff',
  uncertain: '#ffd23f',
  velocity: 'rgba(255,255,255,0.62)',
  robotEdge: 'rgba(3,12,8,0.5)',
  robotLabel: '#08131f',
  heat: '#ff5f6d',
  zone: '#5f76ff',
  keepout: 'rgba(255,255,255,0.5)',
  fieldText: 'rgba(226,240,235,0.85)',
  alert: '#ff5f6d',
}

export default function Evolved() {
  const [review, setReview] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(true)
  const [leftTab, setLeftTab] = useState('layers')
  const [rightTab, setRightTab] = useState('properties')
  const [bottomTab, setBottomTab] = useState('feed')

  return (
    <div className={`ev ${review ? 'ev--review' : 'ev--live'}`}>
      {/* ═══ toolbar ═══════════════════════════════════ */}
      <header className="ev-toolbar">
        <div className="ev-brand">
          <span className="ev-dot" />
          interfaabs
        </div>

        <button className="ev-chip ev-chip--session">
          <b>{F.session.blue}</b> vs <b>{F.session.yellow}</b>
        </button>

        <div className="ev-seg ev-seg--workspace">
          <button>Start</button>
          <button className="on">Live Ops</button>
          <button>Replay</button>
        </div>

        <div className="ev-sep" />

        <div className="ev-transport">
          <button title="Step back">⏮</button>
          <button className="ev-play" title="Pause">⏸</button>
          <button title="Step forward">⏭</button>
        </div>
        <button className="ev-chip">{F.session.speed}</button>

        <button
          className={`ev-live-toggle ${review ? 'is-review' : ''}`}
          onClick={() => setReview((v) => !v)}
        >
          <span className="ev-live-dot" />
          {review ? 'REVIEWING' : 'LIVE'}
        </button>
        {review && <button className="ev-return">Return to Live</button>}

        <div className="ev-sep" />

        <button className="ev-chip ev-chip--rec">
          <span className="ev-rec-dot" />
          REC · 4:12
        </button>
        <button className="ev-chip">Export</button>

        <div className="ev-spacer" />

        <div className="ev-health">
          {F.health.slice(0, 3).map((h) => (
            <span key={h.label} className={h.ok ? '' : 'bad'}>
              <i>{h.label}</i>
              {h.value}
            </span>
          ))}
        </div>

        {/* Evolved places the emergency pair at the toolbar's trailing edge:
            always visible, never scrolled, furthest from the field mouse. */}
        <div className="ev-emergency">
          <button className="ev-halt">Halt All</button>
          <button className="ev-stop">Stop All</button>
        </div>
      </header>

      {/* ═══ body ══════════════════════════════════════ */}
      <div className="ev-body">
        {/* ── left rail: collapsed ── */}
        <nav className="ev-rail">
          {F.leftTabs.map((t) => (
            <button
              key={t.id}
              className={leftOpen && leftTab === t.id ? 'on' : ''}
              title={t.label}
              onClick={() => {
                if (leftOpen && leftTab === t.id) setLeftOpen(false)
                else {
                  setLeftTab(t.id)
                  setLeftOpen(true)
                }
              }}
            >
              <span>{t.icon}</span>
              <em>{t.label}</em>
            </button>
          ))}
        </nav>

        {leftOpen && (
          <aside className="ev-dock ev-dock--left">
            <div className="ev-dock-head">
              {F.leftTabs.find((t) => t.id === leftTab).label}
              <button onClick={() => setLeftOpen(false)}>×</button>
            </div>
            <div className="ev-dock-body">
              {F.debugLayers.map((g) => (
                <div className="ev-layer-group" key={g.group}>
                  <div className="ev-layer-head">▾ {g.group}</div>
                  {g.layers.map((l) => (
                    <label className="ev-layer" key={l.id}>
                      <input type="checkbox" defaultChecked={l.on} />
                      <span>{l.name}</span>
                      <i>{l.count}</i>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* ── field ── */}
        <main className="ev-field">
          <div className="ev-field-bar">
            <div className="ev-seg">
              <button className="on">Focus</button>
              <button>Grid</button>
              <button>Compare</button>
            </div>
            <div className="ev-seg">
              <button>Flip X</button>
              <button className="on">Flip Y</button>
            </div>
            <div className="ev-spacer" />
            <div className="ev-legend">
              <span><i style={{ background: THEME.blue }} />Blue</span>
              <span><i style={{ background: THEME.yellow }} />Yellow</span>
              <span><i style={{ background: THEME.ball }} />Ball</span>
              <span><i style={{ background: THEME.target }} />Target</span>
              <span><i style={{ background: THEME.kick }} />Kick</span>
            </div>
            <button className="ev-chip">Fit</button>
          </div>

          <div className="ev-canvas">
            <Field theme={THEME} review={review} />

            <div className="ev-alerts">
              {F.alerts.map((a) => (
                <div className="ev-alert" key={a.title}>
                  <b>{a.title}</b>
                  <span>{a.body}</span>
                </div>
              ))}
            </div>

            {review && <div className="ev-review-veil">REVIEWING · commands disabled</div>}
          </div>
        </main>

        {/* ── right dock: expanded ── */}
        {rightOpen && (
          <aside className="ev-dock ev-dock--right">
            <div className="ev-dock-tabs">
              {F.rightTabs.map((t) => (
                <button
                  key={t.id}
                  className={rightTab === t.id ? 'on' : ''}
                  onClick={() => (rightTab === t.id ? setRightOpen(false) : setRightTab(t.id))}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="ev-dock-body">
              <div className="ev-sel">
                <span className="ev-sel-badge">B3</span>
                <div>
                  <b>bangka · robot 3</b>
                  <i>−520, 340 mm · 51.6° · conf 0.99</i>
                </div>
              </div>

              <div className="ev-props">
                {F.properties.map((p) => (
                  <label className="ev-prop" key={p.label}>
                    <span>{p.label}</span>
                    {p.control === 'toggle' ? (
                      <input type="checkbox" defaultChecked={!!p.value} />
                    ) : p.control === 'select' ? (
                      <select defaultValue={p.value}>
                        <option>{p.value}</option>
                      </select>
                    ) : (
                      <input defaultValue={p.value} placeholder="—" />
                    )}
                  </label>
                ))}
              </div>

              <div className="ev-preview">
                <span>FREE · POS → 980, 1250</span>
                <button className="ev-send" disabled={review}>
                  Send
                </button>
              </div>

              <div className="ev-group-title">Global options</div>
              <div className="ev-kv">
                {F.globalOptions.map((o) => (
                  <div key={o.label}>
                    <span>{o.label}</span>
                    <b>{o.value}</b>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        )}

        <nav className="ev-rail ev-rail--right">
          {F.rightTabs.map((t) => (
            <button
              key={t.id}
              className={rightOpen && rightTab === t.id ? 'on' : ''}
              title={t.label}
              onClick={() => {
                if (rightOpen && rightTab === t.id) setRightOpen(false)
                else {
                  setRightTab(t.id)
                  setRightOpen(true)
                }
              }}
            >
              <span>{t.icon}</span>
              <em>{t.label}</em>
            </button>
          ))}
        </nav>
      </div>

      {/* ═══ bottom dock ═══════════════════════════════ */}
      <section className="ev-bottom">
        <div className="ev-timeline">
          <span className="ev-tl-time">00:00</span>
          <div className="ev-tl-track">
            <div className="ev-tl-fill" style={{ width: `${F.playhead * 100}%` }} />
            {F.timeline.map((e) => (
              <i
                key={e.id}
                className={`ev-tl-ev ev-tl-ev--${e.kind}`}
                style={{ left: `${e.at * 100}%` }}
                title={e.label}
              />
            ))}
            <div
              className="ev-tl-head"
              style={{ left: `${(review ? F.reviewHead : F.playhead) * 100}%` }}
            />
          </div>
          <span className="ev-tl-time">{F.session.simTime}</span>
        </div>

        <div className="ev-bottom-tabs">
          {F.bottomTabs.map((t) => (
            <button
              key={t.id}
              className={bottomTab === t.id ? 'on' : ''}
              onClick={() => setBottomTab(t.id)}
            >
              {t.label}
              {t.badge != null && <i>{t.badge}</i>}
            </button>
          ))}
          <div className="ev-spacer" />
          <span className="ev-muted">
            last command · {F.session.lastCommand.workstation} / {F.session.lastCommand.panel} ·{' '}
            {F.session.lastCommand.ago}
          </span>
        </div>

        <div className="ev-bottom-body">
          {bottomTab === 'feed' && (
            <table className="ev-table">
              <tbody>
                {F.commandFeed.map((c, i) => (
                  <tr key={i} className={c.status === 'error' ? 'err' : ''}>
                    <td className="num">{c.t}</td>
                    <td className="tag">{c.robot}</td>
                    <td>{c.body}</td>
                    <td className="dim">{c.origin}</td>
                    <td className="num">{c.rtt}</td>
                    <td className={`ev-st ev-st--${c.status}`}>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {bottomTab === 'tasks' && (
            <table className="ev-table">
              <thead>
                <tr>
                  <th>Robot</th><th>State</th><th>Task</th><th>Target</th>
                  <th>Speed</th><th>Conf</th><th>Age</th>
                </tr>
              </thead>
              <tbody>
                {F.robots.map((r) => (
                  <tr key={r.team + r.id} className={r.selected ? 'sel' : r.ignored ? 'err' : ''}>
                    <td className="tag">{r.team === 'blue' ? 'B' : 'Y'}{r.id}</td>
                    <td>{F.short(r.state)}</td>
                    <td>{F.short(r.task)}</td>
                    <td className="num">{r.target ? `${r.target.x}, ${r.target.y}` : '—'}</td>
                    <td className="num">{r.speed.toFixed(1)}</td>
                    <td className="num">{r.conf.toFixed(2)}</td>
                    <td className="num">{r.age} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {bottomTab === 'referee' && (
            <div className="ev-ref">
              <div><span>Stage</span><b>{F.referee.stage}</b></div>
              <div><span>Command</span><b>{F.referee.command}</b></div>
              <div><span>Score</span><b>{F.referee.scoreBlue} — {F.referee.scoreYellow}</b></div>
              <div><span>Timeouts blue</span><b>{F.referee.timeoutsBlue}</b></div>
              <div><span>Timeouts yellow</span><b>{F.referee.timeoutsYellow}</b></div>
              <div><span>Cards</span><b>yellow · 01:47</b></div>
              <div><span>Placement</span><b>{F.referee.placement}</b></div>
              <div><span>Packet age</span><b>{F.referee.packetAge}</b></div>
            </div>
          )}
        </div>
      </section>

      {/* ═══ status bar ════════════════════════════════ */}
      <footer className="ev-status">
        <span>frame <b>#{F.session.frame.toLocaleString()}</b></span>
        <span>sim <b>{F.session.simTime}</b></span>
        <span>{F.session.division}</span>
        <span>vision <b>{F.session.visionSource}</b></span>
        <div className="ev-spacer" />
        <span>{F.session.clients} clients</span>
        <button className="ev-token" title="Copy debug token">
          ⧉ {F.debugToken}
        </button>
      </footer>
    </div>
  )
}
