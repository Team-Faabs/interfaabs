import { useState } from 'react'
import './shell.css'
import Field from '../../shared/Field'
import * as F from '../../fixtures'

// ═══════════════════════════════════════════════════════
// Style D — Canvas
// The counter-proposal to A/B/C: there is no shell. The field is the
// window, edge to edge, and every control is a floating island over it
// that can be dismissed. At rest the operator sees the match and six
// small islands; everything else is one click away. Overlays are
// deliberately reduced at rest too — the layer popover turns them back on.
// ═══════════════════════════════════════════════════════

const THEME = {
  pitch: '#1d2a24',
  boundary: '#101714',
  line: 'rgba(226,240,236,0.42)',
  blue: '#6ea8fe',
  yellow: '#e8c26a',
  ball: '#ff9f4a',
  target: '#b39cff',
  kick: '#5fd39a',
  select: '#ffffff',
  uncertain: '#e8c26a',
  velocity: 'rgba(255,255,255,0.34)',
  robotEdge: '#0b0f12',
  robotLabel: '#0b0f12',
  heat: '#ff6b5e',
  zone: '#6ea8fe',
  keepout: 'rgba(255,255,255,0.26)',
  fieldText: 'rgba(226,240,236,0.5)',
  alert: '#ff6b5e',
}

// At rest only the overlays that explain the current decision are drawn.
const RESTING_OVERLAYS = { heat: false, zone: false, keepout: false, hologram: false }

// Which overlay each fixture layer maps onto, so the checkboxes in the layer
// popover agree with what is actually on the pitch.
const LAYER_OVERLAY = {
  'play.target': 'trajectory',
  'play.trajectory': 'trajectory',
  'skill.kickline': 'kick',
  'skill.holo': 'hologram',
  'world.keepout': 'keepout',
  'world.zone': 'zone',
  'world.heat': 'heat',
}

const layerIsOn = (layer, allLayers) => {
  if (allLayers) return true
  const key = LAYER_OVERLAY[layer.id]
  return layer.on && (key ? RESTING_OVERLAYS[key] !== false : true)
}

