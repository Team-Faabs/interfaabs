import { useEffect, useMemo, useRef, useState } from 'react'

const STATE_OPTIONS = [
  'STATE_HALT',
  'STATE_STOP',
  'STATE_FREE',
  'STATE_GOALIE',
  'STATE_SUBSTITUTE',
]

const TASK_OPTIONS = [
  'TASK_UNSPECIFIED',
  'TASK_POS',
  'TASK_KICK',
  'TASK_CHIP',
  'TASK_REC_KICK',
  'TASK_STEAL',
  'TASK_DRIBBLE',
  'TASK_PosBall',
  'STATE_KICKOFF',
  'STATE_FREEKICK',
]

const INITIAL_COMMAND = {
  state: 'STATE_FREE',
  task: 'TASK_POS',
  positionX: 0,
  positionY: 0,
  speed: '',
  orientation: '',
  kickOrientation: '',
  kickSpeed: '',
}

const EMPTY_SNAPSHOT = {
  updatedAt: null,
  controller: {
    connected: false,
    url: '',
    reconnectDelayMs: 0,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastError: '',
  },
  field: {
    lengthMm: 9000,
    widthMm: 6000,
    goalWidthMm: 1000,
    goalDepthMm: 180,
    boundaryWidthMm: 300,
    penaltyAreaDepthMm: 1000,
    penaltyAreaWidthMm: 2000,
    centerCircleMm: 500,
    lineThicknessMm: 10,
    maxRobotRadiusMm: 90,
    ballRadiusMm: 22,
  },
  vision: {
    source: 'waiting',
    sourceLabel: 'Waiting for controller data',
    frameNumber: 0,
    timestamp: 0,
    balls: [],
    robots: [],
    hasGeometry: false,
    updatedAt: null,
    kickedBall: null,
  },
  robotCommands: [],
  interfaceOptions: {
    enableTestfield: false,
    testfield: 0,
    ballTracked: true,
    gcData: true,
  },
  referee: null,
  knownRobotIds: [],
  debug: {
    startedAt: null,
    clients: 0,
    packetsReceived: 0,
    packetsSent: 0,
    browserMessages: 0,
    broadcasts: 0,
    lastInboundBytes: 0,
    lastOutboundBytes: 0,
    rawFrames: 0,
    trackedFrames: 0,
    commandFrames: 0,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastEvent: '',
    lastError: '',
    lastCommand: '',
  },
}

