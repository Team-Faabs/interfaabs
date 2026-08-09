// Hand-written mirror of `crates/webinterface-protocol/src/lib.rs`.
//
// Field names are kept exactly as they go over the wire (snake_case, unit
// suffixes) so there is no mapping layer to drift out of sync. Tagged enums
// use serde's adjacent tagging: `{ type, data }`, with `data` absent for unit
// variants.

export const PROTOCOL_VERSION = 5
export const RELOAD_REQUIRED_CLOSE_CODE = 4409

export type SystemId = string
export type SessionId = string
export type CursorId = string
export type Uuid = string

/** Nanoseconds. Values above 2^53 lose sub-microsecond precision in JS. */
export type TimestampNs = number

export interface PointMm {
  x_mm: number
  y_mm: number
}

export interface Point3Mm {
  x_mm: number
  y_mm: number
  z_mm: number
}

export interface VelocityMmPerS {
  x_mm_per_s: number
  y_mm_per_s: number
  z_mm_per_s: number
}

export type TeamColor = 'blue' | 'yellow'

export interface FieldGeometry {
  field_length_mm: number
  field_width_mm: number
  goal_width_mm: number
  goal_depth_mm: number
  boundary_width_mm: number
  penalty_area_depth_mm: number
  penalty_area_width_mm: number
  center_circle_radius_mm: number
  line_thickness_mm: number
  max_robot_radius_mm: number
  ball_radius_mm: number
}

export const DEFAULT_FIELD_GEOMETRY: FieldGeometry = {
  field_length_mm: 9000,
  field_width_mm: 6000,
  goal_width_mm: 1000,
  goal_depth_mm: 180,
  boundary_width_mm: 300,
  penalty_area_depth_mm: 1000,
  penalty_area_width_mm: 2000,
  center_circle_radius_mm: 500,
  line_thickness_mm: 10,
  max_robot_radius_mm: 90,
  ball_radius_mm: 21.5,
}

export interface BallState {
  position: Point3Mm
  velocity: VelocityMmPerS
  visibility: number | null
  source: string | null
}

export interface RobotState {
  id: number
  team: TeamColor
  position: PointMm
  orientation_rad: number
  velocity: VelocityMmPerS
  angular_velocity_rad_per_s: number
  visible: boolean
  visibility: number | null
  infrared: boolean | null
  dribbler_enabled: boolean | null
  task: string | null
}

export interface Score {
  blue: number
  yellow: number
}

export interface RefereeState {
  stage: string | null
  command: string
  next_command: string | null
  command_counter: number
  stage_time_left_ns: number | null
  action_time_remaining_ns: number | null
  designated_position: PointMm | null
  blue_team_on_positive_half: boolean | null
  score: Score
}

export interface WorldState {
  world_id: number
  frame: number
  simulation_time_ns: TimestampNs
  field: FieldGeometry
  ball: BallState | null
  robots: RobotState[]
  referee: RefereeState | null
  score: Score
  events: MatchEvent[]
}

export interface MatchEvent {
  id: Uuid
  at_ns: TimestampNs
  kind: string
  message: string
  world_id: number | null
  data: unknown
}

export interface DebugStyle {
  stroke: string | null
  fill: string | null
  stroke_width_mm: number | null
  opacity: number
  label: string | null
  tooltip: string | null
}

export interface DebugLayer {
  id: string
  parent_id: string | null
  label: string
  default_visible: boolean
}

