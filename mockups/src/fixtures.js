// One frozen frame of a live match. Shared verbatim by all three style shells
// so the only thing that differs between them is presentation.
//
// States, tasks and modes are taken from the existing implementation
// (frontend/src/App.jsx:3-42) so the density on screen is not fictional.

export const STATE_OPTIONS = [
  'STATE_HALT',
  'STATE_STOP',
  'STATE_FREE',
  'STATE_GOALIE',
  'STATE_SUBSTITUTE',
]

export const TASK_OPTIONS = [
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

export const MODE_OPTIONS = [
  { value: 'MODE_MANUAL', label: 'Manual' },
  { value: 'MODE_GAME', label: 'Game' },
  { value: 'MODE_TEST', label: 'Test' },
]

export const short = (v) => v.replace(/^(STATE|TASK)_/, '')

export const session = {
  id: '01J8QK2P',
  kind: 'Live match',
  blue: 'bangka',
  yellow: 'ungabunga',
  frame: 1708605,
  simTime: '04:12.380',
  wallClock: '18:51:37',
  build: 'v4-a1c93f2',
  protocol: 'v1',
  mode: 'MODE_MANUAL',
  visionSource: 'Tracked',
  division: 'Division B',
  speed: '1.0×',
  clients: 3,
  lastCommand: {
    panel: 'Command Builder',
    workstation: 'bench-left',
    browser: 'b7e1',
    ago: '1.2 s ago',
  },
}

export const debugToken = `${session.build} · ${session.id} · f${session.frame} · ${session.simTime} · w0`

export const robots = [
  // --- blue: bangka, defends -X ---
  { team: 'blue', id: 0, x: -4180, y: 60, o: 0.0, vx: 0, vy: 120, state: 'STATE_GOALIE', task: 'TASK_POS', speed: 1.2, conf: 0.98, age: 8 },
  { team: 'blue', id: 1, x: -2450, y: 1180, o: 0.35, vx: 640, vy: 210, state: 'STATE_FREE', task: 'TASK_POS', speed: 2.0, conf: 0.96, age: 8 },
  { team: 'blue', id: 2, x: -1980, y: -1320, o: -0.2, vx: 210, vy: -480, state: 'STATE_FREE', task: 'TASK_BLOCK', speed: 1.8, conf: 0.91, age: 12 },
  { team: 'blue', id: 3, x: -520, y: 340, o: 0.9, vx: 980, vy: 1240, state: 'STATE_FREE', task: 'TASK_POS', speed: 2.4, conf: 0.99, age: 8, selected: true, target: { x: 980, y: 1250, o: 0.62 }, trajectory: [[-520, 340], [-140, 640], [280, 900], [660, 1110], [980, 1250]] },
  { team: 'blue', id: 4, x: -1240, y: 2210, o: -0.6, vx: 0, vy: 0, state: 'STATE_STOP', task: 'TASK_UNSPECIFIED', speed: 0, conf: 0.72, age: 41, ignored: true },
  { team: 'blue', id: 5, x: 620, y: -1850, o: 1.4, vx: -320, vy: 760, state: 'STATE_FREE', task: 'TASK_REC_KICK', speed: 1.6, conf: 0.94, age: 8 },
  // --- yellow: ungabunga, defends +X ---
  { team: 'yellow', id: 0, x: 4210, y: -40, o: 3.14, vx: 0, vy: -90, state: 'STATE_GOALIE', task: 'TASK_POS', speed: 1.0, conf: 0.97, age: 9 },
  { team: 'yellow', id: 1, x: 2380, y: -980, o: 3.0, vx: -540, vy: 120, state: 'STATE_FREE', task: 'TASK_POS', speed: 1.9, conf: 0.95, age: 9 },
  { team: 'yellow', id: 2, x: 1760, y: 1420, o: -2.6, vx: -720, vy: -340, state: 'STATE_FREE', task: 'TASK_BLOCK', speed: 2.1, conf: 0.93, age: 9 },
  { team: 'yellow', id: 3, x: 240, y: -260, o: 2.2, vx: -140, vy: 90, state: 'STATE_FREE', task: 'TASK_STEAL', speed: 0.9, conf: 0.88, age: 14 },
  { team: 'yellow', id: 4, x: 3120, y: 2050, o: 2.9, vx: -260, vy: -410, state: 'STATE_FREE', task: 'TASK_POS', speed: 1.4, conf: 0.9, age: 9 },
  { team: 'yellow', id: 5, x: 900, y: 900, o: -1.9, vx: 180, vy: -620, state: 'STATE_FREE', task: 'TASK_KICK', speed: 1.1, conf: 0.96, age: 9, kick: { x: 4400, y: -320, speed: 6.5 } },
]

export const ball = {
  x: 120,
  y: -60,
  vx: -1850,
  vy: 640,
  conf: 0.94,
  prediction: [[120, -60], [-360, 105], [-820, 260], [-1240, 400]],
}

// Hologram: where the AI expects blue 3 to be in 500 ms.
export const hologram = { team: 'blue', id: 3, x: 180, y: 890, o: 0.74 }

export const debugLayers = [
  {
    group: 'Play · OffensiveTransition',
    open: true,
    layers: [
      { id: 'play.target', name: 'Target position', on: true, count: 1 },
      { id: 'play.trajectory', name: 'Planned trajectory', on: true, count: 1 },
      { id: 'play.passlanes', name: 'Pass lanes', on: false, count: 4 },
    ],
  },
  {
    group: 'Skill · KickToGoal',
    open: true,
    layers: [
      { id: 'skill.kickline', name: 'Kick line', on: true, count: 1 },
      { id: 'skill.holo', name: 'Hologram robots', on: true, count: 1 },
      { id: 'skill.aim', name: 'Aim cone', on: false, count: 2 },
    ],
  },
  {
    group: 'World',
    open: true,
    layers: [
      { id: 'world.keepout', name: 'Ball keep-out', on: true, count: 1 },
      { id: 'world.zone', name: 'Defensive zone', on: true, count: 1 },
      { id: 'world.heat', name: 'Pressure heatmap', on: true, count: 1 },
      { id: 'world.cov', name: 'Covariance', on: false, count: 12 },
    ],
  },
]

export const commandFeed = [
  { t: '18:51:36.812', robot: 'B3', body: 'FREE · POS  x=980 y=1250 θ=35.5°', origin: 'bench-left / Command Builder', status: 'ack', rtt: '4 ms' },
  { t: '18:51:35.204', robot: 'Y5', body: 'FREE · KICK  θ=−108.9° v=6.5', origin: 'bench-left / Field context', status: 'ack', rtt: '5 ms' },
  { t: '18:51:33.981', robot: 'B4', body: 'STOP · —  (ignored by tracker)', origin: 'bench-right / Task table', status: 'error', rtt: '—', error: 'no feedback for 41 frames' },
  { t: '18:51:31.550', robot: 'B*', body: 'set ignore_robots = [4]', origin: 'bench-left / Properties', status: 'ack', rtt: '3 ms' },
  { t: '18:51:29.117', robot: 'B5', body: 'FREE · REC_KICK  inwall=false', origin: 'bench-left / Command Builder', status: 'ack', rtt: '4 ms' },
  { t: '18:51:27.640', robot: 'Y3', body: 'FREE · STEAL  enemy_id=3', origin: 'laptop-a / Command Builder', status: 'ack', rtt: '7 ms' },
  { t: '18:51:25.002', robot: 'B2', body: 'FREE · BLOCK  raw=true', origin: 'bench-left / Command Builder', status: 'ack', rtt: '4 ms' },
  { t: '18:51:24.388', robot: '—', body: 'vision source → Tracked', origin: 'bench-right / Properties', status: 'ack', rtt: '2 ms' },
  { t: '18:51:22.915', robot: 'B1', body: 'FREE · POS  x=−2450 y=1180', origin: 'bench-left / Command Builder', status: 'ack', rtt: '4 ms' },
  { t: '18:51:20.771', robot: 'Y1', body: 'FREE · POS  speed=1.9', origin: 'laptop-a / Task table', status: 'ack', rtt: '6 ms' },
  { t: '18:51:19.204', robot: 'B0', body: 'GOALIE · POS', origin: 'bench-left / Command Builder', status: 'ack', rtt: '4 ms' },
  { t: '18:51:17.880', robot: '—', body: 'recording started → 18-51-17_01J8QK2P_bangka-ungabunga', origin: 'bench-left / Toolbar', status: 'ack', rtt: '9 ms' },
  { t: '18:51:16.443', robot: 'Y*', body: 'set field_side = defends_positive_x', origin: 'bench-right / Properties', status: 'ack', rtt: '3 ms' },
  { t: '18:51:14.009', robot: '*', body: 'STOP ALL', origin: 'bench-left / Toolbar', status: 'ack', rtt: '2 ms' },
]

export const alerts = [
  {
    level: 'warn',
    title: 'Recording disk write slow',
    body: 'Chunk flush 840 ms (budget 250 ms) · 4 chunks queued · match unaffected',
  },
  {
    level: 'warn',
    title: 'Vision packet age high — blue 4',
    body: 'No tracked detection for 41 frames · robot marked ignored',
  },
]

export const referee = {
  stage: 'NORMAL_SECOND_HALF',
  command: 'FORCE_START',
  next: '—',
  scoreBlue: 2,
  scoreYellow: 1,
  timeoutsBlue: '3 · 04:32',
  timeoutsYellow: '2 · 02:18',
  cards: [{ team: 'yellow', kind: 'Yellow', remaining: '01:47' }],
  placement: '—',
  packetAge: '22 ms',
}

export const timeline = [
  { id: 'e1', at: 0.06, kind: 'kickoff', label: 'Kickoff' },
  { id: 'e2', at: 0.22, kind: 'goal', label: 'Goal · blue' },
  { id: 'e3', at: 0.34, kind: 'foul', label: 'Foul · double touch' },
  { id: 'e4', at: 0.41, kind: 'card', label: 'Yellow card · yellow 2' },
  { id: 'e5', at: 0.55, kind: 'goal', label: 'Goal · yellow' },
  { id: 'e6', at: 0.63, kind: 'bookmark', label: 'Bookmark · bad clearance' },
  { id: 'e7', at: 0.71, kind: 'loss', label: 'Data loss · 3 frames' },
  { id: 'e8', at: 0.86, kind: 'goal', label: 'Goal · blue' },
]

export const playhead = 0.93
export const reviewHead = 0.62

export const health = [
  { label: 'WS', value: 'connected', ok: true },
  { label: 'Controller', value: 'online', ok: true },
  { label: 'Vision', value: 'Tracked · 8 ms', ok: true },
  { label: 'Referee', value: '22 ms', ok: true },
  { label: 'Recording', value: 'lagging', ok: false },
  { label: 'Producer lag', value: '0 dropped', ok: true },
]

export const leftTabs = [
  { id: 'systems', label: 'Systems', icon: '◈' },
  { id: 'sessions', label: 'Sessions', icon: '▤' },
  { id: 'recordings', label: 'Recordings', icon: '◉' },
  { id: 'layers', label: 'Layers', icon: '≡' },
]

export const rightTabs = [
  { id: 'properties', label: 'Properties', icon: '⚙' },
  { id: 'tasks', label: 'Tasks', icon: '☰' },
  { id: 'referee', label: 'Referee', icon: '⚑' },
  { id: 'debug', label: 'Debug', icon: '◇' },
]

export const bottomTabs = [
  { id: 'feed', label: 'Command feed', badge: commandFeed.length },
  { id: 'tasks', label: 'Robot tasks', badge: robots.length },
  { id: 'referee', label: 'Referee', badge: null },
]

// Properties inspector for the selected robot (blue 3).
export const selectedRobot = robots.find((r) => r.selected)

export const properties = [
  { label: 'State', value: 'STATE_FREE', control: 'select' },
  { label: 'Task', value: 'TASK_POS', control: 'select' },
  { label: 'X (mm)', value: '980', control: 'number' },
  { label: 'Y (mm)', value: '1250', control: 'number' },
  { label: 'Speed', value: '2.4', control: 'number' },
  { label: 'Orient. (°)', value: '35.5', control: 'number' },
  { label: 'Kick orient. (°)', value: '', control: 'number' },
  { label: 'Kick speed', value: '', control: 'number' },
  { label: 'Enemy id', value: '', control: 'number' },
  { label: 'Raw movement', value: false, control: 'toggle' },
  { label: 'In wall', value: false, control: 'toggle' },
  { label: 'Ignore robots', value: '4', control: 'text' },
]

export const globalOptions = [
  { label: 'Mode', value: 'Manual' },
  { label: 'Team', value: 'Blue · bangka' },
  { label: 'Field side', value: 'defends −X' },
  { label: 'Goalkeeper', value: '0' },
  { label: 'Vision source', value: 'Tracked' },
  { label: 'Game phase', value: 'Second half' },
  { label: 'Robot limit', value: '6' },
  { label: 'Ball tracking', value: 'On' },
]