export default function App() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT)
  const [socketState, setSocketState] = useState('connecting')
  const [uiError, setUiError] = useState('')
  const [selectedRobotIds, setSelectedRobotIds] = useState([])
  const [command, setCommand] = useState(INITIAL_COMMAND)
  const [optionsDraft, setOptionsDraft] = useState(EMPTY_SNAPSHOT.interfaceOptions)
  const socketRef = useRef(null)
  const retryTimerRef = useRef(null)

  useEffect(() => {
    setOptionsDraft(snapshot.interfaceOptions)
  }, [snapshot.interfaceOptions])

  useEffect(() => {
    const connect = () => {
      setSocketState('connecting')
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/ws`)
      socketRef.current = socket

      socket.onopen = () => {
        setSocketState('connected')
        setUiError('')
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'snapshot' && message.snapshot) {
            setSnapshot(message.snapshot)
            setSelectedRobotIds((current) => current.filter((id) => message.snapshot.knownRobotIds.includes(id)))
          }
          if (message.type === 'error' && message.error) {
            setUiError(message.error)
          }
        } catch {
          setUiError('Failed to parse server message')
        }
      }

      socket.onerror = () => {
        setSocketState('error')
      }

      socket.onclose = () => {
        setSocketState('disconnected')
        retryTimerRef.current = window.setTimeout(connect, 1500)
      }
    }

    connect()

    return () => {
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current)
      }
      if (socketRef.current) {
        socketRef.current.close()
      }
    }
  }, [])

  const selectedRobots = selectedRobotIds.length > 0 ? selectedRobotIds : snapshot.knownRobotIds
  const selectedCommandDetails = useMemo(() => buildCommandPayload(command), [command])
  const commandTargets = useMemo(() => {
    const map = new Map(snapshot.robotCommands.map((item) => [item.robotId, item]))
    return snapshot.vision.robots.map((robot) => ({
      ...robot,
      cpCommand: map.get(robot.id) ?? null,
    }))
  }, [snapshot.robotCommands, snapshot.vision.robots])

  function sendMessage(message) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setUiError('Browser websocket is not connected')
      return false
    }
    socketRef.current.send(JSON.stringify(message))
    setUiError('')
    return true
  }

  function toggleRobot(robotId) {
    setSelectedRobotIds((current) =>
      current.includes(robotId) ? current.filter((id) => id !== robotId) : [...current, robotId].sort((a, b) => a - b),
    )
  }

  function selectAllVisible() {
    setSelectedRobotIds(snapshot.knownRobotIds)
  }

  function clearSelection() {
    setSelectedRobotIds([])
    setCommand(INITIAL_COMMAND)
    setUiError('')
  }

  function pickFieldPosition(position) {
    setCommand((current) => ({
      ...current,
      positionX: Math.round(position.x),
      positionY: Math.round(position.y),
      task: current.task === 'TASK_UNSPECIFIED' ? 'TASK_POS' : current.task,
    }))
    setUiError('')
  }

  function submitOptions() {
    sendMessage({ type: 'set_options', options: optionsDraft })
  }

  function sendCommand() {
    if (selectedRobots.length === 0) {
      setUiError('Select at least one robot or wait until robots are visible')
      return
    }
    sendMessage({
      type: 'send_command',
      robotIds: selectedRobots,
      command: selectedCommandDetails,
    })
  }

  function quickCommand(state, task = 'TASK_UNSPECIFIED') {
    if (snapshot.knownRobotIds.length === 0) {
      setUiError('No robots are known yet')
      return
    }
    sendMessage({
      type: 'send_command',
      robotIds: snapshot.knownRobotIds,
      command: { state, task },
    })
  }

  return (
    <div className="app-shell">
      <div className="app-backdrop" />
      <main className="dashboard">
        <section className="hero-panel card">
          <div>
            <p className="eyebrow">CrashPilot Interface</p>
            <h1>Robot control room with live field awareness</h1>
            <p className="hero-copy">
              Monitor vision, game controller data, and CrashPilot commands in one place. Select one robot or a whole set,
              then push commands back to the controller.
            </p>
          </div>
          <div className="status-strip">
            <StatusPill label="Browser WS" value={socketState} tone={socketState === 'connected' ? 'good' : 'warn'} />
            <StatusPill
              label="Controller"
              value={snapshot.controller.connected ? 'connected' : 'offline'}
              tone={snapshot.controller.connected ? 'good' : 'danger'}
            />
            <StatusPill label="Vision" value={prettySource(snapshot.vision.source)} tone="neutral" />
            <StatusPill label="Robots" value={String(snapshot.vision.robots.length)} tone="neutral" />
            <StatusPill label="Balls" value={String(snapshot.vision.balls.length)} tone="neutral" />
          </div>
          <div className="hero-actions">
            <button className="action danger large" onClick={() => quickCommand('STATE_HALT')}>
              Halt All
            </button>
            <button className="action warn large" onClick={() => quickCommand('STATE_STOP')}>
              Stop All
            </button>
            <div className="inline-meta">
              <span>CrashPilot WS: {snapshot.controller.url || 'not configured'}</span>
              <span>Last event: {snapshot.debug.lastEvent || 'waiting'}</span>
            </div>
          </div>
        </section>

        <section className="field-panel card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Live Field</p>
              <h2>Robots, balls, and command intents</h2>
            </div>
            <div className="mini-stats">
              <span>Frame #{snapshot.vision.frameNumber || '-'}</span>
              <span>{formatTimestamp(snapshot.vision.updatedAt || snapshot.updatedAt)}</span>
            </div>
          </div>
          <FieldView
            field={snapshot.field}
            balls={snapshot.vision.balls}
            robots={commandTargets}
            kickedBall={snapshot.vision.kickedBall}
            selectedTarget={{ x: Number(command.positionX), y: Number(command.positionY) }}
            onPickPosition={pickFieldPosition}
          />
          <div className="field-legend">
            <LegendChip tone="blue" label="Blue robots" />
            <LegendChip tone="yellow" label="Yellow robots" />
            <LegendChip tone="accent" label="Ball" />
            <LegendChip tone="violet" label="CrashPilot target" />
            <LegendChip tone="mint" label="Kick direction" />
          </div>
          <p className="field-hint muted">Click anywhere on the field to fill the target position inputs.</p>
        </section>

        <section className="control-panel card">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Command Builder</p>
              <h2>Send to one or many robots</h2>
            </div>
            <div className="selection-summary">{selectedRobots.length} target robot(s)</div>
          </div>
          <div className="robot-selector">
            {snapshot.knownRobotIds.length === 0 ? <p className="muted">Waiting for robot ids from vision or CrashPilot.</p> : null}
            {snapshot.knownRobotIds.map((robotId) => (
              <button
                key={robotId}
                className={`robot-chip ${selectedRobotIds.includes(robotId) ? 'selected' : ''}`}
                onClick={() => toggleRobot(robotId)}
              >
                Robot {robotId}
              </button>
            ))}
          </div>
          <div className="toolbar-row">
            <button className="ghost" onClick={selectAllVisible}>
              Select All
            </button>
            <button className="ghost" onClick={clearSelection}>
              Clear
            </button>
            <span className="muted">If none are selected, commands target all known robots.</span>
          </div>
          <div className="form-grid">
            <label>
              <span>State</span>
              <select value={command.state} onChange={(event) => setCommand((current) => ({ ...current, state: event.target.value }))}>
                {STATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {prettyEnum(option)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Task</span>
              <select value={command.task} onChange={(event) => setCommand((current) => ({ ...current, task: event.target.value }))}>
                {TASK_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {prettyEnum(option)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Target X (mm)</span>
              <input type="number" value={command.positionX} onChange={(event) => setCommand((current) => ({ ...current, positionX: Number(event.target.value) }))} />
            </label>
            <label>
              <span>Target Y (mm)</span>
              <input type="number" value={command.positionY} onChange={(event) => setCommand((current) => ({ ...current, positionY: Number(event.target.value) }))} />
            </label>
            <label>
              <span>Speed</span>
              <input type="number" value={command.speed} onChange={(event) => setCommand((current) => ({ ...current, speed: event.target.value }))} />
            </label>
            <label>
              <span>Orientation</span>
              <input
                type="number"
                value={command.orientation}
                onChange={(event) => setCommand((current) => ({ ...current, orientation: event.target.value }))}
              />
            </label>
            <label>
              <span>Kick Orientation</span>
              <input
                type="number"
                value={command.kickOrientation}
                onChange={(event) => setCommand((current) => ({ ...current, kickOrientation: event.target.value }))}
              />
            </label>
            <label>
              <span>Kick Speed</span>
              <input type="number" value={command.kickSpeed} onChange={(event) => setCommand((current) => ({ ...current, kickSpeed: event.target.value }))} />
            </label>
          </div>
          <div className="toolbar-row spread">
            <div className="command-preview">Preview: {prettyEnum(command.state)} / {prettyEnum(command.task)}</div>
            <button className="action primary" onClick={sendCommand}>
              Send Command
            </button>
          </div>
        </section>

        <section className="options-panel card">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Global Options</p>
              <h2>Controller-wide switches</h2>
            </div>
          </div>
          <div className="toggle-grid">
            <ToggleCard
              label="Enable testfield"
              description="Enable the quadrant test field mode inside CrashPilot."
              checked={optionsDraft.enableTestfield}
              onChange={(checked) => setOptionsDraft((current) => ({ ...current, enableTestfield: checked }))}
            />
            <ToggleCard
              label="Track balls"
              description="Use tracked ball data instead of raw ball detections."
              checked={optionsDraft.ballTracked}
              onChange={(checked) => setOptionsDraft((current) => ({ ...current, ballTracked: checked }))}
            />
            <ToggleCard
              label="Use GC data"
              description="Allow CrashPilot to react to game controller messages."
              checked={optionsDraft.gcData}
              onChange={(checked) => setOptionsDraft((current) => ({ ...current, gcData: checked }))}
            />
            <label className="testfield-card">
              <span>Testfield quadrant</span>
              <select value={optionsDraft.testfield} onChange={(event) => setOptionsDraft((current) => ({ ...current, testfield: Number(event.target.value) }))}>
                <option value={0}>0: -x +y</option>
                <option value={1}>1: +x +y</option>
                <option value={2}>2: +x -y</option>
                <option value={3}>3: -x -y</option>
              </select>
            </label>
          </div>
          <div className="toolbar-row spread">
            <span className="muted">Options are encoded as `InterfaceCommand_CP` and sent to the controller.</span>
            <button className="action secondary" onClick={submitOptions}>
              Apply Options
            </button>
          </div>
        </section>

        <section className="command-feed card">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">CrashPilot Feed</p>
              <h2>Per-robot command stream</h2>
            </div>
          </div>
          <div className="feed-list">
            {snapshot.robotCommands.length === 0 ? <p className="muted">No controller commands received yet.</p> : null}
            {snapshot.robotCommands.map((item) => (
              <article key={`${item.robotId}-${item.packetId}-${item.receivedAt}`} className="feed-item">
                <div className="feed-topline">
                  <strong>Robot {item.robotId}</strong>
                  <span>{item.commandLabel}</span>
                </div>
                <div className="feed-grid">
                  <span>State: {prettyEnum(item.command.state)}</span>
                  <span>Task: {prettyEnum(item.command.task)}</span>
                  <span>Packet: {item.packetId}</span>
                  <span>Age: {item.ageMs} ms</span>
                  <span>Target: {item.command.position ? `${Math.round(item.command.position.x)}, ${Math.round(item.command.position.y)}` : 'none'}</span>
                  <span>Kick: {item.command.kickOrientation ?? '-'} / {item.command.kickSpeed ?? '-'}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="info-panel card">
          <div className="split-panels">
            <div>
              <p className="eyebrow">Referee</p>
              <h2>Game state</h2>
              {snapshot.referee ? (
                <div className="referee-grid">
                  <InfoRow label="Stage" value={prettyEnum(snapshot.referee.stage)} />
                  <InfoRow label="Command" value={prettyEnum(snapshot.referee.command)} />
                  <InfoRow label="Next" value={prettyEnum(snapshot.referee.nextCommand)} />
                  <InfoRow label="Blue" value={`${snapshot.referee.blue.name || 'Blue'} ${snapshot.referee.blue.score}`} />
                  <InfoRow label="Yellow" value={`${snapshot.referee.yellow.name || 'Yellow'} ${snapshot.referee.yellow.score}`} />
                  <InfoRow label="Status" value={snapshot.referee.statusMessage || 'No status message'} />
                </div>
              ) : (
                <p className="muted">No game controller packet received yet.</p>
              )}
            </div>
            <div>
              <p className="eyebrow">Debug</p>
              <h2>Transport and stream stats</h2>
              <div className="referee-grid">
                <InfoRow label="Packets in" value={snapshot.debug.packetsReceived} />
                <InfoRow label="Packets out" value={snapshot.debug.packetsSent} />
                <InfoRow label="Raw frames" value={snapshot.debug.rawFrames} />
                <InfoRow label="Tracked frames" value={snapshot.debug.trackedFrames} />
                <InfoRow label="Command frames" value={snapshot.debug.commandFrames} />
                <InfoRow label="Last inbound" value={formatTimestamp(snapshot.debug.lastInboundAt)} />
                <InfoRow label="Last outbound" value={formatTimestamp(snapshot.debug.lastOutboundAt)} />
                <InfoRow label="Inbound bytes" value={snapshot.debug.lastInboundBytes} />
                <InfoRow label="Outbound bytes" value={snapshot.debug.lastOutboundBytes} />
                <InfoRow label="Last command" value={snapshot.debug.lastCommand || 'none'} />
                <InfoRow label="Error" value={uiError || snapshot.debug.lastError || snapshot.controller.lastError || 'none'} />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function FieldView({ field, balls, robots, kickedBall, selectedTarget, onPickPosition }) {
  const padding = 520
  const width = field.lengthMm + padding * 2
  const height = field.widthMm + padding * 2
  const viewBox = `${-field.lengthMm / 2 - padding} ${-field.widthMm / 2 - padding} ${width} ${height}`
  const penaltyX = field.lengthMm / 2 - field.penaltyAreaDepthMm
  const goalDepth = field.goalDepthMm
  const robotRadius = Math.max(field.maxRobotRadiusMm || 90, 85)
  const ballRadius = Math.max(field.ballRadiusMm || 22, 22)

  function handleFieldClick(event) {
    const svg = event.currentTarget
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse())
    const clampedX = clamp(transformed.x, -field.lengthMm / 2, field.lengthMm / 2)
    const clampedY = clamp(transformed.y, -field.widthMm / 2, field.widthMm / 2)
    onPickPosition({ x: clampedX, y: clampedY })
  }

  return (
    <div className="field-shell">
      <svg className="field-svg clickable" viewBox={viewBox} aria-label="Soccer field view" onClick={handleFieldClick}>
        <defs>
          <marker id="target-arrow" markerWidth="16" markerHeight="16" refX="14" refY="8" orient="auto">
            <path d="M 0 0 L 16 8 L 0 16 z" fill="rgba(177, 126, 255, 0.9)" />
          </marker>
          <marker id="kick-arrow" markerWidth="16" markerHeight="16" refX="14" refY="8" orient="auto">
            <path d="M 0 0 L 16 8 L 0 16 z" fill="rgba(107, 255, 214, 0.95)" />
          </marker>
        </defs>
        <rect x={-field.lengthMm / 2 - field.boundaryWidthMm} y={-field.widthMm / 2 - field.boundaryWidthMm} width={field.lengthMm + field.boundaryWidthMm * 2} height={field.widthMm + field.boundaryWidthMm * 2} className="field-boundary" rx="120" />
        <rect x={-field.lengthMm / 2} y={-field.widthMm / 2} width={field.lengthMm} height={field.widthMm} className="field-outline" rx="40" />
        <line x1={0} y1={-field.widthMm / 2} x2={0} y2={field.widthMm / 2} className="field-line" />
        <circle cx={0} cy={0} r={field.centerCircleMm} className="field-line" />
        <rect x={-field.lengthMm / 2} y={-field.penaltyAreaWidthMm / 2} width={field.penaltyAreaDepthMm} height={field.penaltyAreaWidthMm} className="field-line" />
        <rect x={penaltyX} y={-field.penaltyAreaWidthMm / 2} width={field.penaltyAreaDepthMm} height={field.penaltyAreaWidthMm} className="field-line" />
        <rect x={-field.lengthMm / 2 - goalDepth} y={-field.goalWidthMm / 2} width={goalDepth} height={field.goalWidthMm} className="goal-box left" />
        <rect x={field.lengthMm / 2} y={-field.goalWidthMm / 2} width={goalDepth} height={field.goalWidthMm} className="goal-box right" />

        {balls.map((ball, index) => (
          <g key={`ball-${index}`}>
            <circle cx={ball.x} cy={ball.y} r={ballRadius * 1.8} className="ball-glow" />
            <circle cx={ball.x} cy={ball.y} r={ballRadius} className="ball-dot" />
          </g>
        ))}

        {kickedBall ? (
          <line x1={kickedBall.x} y1={kickedBall.y} x2={kickedBall.stopX || kickedBall.x} y2={kickedBall.stopY || kickedBall.y} className="kicked-ball-line" />
        ) : null}

        {selectedTarget ? (
          <g>
            <circle cx={selectedTarget.x} cy={selectedTarget.y} r={robotRadius * 0.9} className="picked-target-ring" />
            <circle cx={selectedTarget.x} cy={selectedTarget.y} r={robotRadius * 0.28} className="picked-target-dot" />
          </g>
        ) : null}

        {robots.map((robot) => {
          const radius = robotRadius
          const headingX = robot.x + Math.cos(robot.orientation || 0) * radius * 1.5
          const headingY = robot.y + Math.sin(robot.orientation || 0) * radius * 1.5
          const teamClass = robot.team === 'blue' ? 'robot blue' : robot.team === 'yellow' ? 'robot yellow' : 'robot neutral'
          const command = robot.cpCommand?.command
          const self = robot.cpCommand?.self
          const originX = self?.x ?? robot.x
          const originY = self?.y ?? robot.y
          const kickArrow = command?.kickOrientation != null
          const kickLength = 320
          const kickAngle = kickArrow ? degreesToRadians(command.kickOrientation) : null
          return (
            <g key={`${robot.team}-${robot.id}-${robot.x}-${robot.y}`}>
              {command?.position ? (
                <line x1={originX} y1={originY} x2={command.position.x} y2={command.position.y} className="command-line" markerEnd="url(#target-arrow)" />
              ) : null}
              {kickArrow ? (
                <line
                  x1={originX}
                  y1={originY}
                  x2={originX + Math.cos(kickAngle) * kickLength}
                  y2={originY + Math.sin(kickAngle) * kickLength}
                  className="kick-line"
                  markerEnd="url(#kick-arrow)"
                />
              ) : null}
              <circle cx={robot.x} cy={robot.y} r={radius * 1.35} className={`${teamClass} glow`} />
              <circle cx={robot.x} cy={robot.y} r={radius} className={teamClass} />
              <line x1={robot.x} y1={robot.y} x2={headingX} y2={headingY} className="robot-heading" />
              <text x={robot.x} y={robot.y + 6} className="robot-label">
                {robot.id}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function ToggleCard({ label, description, checked, onChange }) {
  return (
    <label className="toggle-card">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <span className={`toggle-switch ${checked ? 'checked' : ''}`}>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span />
      </span>
    </label>
  )
}

function StatusPill({ label, value, tone }) {
  return (
    <div className={`status-pill ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function LegendChip({ label, tone }) {
  return (
    <span className={`legend-chip ${tone}`}>
      <i />
      {label}
    </span>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{String(value)}</strong>
    </div>
  )
}

function buildCommandPayload(command) {
  const payload = {
    state: command.state,
    task: command.task,
  }
  payload.position = { x: Number(command.positionX), y: Number(command.positionY) }

  const speed = parseOptionalNumber(command.speed)
  const orientation = parseOptionalNumber(command.orientation)
  const kickOrientation = parseOptionalNumber(command.kickOrientation)
  const kickSpeed = parseOptionalNumber(command.kickSpeed)

  if (speed != null) payload.speed = speed
  if (orientation != null) payload.orientation = orientation
  if (kickOrientation != null) payload.kickOrientation = kickOrientation
  if (kickSpeed != null) payload.kickSpeed = kickSpeed

  return payload
}

function parseOptionalNumber(value) {
  if (value === '' || value == null) {
    return undefined
  }
  const parsed = Number(value)
  if (Number.isNaN(parsed)) {
    return undefined
  }
  return parsed
}

function prettyEnum(value) {
  if (!value) return '-'
  return value
    .replace(/^STATE_/, '')
    .replace(/^TASK_/, '')
    .replaceAll('_', ' ')
    .replace('PosBall', 'Position Ball')
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function prettySource(source) {
  if (source === 'vision_raw') return 'Raw Vision'
  if (source === 'vision_tracked') return 'Tracked Vision'
  return prettyEnum(source)
}

function formatTimestamp(value) {
  if (!value) return 'No timestamp'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleTimeString()
}

function degreesToRadians(value) {
  return (Number(value) * Math.PI) / 180
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}