export type DebugPrimitive =
  | { type: 'line'; data: { from: PointMm; to: PointMm; style: DebugStyle } }
  | { type: 'arrow'; data: { from: PointMm; to: PointMm; style: DebugStyle } }
  | {
      type: 'polyline'
      data: { points: PointMm[]; closed: boolean; style: DebugStyle }
    }
  | {
      type: 'circle'
      data: { center: PointMm; radius_mm: number; style: DebugStyle }
    }
  | {
      type: 'ellipse'
      data: {
        center: PointMm
        radius_x_mm: number
        radius_y_mm: number
        rotation_rad: number
        style: DebugStyle
      }
    }
  | { type: 'rectangle'; data: { min: PointMm; max: PointMm; style: DebugStyle } }
  | { type: 'polygon'; data: { points: PointMm[]; style: DebugStyle } }
  | {
      type: 'arc'
      data: {
        center: PointMm
        radius_mm: number
        start_rad: number
        end_rad: number
        style: DebugStyle
      }
    }
  | {
      type: 'sector'
      data: {
        center: PointMm
        radius_mm: number
        start_rad: number
        end_rad: number
        style: DebugStyle
      }
    }
  | {
      type: 'capsule'
      data: { from: PointMm; to: PointMm; radius_mm: number; style: DebugStyle }
    }
  | { type: 'marker'; data: { at: PointMm; size_mm: number; style: DebugStyle } }
  | { type: 'text'; data: { at: PointMm; text: string; style: DebugStyle } }
  | {
      type: 'robot_pose'
      data: {
        at: PointMm
        orientation_rad: number
        team: TeamColor
        robot_id: number | null
        style: DebugStyle
      }
    }
  | {
      type: 'heatmap'
      data: {
        origin: PointMm
        cell_width_mm: number
        cell_height_mm: number
        columns: number
        rows: number
        values: number[]
        min: number
        max: number
        unit: string | null
      }
    }

export interface DebugItem {
  id: string
  layer_id: string
  world_id: number | null
  robot_id: number | null
  primitive: DebugPrimitive
  scalar: number | null
  unit: string | null
  range: [number, number] | null
}

export interface SystemSnapshot {
  worlds: WorldState[]
  debug_layers: DebugLayer[]
  debug_items: DebugItem[]
  properties: Record<string, unknown>
}

export type SystemKind =
  | 'crash_pilot'
  | 'simhark'
  | 'dehumanized'
  | 'referris'
  | 'other'

export interface Capability {
  id: string
  mutable: boolean
  description: string
}

export interface SystemDescriptor {
  id: SystemId
  label: string
  kind: SystemKind
  generation: number
  capabilities: Capability[]
}

export type HealthLevel = 'healthy' | 'degraded' | 'failed' | 'unavailable'

export interface SystemHealth {
  level: HealthLevel
  message: string
  updated_at_ns: TimestampNs
}

export type SessionKind =
  | 'live_match'
  | 'simulation'
  | 'test'
  | 'replay'
  | 'live_replay'
  | 'batch'

export type SessionLifecycle =
  | 'empty'
  | 'preparing'
  | 'running'
  | 'paused'
  | 'precomputing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface SessionDescriptor {
  id: SessionId
  label: string
  kind: SessionKind
  lifecycle: SessionLifecycle
  mutable: boolean
  created_at_ns: TimestampNs
  system_ids: SystemId[]
  world_count: number
  live_frame: number | null
  terminal_error: string | null
}

export interface ViewerCursor {
  id: CursorId
  session_id: SessionId
  live: boolean
  frame: number | null
  world_ids: number[]
}

export interface CommandOrigin {
  browser_instance_id: Uuid
  panel_id: string
  session_id: SessionId | null
  viewer_cursor_id: CursorId | null
  client_sequence: number
  workstation_label: string | null
}

export interface BrowserCommand {
  id: Uuid
  origin: CommandOrigin
  action: CommandAction
}

export type ExportFormat = 'faabs_recording' | 'ssl_log' | 'json' | 'csv_events'

export type RecordingFormat = 'faabsrec' | 'shreplay' | 'ssl_log' | 'ssl_log_gz'

export interface RecordingSummary {
  /** Host-assigned and opaque. Never a filesystem path. */
  id: string
  label: string
  format: RecordingFormat
  size_bytes: number
  modified_at_ns: TimestampNs
  frame_count: number | null
  duration_ns: number | null
  session_kind: SessionKind | null
  /** A `.partial` file from a crash or a run still in progress. */
  partial: boolean
  /** Set when the file exists but could not be summarised. */
  error: string | null
}

export interface MatchConfiguration {
  blue_controller: string
  yellow_controller: string
  blue_robots: number
  yellow_robots: number
  division: string
  seed: number
  duration_ns: number | null
  batch_count: number
  precompute: boolean
  development: boolean
  record: boolean
  parameters: Record<string, unknown>
}

