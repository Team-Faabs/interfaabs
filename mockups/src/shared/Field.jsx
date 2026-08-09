import {
  FIELD,
  VIEWBOX,
  sy,
  svgDeg,
  robotPath,
  defenseArea,
  goalArea,
} from './geometry'
import { robots, ball, hologram } from '../fixtures'

// Style-agnostic SVG field. Every colour arrives through `theme` so each shell
// paints the same geometry in its own palette. The real v4 renderer is Canvas
// 2D (plan §Renderer) — SVG here only because the mock is static and
// disposable, and it keeps DPI/resize plumbing out of a checkpoint.

const ROBOT_PATH = robotPath()

function Robot({ r, theme, review }) {
  const fill = r.team === 'blue' ? theme.blue : theme.yellow
  const dim = r.ignored || review
  return (
    <g
      transform={`translate(${r.x} ${sy(r.y)}) rotate(${svgDeg(r.o)})`}
      opacity={dim ? 0.45 : 1}
    >
      {r.selected && (
        <circle
          r={FIELD.robotRadius + 70}
          fill="none"
          stroke={theme.select}
          strokeWidth="22"
          strokeDasharray="60 40"
        />
      )}
      {r.conf < 0.92 && (
        <circle
          r={FIELD.robotRadius + 34}
          fill="none"
          stroke={theme.uncertain}
          strokeWidth="12"
          strokeDasharray="26 26"
        />
      )}
      <path d={ROBOT_PATH} fill={fill} stroke={theme.robotEdge} strokeWidth="10" />
      {/* velocity vector, drawn unrotated so it stays in the field frame */}
      <g transform={`rotate(${-svgDeg(r.o)})`}>
        <line
          x1="0"
          y1="0"
          x2={r.vx * 0.35}
          y2={sy(r.vy * 0.35)}
          stroke={theme.velocity}
          strokeWidth="14"
          strokeLinecap="round"
        />
        <text
          y="46"
          textAnchor="middle"
          fontSize="118"
          fontWeight="700"
          fill={theme.robotLabel}
          style={{ fontFamily: 'ui-monospace, monospace' }}
        >
          {r.id}
        </text>
      </g>
      {r.ignored && (
        <g stroke={theme.alert} strokeWidth="16">
          <line x1="-70" y1="-70" x2="70" y2="70" />
          <line x1="-70" y1="70" x2="70" y2="-70" />
        </g>
      )}
    </g>
  )
}

// Every debug overlay is on by default, which is what the dense shells want.
// The quieter shells pass a subset — the plan's "all overlays visible without
// interaction" is a property of the checkpoint, not of every style, and
// showing fewer of them at rest is itself one of the things under review.
const ALL_OVERLAYS = {
  heat: true,
  zone: true,
  keepout: true,
  prediction: true,
  trajectory: true,
  hologram: true,
  kick: true,
}