export default function CanvasShell({ params }) {
  const panel = params?.get('panel')
  const [review, setReview] = useState(params?.get('mode') === 'review')
  const [selected, setSelected] = useState(params?.get('sel') !== '0')
  const [feedOpen, setFeedOpen] = useState(panel === 'feed')
  const [layersOpen, setLayersOpen] = useState(panel === 'layers')
  const [alertsOpen, setAlertsOpen] = useState(panel === 'alerts')
  const [allLayers, setAllLayers] = useState(params?.get('layers') === 'all')

  const closePopovers = () => {
    setFeedOpen(false)
    setLayersOpen(false)
    setAlertsOpen(false)
  }

  return (
    <div className={`cv ${review ? 'cv--review' : 'cv--live'}`}>
      {/* ═══ the field is the entire window ═══ */}
      <div className="cv-field">
        <Field
          theme={THEME}
          review={review}
          showLabels={false}
          overlays={allLayers ? undefined : RESTING_OVERLAYS}
        />
      </div>
      <div className="cv-vignette" />

      {/* ═══ island · session (top left) ═══ */}
      <div className="cv-island cv-session">
        <span className={`cv-pulse ${review ? 'is-review' : ''}`} />
        <div>
          <b>
            {F.session.blue} <i>vs</i> {F.session.yellow}
          </b>
          <span className="cv-mono">
            {F.session.simTime} · f{F.session.frame.toLocaleString()}
          </span>
        </div>
      </div>

      {/* ═══ island · transport (top centre) ═══ */}
      <div className="cv-island cv-transport">
        <button title="Step back">⏮</button>
        <button className="cv-primary" title="Pause">
          ⏸
        </button>
        <button title="Step forward">⏭</button>
        <span className="cv-sep" />
        <button className="cv-speed">{F.session.speed}</button>
        <span className="cv-sep" />
        <button
          className={`cv-mode ${review ? 'is-review' : ''}`}
          onClick={() => setReview((v) => !v)}
        >
          {review ? 'Review' : 'Live'}
        </button>
        {review && <button className="cv-return">Return to live</button>}
      </div>

      {/* ═══ island · status (top right) ═══ */}
      <div className="cv-island cv-status">
        <button
          className={`cv-quiet ${alertsOpen ? 'on' : ''}`}
          onClick={() => {
            closePopovers()
            setAlertsOpen((v) => !v)
          }}
        >
          <span className="cv-dot cv-dot--warn" />2
        </button>
        <span className="cv-sep" />
        <span className="cv-ok">
          <span className="cv-dot" />
          all systems
        </span>
        <span className="cv-sep" />
        <button className="cv-quiet" title="Recording">
          <span className="cv-dot cv-dot--rec" />
          04:12
        </button>
      </div>

      {alertsOpen && (
        <div className="cv-pop cv-pop--alerts">
          {F.alerts.map((a) => (
            <div className="cv-alert" key={a.title}>
              <b>{a.title}</b>
              <span>{a.body}</span>
            </div>
          ))}
          <div className="cv-health">
            {F.health.map((h) => (
              <span key={h.label} className={h.ok ? '' : 'bad'}>
                <span className="cv-dot" />
                {h.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ═══ island · tools (left edge, icons only) ═══ */}
      <div className="cv-island cv-tools">
        <button title="Select">⬈</button>
        <button title="Measure">⟷</button>
        <button title="Follow ball">◎</button>
        <span className="cv-sep cv-sep--h" />
        <button
          className={layersOpen ? 'on' : ''}
          title="Layers"
          onClick={() => {
            closePopovers()
            setLayersOpen((v) => !v)
          }}
        >
          ≡
        </button>
        <button title="Sessions">▤</button>
      </div>

      {layersOpen && (
        <div className="cv-pop cv-pop--layers">
          <div className="cv-pop-head">
            Layers
            <label className="cv-switch">
              <input
                type="checkbox"
                checked={allLayers}
                onChange={(e) => setAllLayers(e.target.checked)}
              />
              show all
            </label>
          </div>
          {F.debugLayers.map((g) => (
            <div className="cv-lgroup" key={g.group}>
              <span>{g.group}</span>
              {g.layers.map((l) => (
                <label key={l.id}>
                  <input
                    type="checkbox"
                    key={String(allLayers)}
                    defaultChecked={layerIsOn(l, allLayers)}
                  />
                  {l.name}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ═══ island · inspector (right, only while something is selected) ═══ */}
      {selected && (
        <div className="cv-island cv-inspector">
          <div className="cv-insp-head">
            <span className="cv-chip">B3</span>
            <div>
              <b>bangka · 3</b>
              <span className="cv-mono">−520, 340 · 51.6°</span>
            </div>
            <button className="cv-x" onClick={() => setSelected(false)}>
              ×
            </button>
          </div>

          {/* Only the four fields this task actually uses. The rest live behind
              "all fields", which is the point of the style. */}
          <div className="cv-fields">
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
              <span>X</span>
              <input defaultValue="980" />
            </label>
            <label>
              <span>Y</span>
              <input defaultValue="1250" />
            </label>
          </div>
          <button className="cv-more">All 12 fields ▾</button>

          <button className="cv-send" disabled={review}>
            {review ? 'Read-only in review' : 'Send  ⏎'}
          </button>
        </div>
      )}

      {/* ═══ island · command line + timeline (bottom centre) ═══ */}
      <div className="cv-island cv-dock">
        <div className="cv-scrub">
          <div className="cv-scrub-track">
            <div className="cv-scrub-fill" style={{ width: `${F.playhead * 100}%` }} />
            {F.timeline
              .filter((e) => e.kind === 'goal' || e.kind === 'card')
              .map((e) => (
                <i key={e.id} style={{ left: `${e.at * 100}%` }} title={e.label} />
              ))}
            <div
              className="cv-scrub-head"
              style={{ left: `${(review ? F.reviewHead : F.playhead) * 100}%` }}
            />
          </div>
          <span className="cv-mono">{F.session.simTime}</span>
        </div>

        <div className="cv-lastline">
          <span className="cv-tag">B3</span>
          <span className="cv-lastbody">FREE · POS x=980 y=1250 θ=35.5°</span>
          <span className="cv-ago">acked {F.session.lastCommand.ago}</span>
          <button
            className={`cv-quiet ${feedOpen ? 'on' : ''}`}
            onClick={() => {
              closePopovers()
              setFeedOpen((v) => !v)
            }}
          >
            History {feedOpen ? '▾' : '▴'}
          </button>
        </div>

        {feedOpen && (
          <div className="cv-feed">
            {F.commandFeed.slice(0, 7).map((c, i) => (
              <div className={`cv-feedrow ${c.status === 'error' ? 'err' : ''}`} key={i}>
                <span className="cv-mono cv-t">{c.t.slice(0, 8)}</span>
                <span className="cv-tag">{c.robot}</span>
                <span className="cv-feedbody">{c.body}</span>
                <span className="cv-mono cv-t">{c.rtt}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ island · halt (bottom right, alone so it is never mis-hit) ═══ */}
      <div className="cv-halt-island">
        <button className="cv-halt">Halt</button>
        <button className="cv-stop">Stop</button>
      </div>

      {/* ═══ debug token (bottom left, all but invisible until hovered) ═══ */}
      <button className="cv-token">{F.debugToken}</button>
    </div>
  )
}