export interface CreateSessionRequest {
  label: string
  kind: SessionKind
  controller: MatchConfiguration | null
}

export type CommandAction =
  | { type: 'system'; data: { system_id: SystemId; command: SystemCommand } }
  | { type: 'create_session'; data: CreateSessionRequest }
  | {
      type: 'set_session_lifecycle'
      data: { session_id: SessionId; lifecycle: SessionLifecycle }
    }
  | { type: 'set_viewer_cursor'; data: ViewerCursor }
  | {
      type: 'add_bookmark'
      data: { session_id: SessionId; frame: number; label: string }
    }
  | {
      type: 'add_annotation'
      data: { session_id: SessionId; frame: number; text: string }
    }
  | { type: 'refresh_recordings' }
  | { type: 'open_recording'; data: { recording_id: string } }
  | { type: 'start_recording'; data: { session_id: SessionId } }
  | { type: 'stop_recording'; data: { session_id: SessionId } }
  | {
      type: 'export'
      data: {
        session_id: SessionId
        format: ExportFormat
        destination: string | null
      }
    }

export type SystemCommand =
  | { type: 'simhark'; data: SimharkCommand }
  | { type: 'crash_pilot'; data: CrashPilotCommand }
  | { type: 'developer'; data: DeveloperCommand }
  | { type: 'referris'; data: ReferrisCommand }
  | { type: 'custom'; data: { capability: string; payload: unknown } }

export type SimharkCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'restart' }
  | { type: 'step'; data: { frames: number } }
  | { type: 'skip'; data: { frames: number } }
  | { type: 'seek'; data: { frame: number } }
  | { type: 'set_speed'; data: { multiplier: number } }
  | { type: 'select_worlds'; data: { world_ids: number[] } }
  | {
      type: 'move_robot'
      data: {
        world_id: number
        team: TeamColor
        id: number
        position: PointMm
      }
    }
  | {
      type: 'rotate_robot'
      data: {
        world_id: number
        team: TeamColor
        id: number
        orientation_rad: number
      }
    }
  | {
      type: 'set_robot_present'
      data: { world_id: number; team: TeamColor; id: number; present: boolean }
    }
  | { type: 'move_ball'; data: { world_id: number; position: PointMm } }
  | { type: 'launch_match'; data: MatchConfiguration }
  | { type: 'cancel_session' }

export type CrashPilotMode = 'manual' | 'game' | 'test'

export interface CrashPilotOptions {
  mode: CrashPilotMode
  defends_positive_x: boolean
  team: TeamColor
  enable_test_field: boolean
  test_field: number
  tracked_ball: boolean
  game_controller: boolean
  running: boolean
  goalkeeper_id: number
  max_speed_mm_per_s: number
  test: string
  test_robot_ids: number[]
}

export interface RobotManualCommand {
  robot_ids: number[]
  state: string
  task: string
  position: PointMm | null
  speed_mm_per_s: number | null
  raw: boolean | null
  in_wall: boolean | null
  ignore_robots: number[]
  orientation_millirad: number | null
  kick_orientation_millirad: number | null
  kick_speed: number | null
  enemy_id: number | null
}

export type CrashPilotCommand =
  | { type: 'set_options'; data: CrashPilotOptions }
  | { type: 'send_robot_command'; data: RobotManualCommand }
  | { type: 'halt_all' }
  | { type: 'stop_all' }
  | { type: 'reconnect' }

/**
 * The AI Lab lifecycle. Loading an entry and running it are separate steps:
 * a registry entry keeps state once instantiated, so editing a parameter must
 * never silently restart a run.
 */
export type DeveloperCommand =
  | {
      type: 'load'
      data: {
        target: string
        kind: string
        entry: string
        config: unknown
        params: unknown
      }
    }
  | { type: 'start'; data: { target: string } }
  | { type: 'stop'; data: { target: string } }
  | { type: 'disable'; data: { target: string } }
  | { type: 'switch_ai'; data: { target: string; ai: string } }
  | { type: 'set_ball_recovery'; data: { target: string; enabled: boolean } }

