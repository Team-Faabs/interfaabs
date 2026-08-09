import { useState } from 'react'
import './shell.css'
import Field from '../../shared/Field'
import * as F from '../../fixtures'

const THEME = {
  pitch: '#1c2620',
  boundary: '#141a17',
  line: 'rgba(226,232,240,0.68)',
  blue: '#4a8cff',
  yellow: '#e3b341',
  ball: '#f0883e',
  target: '#bc8cff',
  kick: '#3fb950',
  select: '#ffffff',
  uncertain: '#e3b341',
  velocity: 'rgba(255,255,255,0.5)',
  robotEdge: '#11151a',
  robotLabel: '#0d1117',
  heat: '#f85149',
  zone: '#4a8cff',
  keepout: 'rgba(255,255,255,0.38)',
  fieldText: 'rgba(230,237,243,0.72)',
  alert: '#f85149',
}

function Section({ title, children, defaultOpen = true, aside }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`st-section ${open ? 'is-open' : ''}`}>
      <button className="st-section-head" onClick={() => setOpen((v) => !v)}>
        <span className="st-caret">{open ? '▾' : '▸'}</span>
        {title}
        {aside && <i>{aside}</i>}
      </button>
      {open && <div className="st-section-body">{children}</div>}
    </div>
  )
}

