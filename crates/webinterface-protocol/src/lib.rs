//! Canonical, renderer-independent wire contract shared by every interface host.
//!
//! All structures are encoded as named-field maps. Never use MessagePack's
//! positional struct encoder with these types.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

pub const PROTOCOL_VERSION: u32 = 4;
pub const RELOAD_REQUIRED_CLOSE_CODE: u16 = 4409;

pub type SystemId = String;
pub type SessionId = Uuid;
pub type CursorId = Uuid;

#[derive(Debug, Clone, Copy, Default, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Millimetres(pub f64);

#[derive(Debug, Clone, Copy, Default, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MillimetresPerSecond(pub f64);

#[derive(Debug, Clone, Copy, Default, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MillimetresPerSecondSquared(pub f64);

#[derive(Debug, Clone, Copy, Default, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Radians(pub f64);

#[derive(Debug, Clone, Copy, Default, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RadiansPerSecond(pub f64);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TimestampNs(pub u64);

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct PointMm {
  pub x_mm: Millimetres,
  pub y_mm: Millimetres,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Point3Mm {
  pub x_mm: Millimetres,
  pub y_mm: Millimetres,
  pub z_mm: Millimetres,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct VelocityMmPerS {
  pub x_mm_per_s: MillimetresPerSecond,
  pub y_mm_per_s: MillimetresPerSecond,
  pub z_mm_per_s: MillimetresPerSecond,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeamColor {
  Blue,
  Yellow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FieldGeometry {
  pub field_length_mm: Millimetres,
  pub field_width_mm: Millimetres,
  pub goal_width_mm: Millimetres,
  pub goal_depth_mm: Millimetres,
  pub boundary_width_mm: Millimetres,
  pub penalty_area_depth_mm: Millimetres,
  pub penalty_area_width_mm: Millimetres,
  pub center_circle_radius_mm: Millimetres,
  pub line_thickness_mm: Millimetres,
  pub max_robot_radius_mm: Millimetres,
  pub ball_radius_mm: Millimetres,
}

impl Default for FieldGeometry {
  fn default() -> Self {
    Self {
      field_length_mm: Millimetres(9_000.0),
      field_width_mm: Millimetres(6_000.0),
      goal_width_mm: Millimetres(1_000.0),
      goal_depth_mm: Millimetres(180.0),
      boundary_width_mm: Millimetres(300.0),
      penalty_area_depth_mm: Millimetres(1_000.0),
      penalty_area_width_mm: Millimetres(2_000.0),
      center_circle_radius_mm: Millimetres(500.0),
      line_thickness_mm: Millimetres(10.0),
      max_robot_radius_mm: Millimetres(90.0),
      ball_radius_mm: Millimetres(21.5),
    }
  }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BallState {
  pub position: Point3Mm,
  pub velocity: VelocityMmPerS,
  pub visibility: Option<f32>,
  pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RobotState {
  pub id: u32,
  pub team: TeamColor,
  pub position: PointMm,
  pub orientation_rad: Radians,
  pub velocity: VelocityMmPerS,
  pub angular_velocity_rad_per_s: RadiansPerSecond,
  pub visible: bool,
  pub visibility: Option<f32>,
  pub infrared: Option<bool>,
  pub dribbler_enabled: Option<bool>,
  pub task: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Score {
  pub blue: u32,
  pub yellow: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RefereeState {
  pub stage: Option<String>,
  pub command: String,
  pub next_command: Option<String>,
  pub command_counter: u32,
  pub stage_time_left_ns: Option<i64>,
  pub action_time_remaining_ns: Option<i64>,
  pub designated_position: Option<PointMm>,
  pub blue_team_on_positive_half: Option<bool>,
  pub score: Score,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldState {
  pub world_id: u32,
  pub frame: u64,
  pub simulation_time_ns: TimestampNs,
  pub field: FieldGeometry,
  pub ball: Option<BallState>,
  pub robots: Vec<RobotState>,
  pub referee: Option<RefereeState>,
  pub score: Score,
  pub events: Vec<MatchEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MatchEvent {
  pub id: Uuid,
  pub at_ns: TimestampNs,
  pub kind: String,
  pub message: String,
  pub world_id: Option<u32>,
  pub data: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DebugStyle {
  pub stroke: Option<String>,
  pub fill: Option<String>,
  pub stroke_width_mm: Option<Millimetres>,
  pub opacity: f32,
  pub label: Option<String>,
  pub tooltip: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DebugLayer {
  pub id: String,
  pub parent_id: Option<String>,
  pub label: String,
  pub default_visible: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum DebugPrimitive {
  Line {
    from: PointMm,
    to: PointMm,
    style: DebugStyle,
  },
  Arrow {
    from: PointMm,
    to: PointMm,
    style: DebugStyle,
  },
  Polyline {
    points: Vec<PointMm>,
    closed: bool,
    style: DebugStyle,
  },
  Circle {
    center: PointMm,
    radius_mm: Millimetres,
    style: DebugStyle,
  },
  Ellipse {
    center: PointMm,
    radius_x_mm: Millimetres,
    radius_y_mm: Millimetres,
    rotation_rad: Radians,
    style: DebugStyle,
  },
  Rectangle {
    min: PointMm,
    max: PointMm,
    style: DebugStyle,
  },
  Polygon {
    points: Vec<PointMm>,
    style: DebugStyle,
  },
  Arc {
    center: PointMm,
    radius_mm: Millimetres,
    start_rad: Radians,
    end_rad: Radians,
    style: DebugStyle,
  },
  Sector {
    center: PointMm,
    radius_mm: Millimetres,
    start_rad: Radians,
    end_rad: Radians,
    style: DebugStyle,
  },
  Capsule {
    from: PointMm,
    to: PointMm,
    radius_mm: Millimetres,
    style: DebugStyle,
  },
  Marker {
    at: PointMm,
    size_mm: Millimetres,
    style: DebugStyle,
  },
  Text {
    at: PointMm,
    text: String,
    style: DebugStyle,
  },
  RobotPose {
    at: PointMm,
    orientation_rad: Radians,
    team: TeamColor,
    robot_id: Option<u32>,
    style: DebugStyle,
  },
  Heatmap {
    origin: PointMm,
    cell_width_mm: Millimetres,
    cell_height_mm: Millimetres,
    columns: u32,
    rows: u32,
    values: Vec<f32>,
    min: f32,
    max: f32,
    unit: Option<String>,
  },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DebugItem {
  pub id: String,
  pub layer_id: String,
  pub world_id: Option<u32>,
  pub robot_id: Option<u32>,
  pub primitive: DebugPrimitive,
  pub scalar: Option<f64>,
  pub unit: Option<String>,
  pub range: Option<(f64, f64)>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SystemSnapshot {
  pub worlds: Vec<WorldState>,
  pub debug_layers: Vec<DebugLayer>,
  pub debug_items: Vec<DebugItem>,
  pub properties: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemKind {
  CrashPilot,
  Simhark,
  Dehumanized,
  Referris,
  Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capability {
  pub id: String,
  pub mutable: bool,
  pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemDescriptor {
  pub id: SystemId,
  pub label: String,
  pub kind: SystemKind,
  pub generation: u64,
  pub capabilities: Vec<Capability>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthLevel {
  Healthy,
  Degraded,
  Failed,
  Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemHealth {
  pub level: HealthLevel,
  pub message: String,
  pub updated_at_ns: TimestampNs,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionKind {
  LiveMatch,
  Simulation,
  Test,
  Replay,
  LiveReplay,
  Batch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionLifecycle {
  Empty,
  Preparing,
  Running,
  Paused,
  Precomputing,
  Completed,
  Failed,
  Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionDescriptor {
  pub id: SessionId,
  pub label: String,
  pub kind: SessionKind,
  pub lifecycle: SessionLifecycle,
  pub mutable: bool,
  pub created_at_ns: TimestampNs,
  pub system_ids: Vec<SystemId>,
  pub world_count: u32,
  pub live_frame: Option<u64>,
  pub terminal_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ViewerCursor {
  pub id: CursorId,
  pub session_id: SessionId,
  pub live: bool,
  pub frame: Option<u64>,
  pub world_ids: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandOrigin {
  pub browser_instance_id: Uuid,
  pub panel_id: String,
  pub session_id: Option<SessionId>,
  pub viewer_cursor_id: Option<CursorId>,
  pub client_sequence: u64,
  pub workstation_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BrowserCommand {
  pub id: Uuid,
  pub origin: CommandOrigin,
  pub action: CommandAction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum CommandAction {
  System {
    system_id: SystemId,
    command: SystemCommand,
  },
  CreateSession(CreateSessionRequest),
  SetSessionLifecycle {
    session_id: SessionId,
    lifecycle: SessionLifecycle,
  },
  SetViewerCursor(ViewerCursor),
  AddBookmark {
    session_id: SessionId,
    frame: u64,
    label: String,
  },
  AddAnnotation {
    session_id: SessionId,
    frame: u64,
    text: String,
  },
  StartRecording {
    session_id: SessionId,
  },
  StopRecording {
    session_id: SessionId,
  },
  Export {
    session_id: SessionId,
    format: ExportFormat,
    destination: Option<String>,
  },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CreateSessionRequest {
  pub label: String,
  pub kind: SessionKind,
  pub controller: Option<MatchConfiguration>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MatchConfiguration {
  pub blue_controller: String,
  pub yellow_controller: String,
  pub blue_robots: u8,
  pub yellow_robots: u8,
  pub division: String,
  pub seed: u64,
  pub duration_ns: Option<u64>,
  pub batch_count: u32,
  pub precompute: bool,
  pub development: bool,
  pub record: bool,
  pub parameters: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
  FaabsRecording,
  SslLog,
  Json,
  CsvEvents,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum SystemCommand {
  Simhark(SimharkCommand),
  CrashPilot(CrashPilotCommand),
  Developer(DeveloperCommand),
  Referris(ReferrisCommand),
  Custom { capability: String, payload: Value },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum SimharkCommand {
  Start,
  Pause,
  Stop,
  Restart,
  Step {
    frames: i64,
  },
  Skip {
    frames: i64,
  },
  Seek {
    frame: u64,
  },
  SetSpeed {
    multiplier: f64,
  },
  SelectWorlds {
    world_ids: Vec<u32>,
  },
  MoveRobot {
    world_id: u32,
    team: TeamColor,
    id: u32,
    position: PointMm,
  },
  RotateRobot {
    world_id: u32,
    team: TeamColor,
    id: u32,
    orientation_rad: Radians,
  },
  SetRobotPresent {
    world_id: u32,
    team: TeamColor,
    id: u32,
    present: bool,
  },
  MoveBall {
    world_id: u32,
    position: PointMm,
  },
  LaunchMatch(MatchConfiguration),
  CancelSession,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CrashPilotOptions {
  pub mode: CrashPilotMode,
  pub defends_positive_x: bool,
  pub team: TeamColor,
  pub enable_test_field: bool,
  pub test_field: u32,
  pub tracked_ball: bool,
  pub game_controller: bool,
  pub running: bool,
  pub goalkeeper_id: u32,
  pub max_speed_mm_per_s: u32,
  pub test: String,
  pub test_robot_ids: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrashPilotMode {
  Manual,
  Game,
  Test,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RobotManualCommand {
  pub robot_ids: Vec<u32>,
  pub state: String,
  pub task: String,
  pub position: Option<PointMm>,
  pub speed_mm_per_s: Option<u32>,
  pub raw: Option<bool>,
  pub in_wall: Option<bool>,
  pub ignore_robots: Vec<u32>,
  pub orientation_millirad: Option<u32>,
  pub kick_orientation_millirad: Option<u32>,
  pub kick_speed: Option<u32>,
  pub enemy_id: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum CrashPilotCommand {
  SetOptions(CrashPilotOptions),
  SendRobotCommand(RobotManualCommand),
  HaltAll,
  StopAll,
  Reconnect,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum DeveloperCommand {
  Activate {
    target: String,
    kind: String,
    entry: String,
    config: Value,
    params: Value,
  },
  Disable {
    target: String,
  },
  SwitchAi {
    target: String,
    ai: String,
  },
  SetBallRecovery {
    target: String,
    enabled: bool,
  },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ReferrisCommand {
  Start,
  Stop,
  Reset,
  SetConfiguration(Value),
  EmitEvent(Value),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandStatus {
  Accepted,
  Applied,
  Rejected,
  Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandAcknowledgement {
  pub command_id: Uuid,
  pub status: CommandStatus,
  pub message: String,
  pub accepted_at_ns: TimestampNs,
  pub completed_at_ns: Option<TimestampNs>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StateEnvelope {
  pub system_id: SystemId,
  pub generation: u64,
  pub session_id: SessionId,
  pub sequence: u64,
  pub published_at_ns: TimestampNs,
  pub snapshot: SystemSnapshot,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventEnvelope {
  pub system_id: SystemId,
  pub generation: u64,
  pub session_id: SessionId,
  pub sequence: u64,
  pub published_at_ns: TimestampNs,
  pub event: DurableEvent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum DurableEvent {
  Match(MatchEvent),
  Lifecycle {
    lifecycle: SessionLifecycle,
    message: Option<String>,
  },
  Command(BrowserCommand),
  CommandAcknowledgement(CommandAcknowledgement),
  DataLoss {
    producer: String,
    dropped: u64,
  },
  RecordingError {
    message: String,
  },
  Bookmark {
    frame: u64,
    label: String,
  },
  Annotation {
    frame: u64,
    text: String,
  },
  Custom {
    kind: String,
    payload: Value,
  },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientHello {
  pub protocol_version: u32,
  pub asset_build_fingerprint: String,
  pub browser_instance_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ServerControl {
  HelloAccepted {
    protocol_version: u32,
    server_build_fingerprint: String,
    connected_browsers: usize,
  },
  ReloadRequired {
    expected_protocol_version: u32,
    expected_build_fingerprint: String,
    reason: String,
  },
  ProtocolError {
    message: String,
  },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ClientMessage {
  Command(BrowserCommand),
  Ping { nonce: u64 },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ServerMessage {
  InitialState {
    systems: Vec<SystemDescriptor>,
    sessions: Vec<SessionDescriptor>,
    snapshots: Vec<StateEnvelope>,
  },
  State(StateEnvelope),
  Event(EventEnvelope),
  System(SystemDescriptor),
  CommandAcknowledgement(CommandAcknowledgement),
  SystemHealth {
    system_id: SystemId,
    health: SystemHealth,
  },
  Session(SessionDescriptor),
  Pong {
    nonce: u64,
  },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bootstrap {
  pub protocol_version: u32,
  pub server_build_fingerprint: String,
  pub asset_build_fingerprint: String,
  pub capabilities: Vec<String>,
  pub systems: Vec<SystemDescriptor>,
  pub sessions: Vec<SessionDescriptor>,
  pub connected_browsers: usize,
  pub last_accepted_command_origin: Option<CommandOrigin>,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn tagged_enums_have_stable_named_json_shape() {
    let command = SystemCommand::Simhark(SimharkCommand::Pause);
    let encoded = serde_json::to_value(&command).unwrap();
    assert_eq!(encoded["type"], "simhark");
    assert_eq!(encoded["data"]["type"], "pause");
  }

  #[test]
  fn asymmetric_coordinate_fixture_does_not_transform_canonical_state() {
    let point = PointMm {
      x_mm: Millimetres(-1234.5),
      y_mm: Millimetres(678.25),
    };
    let value = serde_json::to_value(point).unwrap();
    assert_eq!(value["x_mm"], -1234.5);
    assert_eq!(value["y_mm"], 678.25);
  }

  #[test]
  fn json_and_named_messagepack_round_trip_to_the_same_command() {
    let command = ClientMessage::Command(BrowserCommand {
      id: Uuid::new_v4(),
      origin: CommandOrigin {
        browser_instance_id: Uuid::new_v4(),
        panel_id: "field".into(),
        session_id: None,
        viewer_cursor_id: None,
        client_sequence: 7,
        workstation_label: Some("operator-left".into()),
      },
      action: CommandAction::System {
        system_id: "simhark".into(),
        command: SystemCommand::Simhark(SimharkCommand::MoveBall {
          world_id: 2,
          position: PointMm {
            x_mm: Millimetres(-4321.0),
            y_mm: Millimetres(765.5),
          },
        }),
      },
    });
    let json: ClientMessage =
      serde_json::from_slice(&serde_json::to_vec(&command).unwrap()).unwrap();
    let messagepack: ClientMessage =
      rmp_serde::from_slice(&rmp_serde::to_vec_named(&command).unwrap()).unwrap();
    assert_eq!(json, command);
    assert_eq!(messagepack, command);
  }
}