export default function Field({ theme, review = false, showLabels = true, overlays }) {
  const show = overlays ? { ...ALL_OVERLAYS, ...overlays } : ALL_OVERLAYS
  const selected = robots.find((r) => r.selected)
  const kicker = robots.find((r) => r.kick)
  const half = FIELD.length / 2

  return (
    <svg
      viewBox={VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <defs>
        <radialGradient id="heat" cx="50%" cy="50%">
          <stop offset="0%" stopColor={theme.heat} stopOpacity="0.55" />
          <stop offset="100%" stopColor={theme.heat} stopOpacity="0" />
        </radialGradient>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.target} />
        </marker>
        <marker id="kickarrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.kick} />
        </marker>
      </defs>

      {/* ── pitch ─────────────────────────────────────── */}
      <rect
        x={-half - FIELD.boundary}
        y={sy(FIELD.width / 2 + FIELD.boundary)}
        width={FIELD.length + FIELD.boundary * 2}
        height={FIELD.width + FIELD.boundary * 2}
        fill={theme.boundary}
      />
      <rect
        x={-half}
        y={sy(FIELD.width / 2)}
        width={FIELD.length}
        height={FIELD.width}
        fill={theme.pitch}
      />

      {/* ── debug overlay: pressure heatmap (below lines) ── */}
      {show.heat && (
        <g opacity={review ? 0.35 : 0.75}>
          <circle cx={-900} cy={sy(400)} r={1500} fill="url(#heat)" />
          <circle cx={200} cy={sy(-700)} r={1100} fill="url(#heat)" />
          <circle cx={-2200} cy={sy(-1400)} r={900} fill="url(#heat)" />
        </g>
      )}

      {/* ── lines ─────────────────────────────────────── */}
      <g fill="none" stroke={theme.line} strokeWidth={FIELD.lineThickness * 2}>
        <rect x={-half} y={sy(FIELD.width / 2)} width={FIELD.length} height={FIELD.width} />
        <line x1="0" y1={sy(FIELD.width / 2)} x2="0" y2={sy(-FIELD.width / 2)} />
        <circle cx="0" cy="0" r={FIELD.centerCircleRadius} />
        {[-1, 1].map((s) => {
          const d = defenseArea(s)
          return <rect key={s} x={d.x} y={d.y} width={d.w} height={d.h} />
        })}
      </g>
      <circle cx="0" cy="0" r="24" fill={theme.line} />

      {/* ── goals ─────────────────────────────────────── */}
      {[-1, 1].map((s) => {
        const g = goalArea(s)
        return (
          <rect
            key={s}
            x={g.x}
            y={g.y}
            width={g.w}
            height={g.h}
            fill="none"
            stroke={s < 0 ? theme.blue : theme.yellow}
            strokeWidth="26"
          />
        )
      })}

      {/* ── debug overlay: defensive zone polygon ─────── */}
      {show.zone && (
        <polygon
          points={`${-half},${sy(1400)} ${-1800},${sy(2000)} ${-900},${sy(0)} ${-1800},${sy(-2000)} ${-half},${sy(-1400)}`}
          fill={theme.zone}
          fillOpacity="0.14"
          stroke={theme.zone}
          strokeWidth="16"
          strokeDasharray="90 60"
        />
      )}

      {/* ── debug overlay: ball keep-out circle ───────── */}
      {show.keepout && (
      <g>
        <circle
          cx={ball.x}
          cy={sy(ball.y)}
          r={500}
          fill="none"
          stroke={theme.keepout}
          strokeWidth="14"
          strokeDasharray="70 50"
        />
        {showLabels && (
          <text
            x={ball.x + 540}
            y={sy(ball.y) - 540}
            fontSize="150"
            fill={theme.fieldText}
            style={{ fontFamily: 'ui-monospace, monospace' }}
          >
            keep-out r=500
          </text>
        )}
      </g>
      )}

      {/* ── ball + prediction ─────────────────────────── */}
      {show.prediction && (
        <polyline
          points={ball.prediction.map(([x, y]) => `${x},${sy(y)}`).join(' ')}
          fill="none"
          stroke={theme.ball}
          strokeWidth="16"
          strokeDasharray="60 50"
          opacity="0.8"
        />
      )}
      <circle cx={ball.x} cy={sy(ball.y)} r={FIELD.ballRadius} fill={theme.ball} />

      {/* ── selected robot: trajectory + target ───────── */}
      {selected && show.trajectory && (
        <g>
          <polyline
            points={selected.trajectory.map(([x, y]) => `${x},${sy(y)}`).join(' ')}
            fill="none"
            stroke={theme.target}
            strokeWidth="20"
            strokeDasharray="110 70"
            markerEnd="url(#arrow)"
          />
          <g transform={`translate(${selected.target.x} ${sy(selected.target.y)})`}>
            <circle r="150" fill="none" stroke={theme.target} strokeWidth="18" />
            <line x1="-230" y1="0" x2="230" y2="0" stroke={theme.target} strokeWidth="16" />
            <line x1="0" y1="-230" x2="0" y2="230" stroke={theme.target} strokeWidth="16" />
            <line
              x1="0"
              y1="0"
              x2={Math.cos(selected.target.o) * 340}
              y2={sy(Math.sin(selected.target.o) * 340)}
              stroke={theme.target}
              strokeWidth="22"
              markerEnd="url(#arrow)"
            />
            {showLabels && (
              <text
                x="260"
                y="300"
                fontSize="150"
                fill={theme.fieldText}
                style={{ fontFamily: 'ui-monospace, monospace' }}
              >
                B3 → 980, 1250
              </text>
            )}
          </g>
        </g>
      )}

      {/* ── hologram: predicted pose of blue 3 in 500 ms ── */}
      {show.hologram && (
        <g
          transform={`translate(${hologram.x} ${sy(hologram.y)}) rotate(${svgDeg(hologram.o)})`}
          opacity="0.5"
        >
          <path
            d={ROBOT_PATH}
            fill="none"
            stroke={theme.blue}
            strokeWidth="20"
            strokeDasharray="70 50"
          />
        </g>
      )}

      {/* ── kick line ─────────────────────────────────── */}
      {kicker && show.kick && (
        <g>
          <line
            x1={kicker.x}
            y1={sy(kicker.y)}
            x2={kicker.kick.x}
            y2={sy(kicker.kick.y)}
            stroke={theme.kick}
            strokeWidth="22"
            markerEnd="url(#kickarrow)"
          />
          {showLabels && (
            <text
              x={(kicker.x + kicker.kick.x) / 2}
              y={sy((kicker.y + kicker.kick.y) / 2) - 90}
              fontSize="150"
              fill={theme.fieldText}
              textAnchor="middle"
              style={{ fontFamily: 'ui-monospace, monospace' }}
            >
              kick 6.5 m/s
            </text>
          )}
        </g>
      )}

      {/* ── robots ────────────────────────────────────── */}
      {robots.map((r) => (
        <Robot key={`${r.team}${r.id}`} r={r} theme={theme} review={review} />
      ))}

      {/* ── axis hints ────────────────────────────────── */}
      {showLabels && (
        <g fill={theme.fieldText} opacity="0.55" style={{ fontFamily: 'ui-monospace, monospace' }} fontSize="170">
          <text x={half - 60} y={sy(-FIELD.width / 2) - 90} textAnchor="end">+X</text>
          <text x="70" y={sy(FIELD.width / 2) + 200}>+Y</text>
        </g>
      )}
    </svg>
  )
}