export default function Studio() {
  const [review, setReview] = useState(false)
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(true)
  const [leftTab, setLeftTab] = useState('layers')
  const [rightTab, setRightTab] = useState('properties')
  const [bottomTab, setBottomTab] = useState('feed')
  const [banner, setBanner] = useState(true)

  return (
    <div className={`st ${review ? 'st--review' : 'st--live'}`}>
      {/* ═══ menu bar ══════════════════════════════════ */}
      <div className="st-menubar">
        <span className="st-logo">◆</span>
        {['Session', 'Workspace', 'View', 'Field', 'Debug', 'Recording', 'Help'].map((m) => (
          <button key={m}>{m}</button>
        ))}
        <div className="st-spacer" />
        <span className="st-title">
          {F.session.blue} vs {F.session.yellow} — Live Operations
        </span>
        <div className="st-spacer" />
        <span className="st-menubar-meta">{F.session.division} · seed 8811</span>
      </div>

      {/* ═══ toolbar ═══════════════════════════════════ */}
      <div className="st-toolbar">
        <div className="st-group">
          <button title="Step back">⏮</button>
          <button className="on" title="Pause">⏸</button>
          <button title="Step forward">⏭</button>
        </div>
        <div className="st-group">
          <button>0.5×</button>
          <button className="on">1×</button>
          <button>4×</button>
        </div>
        <div className="st-divider" />
        <button className="st-tool st-tool--rec">
          <span className="st-rec-dot" /> Recording · 04:12
        </button>
        <button className="st-tool">Export…</button>
        <div className="st-divider" />
        <div className="st-group">
          <button className="on">Focus</button>
          <button>Grid</button>
          <button>Compare</button>
        </div>
        <div className="st-divider" />
        <button
          className={`st-modeswitch ${review ? 'is-review' : ''}`}
          onClick={() => setReview((v) => !v)}
        >
          <span className="st-modedot" />
          {review ? 'Review' : 'Live'}
        </button>
        {review && <button className="st-tool st-tool--return">Return to Live</button>}

        <div className="st-spacer" />
        <div className="st-health">
          {F.health.slice(0, 5).map((h) => (
            <span key={h.label} className={h.ok ? '' : 'bad'}>
              <i />
              {h.label}
            </span>
          ))}
        </div>
      </div>

      {/* ═══ body ══════════════════════════════════════ */}
      <div className="st-body">
        {/* ── activity bar (left rail, collapsed) ── */}
        <nav className="st-activity">
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
              {t.icon}
            </button>
          ))}
          <div className="st-spacer" />
          <button title="Settings">⚙</button>
        </nav>

        {leftOpen && (
          <aside className="st-side st-side--left">
            <div className="st-side-title">
              {F.leftTabs.find((t) => t.id === leftTab).label}
              <button onClick={() => setLeftOpen(false)}>×</button>
            </div>
            <div className="st-side-body">
              {F.debugLayers.map((g) => (
                <Section key={g.group} title={g.group} aside={`${g.layers.length}`}>
                  {g.layers.map((l) => (
                    <label className="st-layer" key={l.id}>
                      <input type="checkbox" defaultChecked={l.on} />
                      <span>{l.name}</span>
                      <i>{l.count}</i>
                    </label>
                  ))}
                </Section>
              ))}
            </div>
          </aside>
        )}

        {/* ── editor area ── */}
        <main className="st-editor">
          <div className="st-tabstrip">
            <div className="st-tab is-active">
              <span className="st-tab-dot" /> Field · world 0<b>×</b>
            </div>
            <div className="st-tab">
              Field · world 1<b>×</b>
            </div>
            <div className="st-tab">
              Schema · OffensiveTransition<b>×</b>
            </div>
            <button className="st-tab-add" title="Split editor">＋</button>
            <div className="st-spacer" />
            <span className="st-tabstrip-meta">1 of 1 world · Focus</span>
          </div>

          {banner && (
            <div className="st-banner">
              <span className="st-banner-icon">▲</span>
              <b>2 warnings</b>
              <span>Recording disk write slow (840 ms flush) · Vision packet age high — blue 4</span>
              <div className="st-spacer" />
              <button>Show in Problems</button>
              <button onClick={() => setBanner(false)}>×</button>
            </div>
          )}

          <div className="st-canvas">
            <Field theme={THEME} review={review} />

            {/* Studio places the emergency pair as a pinned tool overlay in the
                field viewport: closest to the pointer, always over the action. */}
            <div className="st-emergency">
              <button className="st-halt">Halt All</button>
              <button className="st-stop">Stop All</button>
            </div>

            <div className="st-viewtools">
              <button title="Fit">⤢</button>
              <button title="Flip X">↔</button>
              <button className="on" title="Flip Y">↕</button>
              <button title="Follow ball">◎</button>
            </div>

            {review && <div className="st-veil">Review · read-only</div>}
          </div>
        </main>

        {/* ── right side panel (expanded) ── */}
        {rightOpen && (
          <aside className="st-side st-side--right">
            <div className="st-side-tabs">
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
            <div className="st-side-body">
              <div className="st-selcard">
                <span className="st-selchip">B3</span>
                <div>
                  <b>bangka · robot 3</b>
                  <i>−520, 340 mm · 51.6° · conf 0.99</i>
                </div>
              </div>

              <Section title="Command">
                <div className="st-props">
                  {F.properties.map((p) => (
                    <label className="st-prop" key={p.label}>
                      <span>{p.label}</span>
                      {p.control === 'toggle' ? (
                        <input type="checkbox" defaultChecked={!!p.value} />
                      ) : p.control === 'select' ? (
                        <select defaultValue={p.value}><option>{p.value}</option></select>
                      ) : (
                        <input defaultValue={p.value} placeholder="—" />
                      )}
                    </label>
                  ))}
                </div>
                <div className="st-apply">
                  <code>FREE · POS → 980, 1250</code>
                  <button className="st-send" disabled={review}>Send</button>
                </div>
              </Section>

              <Section title="Global options">
                <div className="st-kv">
                  {F.globalOptions.map((o) => (
                    <div key={o.label}>
                      <span>{o.label}</span>
                      <b>{o.value}</b>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Referee" defaultOpen={false}>
                <div className="st-kv">
                  <div><span>Stage</span><b>{F.referee.stage}</b></div>
                  <div><span>Command</span><b>{F.referee.command}</b></div>
                </div>
              </Section>
            </div>
          </aside>
        )}

        <nav className="st-activity st-activity--right">
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
              {t.icon}
            </button>
          ))}
        </nav>
      </div>

      {/* ═══ bottom panel ══════════════════════════════ */}
      <section className="st-panel">
        <div className="st-panel-tabs">
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
          <div className="st-spacer" />
          <span className="st-panel-meta">
            last command · {F.session.lastCommand.workstation} / {F.session.lastCommand.panel} ·{' '}
            {F.session.lastCommand.ago}
          </span>
          <button className="st-panel-btn">⌃</button>
          <button className="st-panel-btn">×</button>
        </div>

        <div className="st-scrub">
          <span>00:00</span>
          <div className="st-scrub-track">
            <div className="st-scrub-fill" style={{ width: `${F.playhead * 100}%` }} />
            {F.timeline.map((e) => (
              <i
                key={e.id}
                className={`st-ev st-ev--${e.kind}`}
                style={{ left: `${e.at * 100}%` }}
                title={e.label}
              />
            ))}
            <div
              className="st-scrub-head"
              style={{ left: `${(review ? F.reviewHead : F.playhead) * 100}%` }}
            />
          </div>
          <span>{F.session.simTime}</span>
          <button className="st-panel-btn" title="Add bookmark">＋ Bookmark</button>
        </div>

        <div className="st-panel-body">
          {bottomTab === 'feed' && (
            <table className="st-table">
              <tbody>
                {F.commandFeed.map((c, i) => (
                  <tr key={i} className={c.status === 'error' ? 'err' : ''}>
                    <td className="t">{c.t}</td>
                    <td className="tag">{c.robot}</td>
                    <td>{c.body}</td>
                    <td className="dim">{c.origin}</td>
                    <td className="t">{c.rtt}</td>
                    <td className={`st--${c.status}`}>
                      {c.status === 'error' ? `error · ${c.error}` : 'ack'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {bottomTab === 'tasks' && (
            <table className="st-table">
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
                    <td className="t">{r.target ? `${r.target.x}, ${r.target.y}` : '—'}</td>
                    <td className="t">{r.speed.toFixed(1)}</td>
                    <td className="t">{r.conf.toFixed(2)}</td>
                    <td className="t">{r.age} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {bottomTab === 'referee' && (
            <div className="st-refgrid">
              <div><span>Stage</span><b>{F.referee.stage}</b></div>
              <div><span>Command</span><b>{F.referee.command}</b></div>
              <div><span>Next</span><b>{F.referee.next}</b></div>
              <div><span>Score</span><b>{F.referee.scoreBlue} — {F.referee.scoreYellow}</b></div>
              <div><span>Timeouts blue</span><b>{F.referee.timeoutsBlue}</b></div>
              <div><span>Timeouts yellow</span><b>{F.referee.timeoutsYellow}</b></div>
              <div><span>Cards</span><b>yellow · 01:47</b></div>
              <div><span>Packet age</span><b>{F.referee.packetAge}</b></div>
            </div>
          )}
        </div>
      </section>

      {/* ═══ status bar ════════════════════════════════ */}
      <footer className="st-status">
        <span className="st-status-mode">{review ? 'REVIEW' : 'LIVE'}</span>
        <span>frame {F.session.frame.toLocaleString()}</span>
        <span>sim {F.session.simTime}</span>
        <span>vision {F.session.visionSource}</span>
        <span className="st-status-warn">▲ 2</span>
        <div className="st-spacer" />
        <span>{F.session.clients} clients</span>
        <span>protocol {F.session.protocol}</span>
        <button className="st-status-token">⧉ {F.debugToken}</button>
      </footer>
    </div>
  )
}
