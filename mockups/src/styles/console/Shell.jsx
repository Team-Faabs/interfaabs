import { useState } from 'react'
import './shell.css'
import Field from '../../shared/Field'
import * as F from '../../fixtures'

const THEME = {
  pitch: '#0f1512',
  boundary: '#080a09',
  line: 'rgba(255,255,255,0.5)',
  blue: '#3d7fd6',
  yellow: '#e8c33a',
  ball: '#ff8c2b',
  target: '#ffb020',
  kick: '#4fd6c4',
  select: '#ffffff',
  uncertain: '#ffb020',
  velocity: 'rgba(255,255,255,0.48)',
  robotEdge: '#05070a',
  robotLabel: '#07090b',
  heat: '#ff3b30',
  zone: '#5a7fa8',
  keepout: 'rgba(255,255,255,0.32)',
  fieldText: 'rgba(255,255,255,0.6)',
  alert: '#ff3b30',
}

const L = ({ children }) => <span className="cn-l">{children}</span>

export default function Console() {
  const [review, setReview] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(true)
  const [leftTab, setLeftTab] = useState('layers')
  const [rightTab, setRightTab] = useState('properties')
  const [bottomTab, setBottomTab] = useState('feed')

  return (
    <div className={`cn ${review ? 'cn--review' : 'cn--live'}`}>
      {/* ═══ toolbar ═══════════════════════════════════ */}
      <header className="cn-toolbar">
        {/* Console puts the emergency pair at the leading edge: first thing
            the hand reaches, fixed position, never moves. */}
        <div className="cn-emergency">
          <button className="cn-halt">HALT ALL</button>
          <button className="cn-stop">STOP ALL</button>
        </div>

        <div className="cn-field-set">
          <L>SESSION</L>
          <b>{F.session.blue} · {F.session.yellow}</b>
        </div>
        <div className="cn-field-set">
          <L>ID</L>
          <b className="mono">{F.session.id}</b>
        </div>

        <div className="cn-tabs cn-tabs--ws">
          <button>START</button>
          <button className="on">LIVE OPS</button>
          <button>REPLAY</button>
        </div>

        <div className="cn-field-set">
          <L>TRANSPORT</L>
          <div className="cn-btns">
            <button>◀◀</button>
            <button className="on">❚❚</button>
            <button>▶▶</button>
            <button>{F.session.speed}</button>
          </div>
        </div>

        <button
          className={`cn-mode ${review ? 'is-review' : ''}`}
          onClick={() => setReview((v) => !v)}
        >
          {review ? 'REVIEW' : 'LIVE'}
        </button>
        {review && <button className="cn-return">RETURN TO LIVE</button>}

        <div className="cn-field-set">
          <L>REC</L>
          <b className="mono cn-rec">● 04:12 · 218 MB</b>
        </div>
        <button className="cn-btn">EXPORT</button>

        <div className="cn-spacer" />

        <div className="cn-health">
          {F.health.slice(0, 4).map((h) => (
            <div key={h.label} className={h.ok ? '' : 'bad'}>
              <L>{h.label}</L>
              <b className="mono">{h.value}</b>
            </div>
          ))}
        </div>
      </header>

      {/* ═══ alert strip — a fixed row, not a floating toast ═══ */}
      <div className="cn-alertbar">
        {F.alerts.map((a) => (
          <div className="cn-alert" key={a.title}>
            <span className="cn-alert-tag">WARN</span>
            <b>{a.title}</b>
            <span className="cn-alert-body">{a.body}</span>
          </div>
        ))}
        <div className="cn-spacer" />
        <span className="cn-alert-count">2 active · 0 acknowledged</span>
      </div>

      {/* ═══ body ══════════════════════════════════════ */}
      <div className="cn-body">
        <nav className="cn-rail">
          {F.leftTabs.map((t) => (
            <button
              key={t.id}
              className={leftOpen && leftTab === t.id ? 'on' : ''}
              title={t.label}
              onClick={() => {
                if (leftOpen && leftTab === t.id) setLeftOpen(false)
                else { setLeftTab(t.id); setLeftOpen(true) }
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {leftOpen && (
          <aside className="cn-dock cn-dock--left">
            <div className="cn-dock-head">
              <L>{F.leftTabs.find((t) => t.id === leftTab).label}</L>
              <button onClick={() => setLeftOpen(false)}>×</button>
            </div>
            <div className="cn-dock-body">
              {F.debugLayers.map((g) => (
                <div key={g.group}>
                  <div className="cn-grp">{g.group}</div>
                  {g.layers.map((l) => (
                    <label className="cn-layer" key={l.id}>
                      <input type="checkbox" defaultChecked={l.on} />
                      <span>{l.name}</span>
                      <b className="mono">{l.count}</b>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        )}

        <main className="cn-field">
          <div className="cn-field-bar">
            <div className="cn-tabs">
              <button className="on">FOCUS</button>
              <button>GRID</button>
              <button>COMPARE</button>
            </div>
            <div className="cn-tabs">
              <button>FLIP X</button>
              <button className="on">FLIP Y</button>
              <button>FIT</button>
            </div>
            <div className="cn-spacer" />
            <div className="cn-readout">
              <span><L>BALL</L><b className="mono">120, −60</b></span>
              <span><L>|V|</L><b className="mono">1.96 m/s</b></span>
              <span><L>SEL</L><b className="mono">B3</b></span>
              <span><L>CURSOR</L><b className="mono">−1840, 902</b></span>
            </div>
          </div>
          <div className="cn-canvas">
            <Field theme={THEME} review={review} />
            {review && <div className="cn-veil">REVIEW · COMMANDS REJECTED SERVER-SIDE</div>}
          </div>
        </main>

        {rightOpen && (
          <aside className="cn-dock cn-dock--right">
            <div className="cn-tabs cn-tabs--dock">
              {F.rightTabs.map((t) => (
                <button
                  key={t.id}
                  className={rightTab === t.id ? 'on' : ''}
                  onClick={() => (rightTab === t.id ? setRightOpen(false) : setRightTab(t.id))}
                >
                  {t.label.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="cn-dock-body">
              <div className="cn-selbar">
                <span className="cn-selid">B3</span>
                <span className="mono">−520, 340 · 51.6° · c0.99 · 8 ms</span>
              </div>

              <div className="cn-grp">COMMAND</div>
              <div className="cn-props">
                {F.properties.map((p) => (
                  <label className="cn-prop" key={p.label}>
                    <L>{p.label}</L>
                    {p.control === 'toggle' ? (
                      <input type="checkbox" defaultChecked={!!p.value} />
                    ) : p.control === 'select' ? (
                      <select defaultValue={p.value}><option>{p.value}</option></select>
                    ) : (
                      <input className="mono" defaultValue={p.value} placeholder="—" />
                    )}
                  </label>
                ))}
              </div>

              <div className="cn-preview">
                <code>FREE · POS  x=980 y=1250 θ=35.5</code>
                <button className="cn-send" disabled={review}>SEND</button>
              </div>

              <div className="cn-grp">GLOBAL</div>
              <table className="cn-kv">
                <tbody>
                  {F.globalOptions.map((o) => (
                    <tr key={o.label}>
                      <td><L>{o.label}</L></td>
                      <td className="mono">{o.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="cn-grp">REFEREE</div>
              <table className="cn-kv">
                <tbody>
                  <tr><td><L>Stage</L></td><td className="mono">{F.referee.stage}</td></tr>
                  <tr><td><L>Command</L></td><td className="mono">{F.referee.command}</td></tr>
                  <tr><td><L>Score</L></td><td className="mono">{F.referee.scoreBlue} — {F.referee.scoreYellow}</td></tr>
                  <tr><td><L>Cards</L></td><td className="mono">Y · 01:47</td></tr>
                  <tr><td><L>Packet age</L></td><td className="mono">{F.referee.packetAge}</td></tr>
                </tbody>
              </table>
            </div>
          </aside>
        )}

        <nav className="cn-rail cn-rail--right">
          {F.rightTabs.map((t) => (
            <button
              key={t.id}
              className={rightOpen && rightTab === t.id ? 'on' : ''}
              title={t.label}
              onClick={() => {
                if (rightOpen && rightTab === t.id) setRightOpen(false)
                else { setRightTab(t.id); setRightOpen(true) }
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ═══ bottom dock ═══════════════════════════════ */}
      <section className="cn-bottom">
        <div className="cn-tl">
          <span className="mono">00:00</span>
          <div className="cn-tl-track">
            <div className="cn-tl-fill" style={{ width: `${F.playhead * 100}%` }} />
            {F.timeline.map((e) => (
              <i
                key={e.id}
                className={`cn-tl-ev cn-tl-ev--${e.kind}`}
                style={{ left: `${e.at * 100}%` }}
                title={e.label}
              />
            ))}
            <div
              className="cn-tl-head"
              style={{ left: `${(review ? F.reviewHead : F.playhead) * 100}%` }}
            />
          </div>
          <span className="mono">{F.session.simTime}</span>
          <span className="cn-tl-legend">
            <i className="cn-tl-ev--goal" />goal
            <i className="cn-tl-ev--foul" />foul
            <i className="cn-tl-ev--card" />card
            <i className="cn-tl-ev--bookmark" />mark
            <i className="cn-tl-ev--loss" />loss
          </span>
        </div>

        <div className="cn-tabs cn-tabs--bottom">
          {F.bottomTabs.map((t) => (
            <button
              key={t.id}
              className={bottomTab === t.id ? 'on' : ''}
              onClick={() => setBottomTab(t.id)}
            >
              {t.label.toUpperCase()}
              {t.badge != null && <i>{t.badge}</i>}
            </button>
          ))}
          <div className="cn-spacer" />
          <span className="cn-origin">
            LAST · {F.session.lastCommand.workstation}/{F.session.lastCommand.panel} ·{' '}
            {F.session.lastCommand.browser} · {F.session.lastCommand.ago}
          </span>
        </div>

        <div className="cn-bottom-body">
          {bottomTab === 'feed' && (
            <table className="cn-table">
              <tbody>
                {F.commandFeed.map((c, i) => (
                  <tr key={i} className={c.status === 'error' ? 'err' : ''}>
                    <td className="mono w-t">{c.t}</td>
                    <td className="w-r tag">{c.robot}</td>
                    <td className="mono">{c.body}</td>
                    <td className="dim">{c.origin}</td>
                    <td className="mono w-n">{c.rtt}</td>
                    <td className={`w-s st--${c.status}`}>{c.status.toUpperCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {bottomTab === 'tasks' && (
            <table className="cn-table">
              <thead>
                <tr>
                  <th>ROBOT</th><th>STATE</th><th>TASK</th><th>TARGET</th>
                  <th>SPEED</th><th>VX</th><th>VY</th><th>CONF</th><th>AGE</th>
                </tr>
              </thead>
              <tbody>
                {F.robots.map((r) => (
                  <tr key={r.team + r.id} className={r.selected ? 'sel' : r.ignored ? 'err' : ''}>
                    <td className="tag">{r.team === 'blue' ? 'B' : 'Y'}{r.id}</td>
                    <td className="mono">{F.short(r.state)}</td>
                    <td className="mono">{F.short(r.task)}</td>
                    <td className="mono">{r.target ? `${r.target.x}, ${r.target.y}` : '—'}</td>
                    <td className="mono">{r.speed.toFixed(1)}</td>
                    <td className="mono">{r.vx}</td>
                    <td className="mono">{r.vy}</td>
                    <td className="mono">{r.conf.toFixed(2)}</td>
                    <td className="mono">{r.age}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {bottomTab === 'referee' && (
            <table className="cn-table">
              <tbody>
                {F.timeline.map((e) => (
                  <tr key={e.id}>
                    <td className="mono w-t">{(e.at * 252).toFixed(1)} s</td>
                    <td className="w-r tag">{e.kind.slice(0, 4).toUpperCase()}</td>
                    <td className="mono">{e.label}</td>
                    <td className="dim">recorded · frame {(e.at * 1708605).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ═══ status bar ════════════════════════════════ */}
      <footer className="cn-status">
        <span><L>FRAME</L><b className="mono">{F.session.frame}</b></span>
        <span><L>SIM</L><b className="mono">{F.session.simTime}</b></span>
        <span><L>WALL</L><b className="mono">{F.session.wallClock}</b></span>
        <span><L>PROTO</L><b className="mono">{F.session.protocol}</b></span>
        <span><L>DIV</L><b className="mono">B</b></span>
        <span><L>CLIENTS</L><b className="mono">{F.session.clients}</b></span>
        <div className="cn-spacer" />
        <button className="cn-token">⧉ {F.debugToken}</button>
      </footer>
    </div>
  )
}