export type DeveloperRunState =
  | 'idle'
  | 'loaded'
  | 'running'
  | 'finished'
  | 'stopped'
  | 'failed'

/**
 * One AI Lab target as published in `SystemSnapshot.properties.developer`.
 * This travels as an opaque property rather than a protocol field: the shape
 * belongs to whichever host owns the registry.
 */
export interface DeveloperRun {
  target: string
  kind: string | null
  entry: string | null
  state: DeveloperRunState
  message: string
  started_frame: number | null
  finished_frame: number | null
}

export interface DeveloperResult {
  target: string
  entry: string | null
  ok: boolean
  message: string
}

export interface DeveloperSnapshot {
  schema: unknown
  results: Record<string, DeveloperResult>
  runs: Record<string, DeveloperRun>
}

export type ReferrisCommand =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'set_configuration'; data: unknown }
  | { type: 'emit_event'; data: unknown }

export type CommandStatus = 'accepted' | 'applied' | 'rejected' | 'failed'

export interface CommandAcknowledgement {
  command_id: Uuid
  status: CommandStatus
  message: string
  accepted_at_ns: TimestampNs
  completed_at_ns: TimestampNs | null
}

export interface StateEnvelope {
  system_id: SystemId
  generation: number
  session_id: SessionId
  sequence: number
  published_at_ns: TimestampNs
  snapshot: SystemSnapshot
  /**
   * `null` for the live head, which every browser sees. Set when the envelope
   * answers one viewer cursor's seek, so it is routed to the panel bound to
   * that cursor rather than replacing the live world.
   *
   * Optional on the wire: a host built before this field existed omits it.
   */
  cursor_id?: CursorId | null
}

export interface EventEnvelope {
  system_id: SystemId
  generation: number
  session_id: SessionId
  sequence: number
  published_at_ns: TimestampNs
  event: DurableEvent
}

export type DurableEvent =
  | { type: 'match'; data: MatchEvent }
  | {
      type: 'lifecycle'
      data: { lifecycle: SessionLifecycle; message: string | null }
    }
  | { type: 'command'; data: BrowserCommand }
  | { type: 'command_acknowledgement'; data: CommandAcknowledgement }
  | { type: 'data_loss'; data: { producer: string; dropped: number } }
  | { type: 'recording_error'; data: { message: string } }
  | { type: 'bookmark'; data: { frame: number; label: string } }
  | { type: 'annotation'; data: { frame: number; text: string } }
  | { type: 'custom'; data: { kind: string; payload: unknown } }

export interface ClientHello {
  protocol_version: number
  asset_build_fingerprint: string
  browser_instance_id: Uuid
}

export type ServerControl =
  | {
      type: 'hello_accepted'
      data: {
        protocol_version: number
        server_build_fingerprint: string
        connected_browsers: number
      }
    }
  | {
      type: 'reload_required'
      data: {
        expected_protocol_version: number
        expected_build_fingerprint: string
        reason: string
      }
    }
  | { type: 'protocol_error'; data: { message: string } }

export type ClientMessage =
  | { type: 'command'; data: BrowserCommand }
  | { type: 'ping'; data: { nonce: number } }

export type ServerMessage =
  | {
      type: 'initial_state'
      data: {
        systems: SystemDescriptor[]
        sessions: SessionDescriptor[]
        snapshots: StateEnvelope[]
      }
    }
  | { type: 'state'; data: StateEnvelope }
  | { type: 'event'; data: EventEnvelope }
  | { type: 'system'; data: SystemDescriptor }
  | { type: 'command_acknowledgement'; data: CommandAcknowledgement }
  | {
      type: 'system_health'
      data: { system_id: SystemId; health: SystemHealth }
    }
  | { type: 'session'; data: SessionDescriptor }
  | { type: 'recordings'; data: { recordings: RecordingSummary[] } }
  | { type: 'pong'; data: { nonce: number } }

export interface Bootstrap {
  protocol_version: number
  server_build_fingerprint: string
  asset_build_fingerprint: string
  capabilities: string[]
  systems: SystemDescriptor[]
  sessions: SessionDescriptor[]
  connected_browsers: number
  last_accepted_command_origin: CommandOrigin | null
}
