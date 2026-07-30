import { useState } from 'react'
import './shell.css'
import Field from '../../shared/Field'
import * as F from '../../fixtures'

// ═══════════════════════════════════════════════════════
// Style E — Ledger
// The only light shell, and the only one with no docks, no tabs and no
// panel chrome. Two columns: the field, and one quiet reading column
// that scrolls. Hierarchy is typographic — size, weight and whitespace
// carry it, with hairline rules instead of boxes. Nothing is nested
// inside a card inside a panel inside a dock.
// ═══════════════════════════════════════════════════════

const THEME = {
  pitch: '#e6ebe4',
  boundary: '#d8ded6',
  line: 'rgba(52, 63, 54, 0.45)',
  blue: '#3b6fd4',
  yellow: '#c2901c',
  ball: '#e2622a',
  target: '#7b5cd6',
  kick: '#1f9d63',
  select: '#1b2620',
  uncertain: '#c98a12',
  velocity: 'rgba(35, 44, 38, 0.4)',
  robotEdge: '#f3f4f0',
  robotLabel: '#ffffff',
  heat: '#e05545',
  zone: '#3b6fd4',
  keepout: 'rgba(52, 63, 54, 0.3)',
  fieldText: 'rgba(52, 63, 54, 0.55)',
  alert: '#d1332a',
}

// The reading column shows overlays as a written list, so the pitch itself
// only carries what the current command is doing.
const OVERLAYS = { heat: false, zone: false, keepout: false }

function Block({ title, meta, children }) {
  return (
    <section className="lg-block">
      <h3>
        {title}
        {meta && <span>{meta}</span>}
      </h3>
      {children}
    </section>
  )
}

export default function Ledger({ params }) {
  const [review, setReview] = useState(params?.get('mode') === 'review')
  const [nav, setNav] = useState('live')

  return (
    <div className={`lg ${review ? 'lg--review' : 'lg--live'}`}>
      {/* ═══ one header line, nothing more ═══ */}
      <header className="lg-head">
        <span className="lg-mark" />
        <h1>
          {F.session.blue} <em>vs</em> {F.session.yellow}
        </h1>
        <span className="lg-head-meta">
          {F.session.division} · {F.session.kind} · {F.session.wallClock}
        </span>

        <div className="lg-grow" />

        <button
          className={`lg-mode ${review ? 'is-review' : ''}`}
          onClick={() => setReview((v) => !v)}
        >
          <i />
          {review ? 'Review' : 'Live'}
        </button>
        {review && <button className="lg-return">Return to live</button>}
        <button className="lg-halt">Halt all</button>
      </header>

      <div className="lg-body">
        {/* ═══ index column — words, no icons, no boxes ═══ */}
        <nav className="lg-index">
          {[
            ['live', 'Live field'],
            ['layers', 'Layers'],
            ['sessions', 'Sessions'],
            ['recordings', 'Recordings'],
          ].map(([id, label]) => (
            <button key={id} className={nav === id ? 'on' : ''} onClick={() => setNav(id)}>
              {label}
            </button>
          ))}

          <span className="lg-index-rule" />

          <div className="lg-index-note">
            <b>Recording</b>
            04:12 · 4 chunks queued
          </div>
          <div className="lg-index-note">
            <b>Vision</b>
            Tracked · 8 ms
          </div>
          <div className="lg-index-note lg-index-note--warn">
            <b>2 warnings</b>
            Disk write slow · packet age blue 4
          </div>
        </nav>

        {/* ═══ the field, on paper, with room around it ═══ */}
        <main className="lg-stage">
          <div className="lg-stage-head">
            <span className="lg-stage-title">World 0</span>
            <span className="lg-stage-meta">
              {F.session.speed} · frame {F.session.frame.toLocaleString()} · {F.session.simTime}
            </span>
            <div className="lg-grow" />
            <div className="lg-transport">
              <button>⏮</button>
              <button className="on">⏸</button>
              <button>⏭</button>
            </div>
          </div>

          <div className="lg-pitch">
            <Field theme={THEME} review={review} showLabels={false} overlays={OVERLAYS} />
          </div>

          <div className="lg-timeline">
            <span>00:00</span>
            <div className="lg-track">
              <div className="lg-track-fill" style={{ width: `${F.playhead * 100}%` }} />
              {F.timeline.map((e) => (
                <i
                  key={e.id}
                  className={`lg-ev lg-ev--${e.kind}`}
                  style={{ left: `${e.at * 100}%` }}
                  title={e.label}
                />
              ))}
              <div
                className="lg-head-mark"
                style={{ left: `${(review ? F.reviewHead : F.playhead) * 100}%` }}
              />
            </div>
            <span>{F.session.simTime}</span>
          </div>
        </main>

        {/* ═══ the reading column ═══ */}
        <aside className="lg-read">
          <Block title="Selection" meta="bangka · robot 3">
            <p className="lg-lede">
              Free play, holding position. Commanded to <b>980, 1250 mm</b> at 35.5°, arriving in
              about 0.6 s.
            </p>
            <dl className="lg-dl">
              <div>
                <dt>State</dt>
                <dd>FREE</dd>
              </div>
              <div>
                <dt>Task</dt>
                <dd>POS</dd>
              </div>
              <div>
                <dt>Speed</dt>
                <dd>2.4</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>0.99</dd>
              </div>
            </dl>
            <div className="lg-actions">
              <button className="lg-edit">Edit command</button>
              <button className="lg-send" disabled={review}>
                Send
              </button>
            </div>
          </Block>

          <Block title="Squad" meta="12 robots">
            {/* One line per robot, no table rules — the exceptions are the only
                thing that draws the eye. */}
            <ul className="lg-squad">
              {F.robots.map((r) => (
                <li
                  key={r.team + r.id}
                  className={r.selected ? 'sel' : r.ignored ? 'err' : ''}
                >
                  <span className={`lg-team lg-team--${r.team}`}>
                    {r.team === 'blue' ? 'B' : 'Y'}
                    {r.id}
                  </span>
                  <span className="lg-squad-task">
                    {F.short(r.state)} · {F.short(r.task)}
                  </span>
                  <span className="lg-squad-note">
                    {r.ignored ? 'no feedback 41 f' : `${r.speed.toFixed(1)} m/s`}
                  </span>
                </li>
              ))}
            </ul>
          </Block>

          <Block title="Recent commands" meta="last 5 of 14">
            <ul className="lg-log">
              {F.commandFeed.slice(0, 5).map((c, i) => (
                <li key={i} className={c.status === 'error' ? 'err' : ''}>
                  <span className="lg-log-t">{c.t.slice(0, 8)}</span>
                  <span className="lg-log-body">
                    <b>{c.robot}</b> {c.body}
                  </span>
                </li>
              ))}
            </ul>
            <button className="lg-morelink">Open full feed →</button>
          </Block>

          <Block title="Referee" meta={F.referee.command}>
            <p className="lg-score">
              <b>{F.referee.scoreBlue}</b>
              <em>—</em>
              <b>{F.referee.scoreYellow}</b>
              <span>second half · yellow card 01:47</span>
            </p>
          </Block>
        </aside>
      </div>

      {/* ═══ one hairline status line ═══ */}
      <footer className="lg-foot">
        <span>{review ? 'Review' : 'Live'}</span>
        <span>frame {F.session.frame.toLocaleString()}</span>
        <span>{F.session.clients} clients</span>
        <div className="lg-grow" />
        <button className="lg-token">{F.debugToken}</button>
      </footer>
    </div>
  )
}
