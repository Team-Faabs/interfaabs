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
  'TASK_BLOCK',
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
  enemyId: '',
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
    gameMode: false,
    side: false,
    teamColor: false,
    goalkeeperId: 0,
    maxSpeed: 0,
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
  const [builderTab, setBuilderTab] = useState('command')
  const [flipX, setFlipX] = useLocalStorage('cp:flipX', false)
  const [flipY, setFlipY] = useLocalStorage('cp:flipY', false)
  const socketRef = useRef(null)
  const retryTimerRef = useRef(null)

  const { enableTestfield, testfield, ballTracked, gcData, gameMode, side, teamColor, goalkeeperId, maxSpeed } =
    snapshot.interfaceOptions
  useEffect(() => {
    setOptionsDraft({ enableTestfield, testfield, ballTracked, gcData, gameMode, side, teamColor, goalkeeperId, maxSpeed })
  }, [enableTestfield, testfield, ballTracked, gcData, gameMode, side, teamColor, goalkeeperId, maxSpeed])

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
  const teamGoalieIds = useMemo(() => {
    const team = optionsDraft.teamColor ? 'blue' : 'yellow'
    const ids = snapshot.vision.robots.filter((robot) => robot.team === team).map((robot) => robot.id)
    return [...new Set(ids)].sort((a, b) => a - b)
  }, [snapshot.vision.robots, optionsDraft.teamColor])

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
        <section className="field-panel card">
          <div className="section-head compact">
            <div className="title-block">
              <span className="brand-dot" />
              <h2>CrashPilot</h2>
              <span className="mini-stats">
                Frame #{snapshot.vision.frameNumber || '-'} · {formatTimestamp(snapshot.vision.updatedAt || snapshot.updatedAt)}
              </span>
            </div>
            <div className="field-header-tools">
              <div className="flip-toggles">
                <button
                  className={`flip-btn ${flipX ? 'active' : ''}`}
                  onClick={() => setFlipX((v) => !v)}
                  title="Mirror the field along the X axis"
                >
                  Flip X
                </button>
                <button
                  className={`flip-btn ${flipY ? 'active' : ''}`}
                  onClick={() => setFlipY((v) => !v)}
                  title="Mirror the field along the Y axis"
                >
                  Flip Y
                </button>
              </div>
              <div className="field-legend">
                <LegendChip tone="blue" label="Blue" />
                <LegendChip tone="yellow" label="Yellow" />
                <LegendChip tone="accent" label="Ball" />
                <LegendChip tone="violet" label="Target" />
                <LegendChip tone="mint" label="Kick" />
              </div>
            </div>
          </div>
          <FieldView
            field={snapshot.field}
            balls={snapshot.vision.balls}
            robots={commandTargets}
            kickedBall={snapshot.vision.kickedBall}
            selectedTarget={{ x: Number(command.positionX), y: Number(command.positionY) }}
            selectedRobotIds={selectedRobotIds}
            flipX={flipX}
            flipY={flipY}
            testfield={snapshot.interfaceOptions.enableTestfield ? snapshot.interfaceOptions.testfield : null}
            onPickPosition={pickFieldPosition}
            onToggleRobot={toggleRobot}
          />
          <p className="field-hint muted">Click the field to set the target position · click a robot to select it.</p>
        </section>

        <section className="control-panel card">
          <div className="section-head compact">
            <div className="builder-tabs">
              <button
                className={`tab-btn ${builderTab === 'command' ? 'active' : ''}`}
                onClick={() => setBuilderTab('command')}
              >
                Command
              </button>
              <button
                className={`tab-btn ${builderTab === 'gamemode' ? 'active' : ''}`}
                onClick={() => setBuilderTab('gamemode')}
              >
                Game Mode
              </button>
            </div>
            {builderTab === 'command' ? (
              <div className="selection-summary">
                {selectedRobotIds.length > 0
                  ? `${selectedRobotIds.length} selected`
                  : `${snapshot.knownRobotIds.length} (all)`}
              </div>
            ) : (
              <span className={`gamemode-pill ${optionsDraft.gameMode ? 'on' : ''}`}>
                {optionsDraft.gameMode ? 'Enabled' : 'Disabled'}
              </span>
            )}
          </div>

          {builderTab === 'gamemode' ? (
            <GameModePanel options={optionsDraft} goalieIds={teamGoalieIds} onChange={setOptionsDraft} onApply={submitOptions} />
          ) : (
          <>
          <div className="robot-selector">
            {snapshot.knownRobotIds.length === 0 ? (
              <p className="muted">Waiting for robot ids.</p>
            ) : null}
            {snapshot.knownRobotIds.map((robotId) => (
              <button
                key={robotId}
                className={`robot-chip ${selectedRobotIds.includes(robotId) ? 'selected' : ''}`}
                onClick={() => toggleRobot(robotId)}
              >
                {robotId}
              </button>
            ))}
          </div>
          <div className="toolbar-row tight">
            <button className="ghost small" onClick={selectAllVisible}>All</button>
            <button className="ghost small" onClick={clearSelection}>Clear</button>
            <span className="muted small">No selection = all robots</span>
          </div>

          <div className="form-grid">
            <label>
              <span>State</span>
              <select value={command.state} onChange={(event) => setCommand((current) => ({ ...current, state: event.target.value }))}>
                {STATE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{prettyEnum(option)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Task</span>
              <select value={command.task} onChange={(event) => setCommand((current) => ({ ...current, task: event.target.value }))}>
                {TASK_OPTIONS.map((option) => (
                  <option key={option} value={option}>{prettyEnum(option)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>X (mm)</span>
              <input type="number" value={command.positionX} onChange={(event) => setCommand((current) => ({ ...current, positionX: Number(event.target.value) }))} />
            </label>
            <label>
              <span>Y (mm)</span>
              <input type="number" value={command.positionY} onChange={(event) => setCommand((current) => ({ ...current, positionY: Number(event.target.value) }))} />
            </label>
            <label>
              <span>Speed</span>
              <input type="number" value={command.speed} onChange={(event) => setCommand((current) => ({ ...current, speed: event.target.value }))} />
            </label>
            <label>
              <span>Orient. (°)</span>
              <input type="number" value={command.orientation} onChange={(event) => setCommand((current) => ({ ...current, orientation: event.target.value }))} />
            </label>
            <label>
              <span>Kick orient. (°)</span>
              <input type="number" value={command.kickOrientation} onChange={(event) => setCommand((current) => ({ ...current, kickOrientation: event.target.value }))} />
            </label>
            <label>
              <span>Kick speed</span>
              <input type="number" value={command.kickSpeed} onChange={(event) => setCommand((current) => ({ ...current, kickSpeed: event.target.value }))} />
            </label>
            <label>
              <span>Enemy ID</span>
              <input type="number" value={command.enemyId} onChange={(event) => setCommand((current) => ({ ...current, enemyId: event.target.value }))} />
            </label>
          </div>

          <div className="preview-row">
            <span className="command-preview">{prettyEnum(command.state)} · {prettyEnum(command.task)}{command.enemyId ? ` · Enemy ${command.enemyId}` : ''}</span>
            <button className="action primary" onClick={sendCommand}>Send</button>
          </div>
          </>
          )}
        </section>

        <section className="topbar-panel card">
          <div className="topbar-actions">
            <button className="action danger" onClick={() => quickCommand('STATE_HALT')}>Halt All</button>
            <button className="action warn" onClick={() => quickCommand('STATE_STOP')}>Stop All</button>
          </div>
          <div className="status-strip">
            <StatusPill label="WS" value={socketState} tone={socketState === 'connected' ? 'good' : 'warn'} />
            <StatusPill label="Controller" value={snapshot.controller.connected ? 'online' : 'offline'} tone={snapshot.controller.connected ? 'good' : 'danger'} />
            <StatusPill label="Vision" value={prettySource(snapshot.vision.source)} tone="neutral" />
            <StatusPill label="Robots" value={String(snapshot.vision.robots.length)} tone="neutral" />
            <StatusPill label="Balls" value={String(snapshot.vision.balls.length)} tone="neutral" />
          </div>
          {uiError ? <span className="error-pill">{uiError}</span> : null}
        </section>

        <section className="options-panel card">
          <div className="section-head compact">
            <h2>Global Options</h2>
            <button className="action secondary small" onClick={submitOptions}>Apply</button>
          </div>
          <div className="toggle-grid">
            <ToggleCard
              label="Testfield"
              description="Quadrant test mode."
              checked={optionsDraft.enableTestfield}
              onChange={(checked) => setOptionsDraft((current) => ({ ...current, enableTestfield: checked }))}
            />
            <ToggleCard
              label="Track balls"
              description="Use tracked instead of raw balls."
              checked={optionsDraft.ballTracked}
              onChange={(checked) => setOptionsDraft((current) => ({ ...current, ballTracked: checked }))}
            />
            <ToggleCard
              label="GC data"
              description="React to game controller messages."
              checked={optionsDraft.gcData}
              onChange={(checked) => setOptionsDraft((current) => ({ ...current, gcData: checked }))}
            />
            <label className="testfield-card">
              <span>Quadrant</span>
              <select value={optionsDraft.testfield} onChange={(event) => setOptionsDraft((current) => ({ ...current, testfield: Number(event.target.value) }))}>
                <option value={0}>0: -x +y</option>
                <option value={1}>1: +x +y</option>
                <option value={2}>2: +x -y</option>
                <option value={3}>3: -x -y</option>
              </select>
            </label>
          </div>
        </section>

        <section className="bottom-panel card">
          <div className="split-panels">
            <div className="split-col">
              <div className="section-head compact">
                <h2>CrashPilot Feed</h2>
              </div>
              <div className="feed-list">
                {snapshot.robotCommands.length === 0 ? <p className="muted">No commands yet.</p> : null}
                {snapshot.robotCommands.map((item) => (
                  <article key={`${item.robotId}-${item.packetId}-${item.receivedAt}`} className="feed-item">
                    <div className="feed-topline">
                      <strong>Robot {item.robotId}</strong>
                      <span>{item.commandLabel}</span>
                    </div>
                    <div className="feed-grid">
                      <span>State: {prettyEnum(item.command.state)}</span>
                      <span>Task: {prettyEnum(item.command.task)}</span>
                      <span>Pkt: {item.packetId}</span>
                      <span>Age: {item.ageMs}ms</span>
                      <span>Target: {item.command.position ? `${Math.round(item.command.position.x)}, ${Math.round(item.command.position.y)}` : '—'}</span>
                      <span>Kick: {item.command.kickOrientation ?? '—'} / {item.command.kickSpeed ?? '—'}</span>
                      <span>Enemy: {item.command.enemyId ?? '—'}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <div className="split-col">
              <div className="section-head compact">
                <h2>Referee & Debug</h2>
              </div>
              <div className="referee-grid">
                {snapshot.referee ? (
                  <>
                    <InfoRow label="Stage" value={prettyEnum(snapshot.referee.stage)} />
                    <InfoRow label="Command" value={prettyEnum(snapshot.referee.command)} />
                    <InfoRow label="Next" value={prettyEnum(snapshot.referee.nextCommand)} />
                    <InfoRow label="Blue" value={`${snapshot.referee.blue.name || 'Blue'} ${snapshot.referee.blue.score}`} />
                    <InfoRow label="Yellow" value={`${snapshot.referee.yellow.name || 'Yellow'} ${snapshot.referee.yellow.score}`} />
                    <InfoRow label="Status" value={snapshot.referee.statusMessage || '—'} />
                  </>
                ) : (
                  <p className="muted">No GC packet yet.</p>
                )}
                <InfoRow label="Pkts in/out" value={`${snapshot.debug.packetsReceived} / ${snapshot.debug.packetsSent}`} />
                <InfoRow label="Raw / Trk frames" value={`${snapshot.debug.rawFrames} / ${snapshot.debug.trackedFrames}`} />
                <InfoRow label="Last in" value={formatTimestamp(snapshot.debug.lastInboundAt)} />
                <InfoRow label="Last out" value={formatTimestamp(snapshot.debug.lastOutboundAt)} />
                <InfoRow label="Last command" value={snapshot.debug.lastCommand || '—'} />
                <InfoRow label="Error" value={snapshot.debug.lastError || snapshot.controller.lastError || '—'} />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function FieldView({ field, balls, robots, kickedBall, selectedTarget, selectedRobotIds, flipX, flipY, testfield, onPickPosition, onToggleRobot }) {
  const padding = 760
  const width = field.lengthMm + padding * 2
  const height = field.widthMm + padding * 2
  const viewBox = `${-field.lengthMm / 2 - padding} ${-field.widthMm / 2 - padding} ${width} ${height}`
  const penaltyX = field.lengthMm / 2 - field.penaltyAreaDepthMm
  const goalDepth = field.goalDepthMm
  const robotRadius = Math.max(field.maxRobotRadiusMm || 90, 85)
  const ballRadius = Math.max(field.ballRadiusMm || 22, 22)
  const halfL = field.lengthMm / 2
  const halfW = field.widthMm / 2
  const labelOffset = 280
  const tickLabelOffset = 460
  const sx = flipX ? -1 : 1
  const sy = flipY ? -1 : 1

  function handleFieldClick(event) {
    const svg = event.currentTarget
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse())
    const fieldX = transformed.x * sx
    const fieldY = transformed.y * sy
    const clampedX = clamp(fieldX, -halfL, halfL)
    const clampedY = clamp(fieldY, -halfW, halfW)
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

        <g transform={`scale(${sx} ${sy})`}>
          <rect
            x={-halfL - field.boundaryWidthMm}
            y={-halfW - field.boundaryWidthMm}
            width={field.lengthMm + field.boundaryWidthMm * 2}
            height={field.widthMm + field.boundaryWidthMm * 2}
            className="field-boundary"
            rx="120"
          />
          <rect x={-halfL} y={-halfW} width={field.lengthMm} height={field.widthMm} className="field-outline" rx="20" />
          <line x1={0} y1={-halfW} x2={0} y2={halfW} className="field-line" />
          <circle cx={0} cy={0} r={field.centerCircleMm} className="field-line" />
          <circle cx={0} cy={0} r={20} className="field-dot" />
          <rect x={-halfL} y={-field.penaltyAreaWidthMm / 2} width={field.penaltyAreaDepthMm} height={field.penaltyAreaWidthMm} className="field-line" />
          <rect x={penaltyX} y={-field.penaltyAreaWidthMm / 2} width={field.penaltyAreaDepthMm} height={field.penaltyAreaWidthMm} className="field-line" />
          <rect x={-halfL - goalDepth} y={-field.goalWidthMm / 2} width={goalDepth} height={field.goalWidthMm} className="goal-box left" />
          <rect x={halfL} y={-field.goalWidthMm / 2} width={goalDepth} height={field.goalWidthMm} className="goal-box right" />

          {testfield != null ? (() => {
            const quadrants = {
              0: { x: -halfL, y: 0,       label: '−X +Y' },
              1: { x: 0,      y: 0,       label: '+X +Y' },
              2: { x: 0,      y: -halfW,  label: '+X −Y' },
              3: { x: -halfL, y: -halfW,  label: '−X −Y' },
            }
            const q = quadrants[testfield]
            if (!q) return null
            return (
              <g className="testfield-overlay">
                <rect x={q.x} y={q.y} width={halfL} height={halfW} className="testfield-rect" />
                <g transform={`translate(${q.x + halfL / 2} ${q.y + halfW / 2}) scale(${sx} ${sy})`}>
                  <text x={0} y={-40} className="testfield-label">TESTFIELD</text>
                  <text x={0} y={140} className="testfield-sublabel">Q{testfield} · {q.label}</text>
                </g>
              </g>
            )
          })() : null}

          {balls.map((ball, index) => (
            <g key={`ball-${index}`}>
              <circle cx={ball.x} cy={ball.y} r={ballRadius * 2} className="ball-glow" />
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
            const isSelected = selectedRobotIds.includes(robot.id)
            const teamClass = robot.team === 'blue' ? 'robot blue' : robot.team === 'yellow' ? 'robot yellow' : 'robot neutral'
            const command = robot.cpCommand?.command
            const self = robot.cpCommand?.self
            const originX = self?.x ?? robot.x
            const originY = self?.y ?? robot.y
            const kickArrow = command?.kickOrientation != null
            const kickLength = 320
            const kickAngle = kickArrow ? degreesToRadians(command.kickOrientation) : null
            const orientation = robot.orientation || 0
            const bodyPath = robotBodyPath(radius, orientation)
            const labelTransform = `scale(${sx} ${sy})`
            return (
              <g key={`${robot.team}-${robot.id}-${robot.x}-${robot.y}`} className="robot-group" onClick={(event) => { event.stopPropagation(); onToggleRobot(robot.id) }}>
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
                <g transform={`translate(${robot.x} ${robot.y})`}>
                  {isSelected ? (
                    <circle cx={0} cy={0} r={radius * 1.55} className="robot-select-ring" />
                  ) : null}
                  <path d={bodyPath} className={teamClass} />
                  <text x={0} y={28} className="robot-label" transform={labelTransform}>{robot.id}</text>
                </g>
              </g>
            )
          })}
        </g>

        {/* axis labels (outside flipped group so text reads correctly; positions follow flips) */}
        <g className="axis-labels">
          <text x={sx * (halfL + tickLabelOffset)} y={0} className="axis-label">+X</text>
          <text x={-sx * (halfL + tickLabelOffset)} y={0} className="axis-label">−X</text>
          <text x={0} y={sy * (halfW + tickLabelOffset)} className="axis-label">+Y</text>
          <text x={0} y={-sy * (halfW + tickLabelOffset) + 20} className="axis-label">−Y</text>
        </g>

        {/* angle ticks: 0° → +X, 90° → +Y, 180° → −X, 270° → −Y */}
        <g className="angle-labels">
          <text x={sx * (halfL + labelOffset)} y={120} className="angle-label">0°</text>
          <text x={-80} y={sy * (halfW + labelOffset)} className="angle-label">90°</text>
          <text x={-sx * (halfL + labelOffset)} y={120} className="angle-label">180°</text>
          <text x={-80} y={-sy * (halfW + labelOffset) + 20} className="angle-label">270°</text>
        </g>

        {/* compass in lower-left, fixed orientation */}
        <g className="compass" transform={`translate(${-halfL - 540}, ${halfW + 360})`}>
          <circle cx={0} cy={0} r={140} className="compass-bg" />
          <line x1={-110} y1={0} x2={sx * 110} y2={0} className="compass-axis" markerEnd="url(#target-arrow)" />
          <line x1={0} y1={-110} x2={0} y2={sy * 110} className="compass-axis" markerEnd="url(#target-arrow)" />
          <text x={sx * 150} y={20} className="compass-text">X</text>
          <text x={-10} y={sy * 180} className="compass-text">Y</text>
        </g>
      </svg>
    </div>
  )
}

function robotBodyPath(radius, orientation) {
  // SSL-style robot body drawn around (0,0): circle with a flat face on the kicker side.
  const notch = 0.55 // half-angle of the flat face in radians
  const a1 = orientation + notch
  const a2 = orientation - notch
  const x1 = Math.cos(a1) * radius
  const y1 = Math.sin(a1) * radius
  const x2 = Math.cos(a2) * radius
  const y2 = Math.sin(a2) * radius
  return `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2} Z`
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

function GameModePanel({ options, goalieIds, onChange, onApply }) {
  const set = (patch) => onChange((current) => ({ ...current, ...patch }))
  const goalieOnTeam = goalieIds.includes(options.goalkeeperId)
  return (
    <div className="gamemode-panel">
      <ToggleCard
        label="Game Mode"
        description="Hand control to CrashPilot. Disables the manual command unit."
        checked={options.gameMode}
        onChange={(checked) => set({ gameMode: checked })}
      />
      <div className="form-grid">
        <label>
          <span>Team color</span>
          <select value={options.teamColor ? 'blue' : 'yellow'} onChange={(event) => set({ teamColor: event.target.value === 'blue' })}>
            <option value="yellow">Yellow</option>
            <option value="blue">Blue</option>
          </select>
        </label>
        <label>
          <span>Field side</span>
          <select value={options.side ? 'minus' : 'plus'} onChange={(event) => set({ side: event.target.value === 'minus' })}>
            <option value="plus">Positive (x+)</option>
            <option value="minus">Negative (x−)</option>
          </select>
        </label>
        <label>
          <span>Goalie ({options.teamColor ? 'Blue' : 'Yellow'})</span>
          <select value={options.goalkeeperId} onChange={(event) => set({ goalkeeperId: Number(event.target.value) })}>
            {!goalieOnTeam ? (
              <option value={options.goalkeeperId}>
                {goalieIds.length === 0 ? `${options.goalkeeperId} — no robots on field` : `${options.goalkeeperId} — not on field`}
              </option>
            ) : null}
            {goalieIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Max speed (mm/s)</span>
          <input
            type="number"
            min="0"
            value={options.maxSpeed}
            onChange={(event) => set({ maxSpeed: Math.max(0, Math.trunc(Number(event.target.value)) || 0) })}
          />
        </label>
      </div>
      <p className="muted small gamemode-hint">
        {options.gameMode
          ? 'CrashPilot is driving — manual commands are ignored.'
          : 'Manual command unit active. Enable game mode to hand over control.'}{' '}
        Max speed 0 = unlimited.
      </p>
      <div className="preview-row">
        <span className="command-preview">
          {options.gameMode ? 'On' : 'Off'} · {options.teamColor ? 'Blue' : 'Yellow'} · {options.side ? 'x−' : 'x+'} · Goalie{' '}
          {options.goalkeeperId} · {options.maxSpeed ? `${options.maxSpeed} mm/s` : 'unlimited'}
        </span>
        <button className="action primary" onClick={onApply}>Apply</button>
      </div>
    </div>
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


function degreesToRadians(value) {
  return (Number(value) * Math.PI) / 180
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
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
  const enemyId = parseOptionalNumber(command.enemyId)

  if (speed != null) payload.speed = speed
  if (orientation != null) payload.orientation = orientation
  if (kickOrientation != null) payload.kickOrientation = kickOrientation
  if (kickSpeed != null) payload.kickSpeed = kickSpeed
  if (enemyId != null) payload.enemyId = enemyId

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
  if (source === 'vision_raw') return 'Raw'
  if (source === 'vision_tracked') return 'Tracked'
  return prettyEnum(source)
}

function formatTimestamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleTimeString()
}
function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key)
      if (stored != null) return JSON.parse(stored)
    } catch {}
    return initial
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {}
  }, [key, value])
  return [value, setValue]
}
