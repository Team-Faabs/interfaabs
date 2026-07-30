//! CrashPilot protobuf adapter and compatibility WebSocket client.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use prost::Message;
use serde_json::{Value, json};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite;
use webinterface_core::{InterfaceError, InterfaceHandle, QueuedSystemCommand, SystemPublisher};
use webinterface_protocol::{
  BallState, Capability, CrashPilotCommand, CrashPilotMode, CrashPilotOptions, FieldGeometry,
  HealthLevel, Millimetres, MillimetresPerSecond, Point3Mm, PointMm, Radians, RadiansPerSecond,
  RefereeState, RobotManualCommand, RobotState, Score, SessionId, SystemCommand, SystemDescriptor,
  SystemKind, SystemSnapshot, TeamColor, TimestampNs, VelocityMmPerS, WorldState,
};

pub mod proto {
  include!(concat!(env!("OUT_DIR"), "/_.rs"));
}

#[derive(Debug, Clone)]
pub struct LegacyBridgeConfig {
  pub websocket_url: String,
  pub reconnect_delay: Duration,
}

impl Default for LegacyBridgeConfig {
  fn default() -> Self {
    Self {
      websocket_url: "ws://127.0.0.1:4096/ws".into(),
      reconnect_delay: Duration::from_secs(2),
    }
  }
}

#[derive(Debug, Error)]
pub enum BridgeError {
  #[error("interface host error: {0}")]
  Host(#[from] InterfaceError),
  #[error("CrashPilot protobuf decode failed: {0}")]
  Decode(#[from] prost::DecodeError),
  #[error("CrashPilot websocket failed: {0}")]
  WebSocket(#[from] tungstenite::Error),
  #[error("unsupported CrashPilot command")]
  UnsupportedCommand,
}

pub struct CrashPilotAdapter {
  publisher: SystemPublisher,
  commands: mpsc::UnboundedReceiver<QueuedSystemCommand>,
  session_id: SessionId,
  field: FieldGeometry,
  options: CrashPilotOptions,
  known_robot_ids: BTreeSet<u32>,
}

impl CrashPilotAdapter {
  pub fn register(handle: &InterfaceHandle, session_id: SessionId) -> Result<Self, InterfaceError> {
    Self::register_with_id(handle, session_id, "crashpilot", "CrashPilot")
  }

  pub fn register_with_id(
    handle: &InterfaceHandle,
    session_id: SessionId,
    system_id: impl Into<String>,
    label: impl Into<String>,
  ) -> Result<Self, InterfaceError> {
    let system_id = system_id.into();
    let registered = handle.register_system(SystemDescriptor {
      id: system_id,
      label: label.into(),
      kind: SystemKind::CrashPilot,
      generation: 1,
      capabilities: vec![
        capability("crashpilot.options", true),
        capability("crashpilot.robot_command", true),
        capability("crashpilot.halt_all", true),
        capability("crashpilot.stop_all", true),
        capability("crashpilot.vision", false),
        capability("crashpilot.referee", false),
        capability("crashpilot.world_model_quality", false),
      ],
    })?;
    Ok(Self {
      publisher: registered.publisher,
      commands: registered.commands,
      session_id,
      field: FieldGeometry::default(),
      options: default_options(),
      known_robot_ids: BTreeSet::new(),
    })
  }

  pub fn ingest_bytes(&mut self, bytes: &[u8]) -> Result<(), BridgeError> {
    let wrapper = proto::CpInterfaceWrapper::decode(bytes)?;
    self.ingest(wrapper)
  }

  pub fn ingest(&mut self, wrapper: proto::CpInterfaceWrapper) -> Result<(), BridgeError> {
    if let Some(field) = field_from_wrapper(&wrapper) {
      self.field = field;
    }
    let snapshot = canonical_snapshot(&wrapper, self.field.clone(), &mut self.known_robot_ids);
    self.publisher.publish(self.session_id, snapshot)?;
    self
      .publisher
      .health(HealthLevel::Healthy, "CrashPilot stream connected");
    Ok(())
  }

  pub fn try_next_command_bytes(&mut self) -> Result<Option<(uuid::Uuid, Vec<u8>)>, BridgeError> {
    let Ok(queued) = self.commands.try_recv() else {
      return Ok(None);
    };
    let SystemCommand::CrashPilot(command) = queued.command else {
      self.publisher.acknowledge(
        queued.browser_command_id,
        webinterface_protocol::CommandStatus::Rejected,
        "command is not a CrashPilot command",
      );
      return Err(BridgeError::UnsupportedCommand);
    };
    let packet = encode_command(command, &mut self.options, &self.known_robot_ids)?;
    Ok(Some((queued.browser_command_id, packet.encode_to_vec())))
  }

  pub async fn next_command_bytes(&mut self) -> Result<(uuid::Uuid, Vec<u8>), BridgeError> {
    loop {
      let Some(queued) = self.commands.recv().await else {
        return Err(BridgeError::UnsupportedCommand);
      };
      let SystemCommand::CrashPilot(command) = queued.command else {
        self.publisher.acknowledge(
          queued.browser_command_id,
          webinterface_protocol::CommandStatus::Rejected,
          "command is not a CrashPilot command",
        );
        continue;
      };
      let packet = encode_command(command, &mut self.options, &self.known_robot_ids)?;
      return Ok((queued.browser_command_id, packet.encode_to_vec()));
    }
  }
}

pub async fn run_legacy_controller(
  mut adapter: CrashPilotAdapter,
  config: LegacyBridgeConfig,
) -> Result<(), BridgeError> {
  loop {
    match tokio_tungstenite::connect_async(&config.websocket_url).await {
      Ok((socket, _)) => {
        adapter
          .publisher
          .health(HealthLevel::Healthy, "connected to CrashPilot");
        let (mut outgoing, mut incoming) = socket.split();
        loop {
          tokio::select! {
            frame = incoming.next() => {
              match frame {
                Some(Ok(tungstenite::Message::Binary(bytes))) => {
                  if let Err(error) = adapter.ingest_bytes(&bytes) {
                    adapter.publisher.health(HealthLevel::Degraded, error.to_string());
                  }
                }
                Some(Ok(tungstenite::Message::Close(_))) | None => break,
                Some(Err(error)) => {
                  adapter.publisher.health(HealthLevel::Degraded, error.to_string());
                  break;
                }
                _ => {}
              }
            }
            command = adapter.next_command_bytes() => {
              let Ok((command_id, bytes)) = command else {
                continue;
              };
              if let Err(error) = outgoing.send(tungstenite::Message::Binary(bytes.into())).await {
                adapter.publisher.health(HealthLevel::Degraded, error.to_string());
                break;
              }
              adapter.publisher.acknowledge(
                command_id,
                webinterface_protocol::CommandStatus::Applied,
                "sent to CrashPilot",
              );
            }
          }
        }
      }
      Err(error) => {
        adapter.publisher.health(
          HealthLevel::Degraded,
          format!("CrashPilot reconnect pending: {error}"),
        );
      }
    }
    adapter
      .publisher
      .health(HealthLevel::Degraded, "CrashPilot stream disconnected");
    tokio::time::sleep(config.reconnect_delay).await;
  }
}

pub fn canonical_snapshot(
  wrapper: &proto::CpInterfaceWrapper,
  field: FieldGeometry,
  known_robot_ids: &mut BTreeSet<u32>,
) -> SystemSnapshot {
  let tracked = wrapper
    .vision_filtered
    .as_ref()
    .and_then(|wrapper| wrapper.tracked_frame.as_ref())
    .or_else(|| {
      wrapper
        .vision_tracked
        .as_ref()
        .and_then(|wrapper| wrapper.tracked_frame.as_ref())
    })
    .or_else(|| {
      wrapper
        .vision_tracked_sources
        .iter()
        .find_map(|wrapper| wrapper.tracked_frame.as_ref())
    });

  let (frame, simulation_time_ns, ball, mut robots) = if let Some(tracked) = tracked {
    let ball = tracked.balls.first().map(tracked_ball);
    let robots = tracked
      .robots
      .iter()
      .filter_map(tracked_robot)
      .collect::<Vec<_>>();
    (
      tracked.frame_number as u64,
      seconds_to_ns(tracked.timestamp),
      ball,
      robots,
    )
  } else if let Some(raw) = wrapper
    .vision_raw
    .as_ref()
    .and_then(|wrapper| wrapper.detection.as_ref())
    .or_else(|| {
      wrapper
        .vision_raw_sources
        .iter()
        .find_map(|wrapper| wrapper.detection.as_ref())
    })
  {
    let ball = raw.balls.first().map(|ball| BallState {
      position: Point3Mm {
        x_mm: Millimetres(ball.x as f64),
        y_mm: Millimetres(ball.y as f64),
        z_mm: Millimetres(ball.z.unwrap_or_default() as f64),
      },
      velocity: VelocityMmPerS::default(),
      visibility: Some(ball.confidence),
      source: Some(format!("camera-{}", raw.camera_id)),
    });
    let mut robots = raw
      .robots_blue
      .iter()
      .filter_map(|robot| raw_robot(robot, TeamColor::Blue))
      .collect::<Vec<_>>();
    robots.extend(
      raw
        .robots_yellow
        .iter()
        .filter_map(|robot| raw_robot(robot, TeamColor::Yellow)),
    );
    (
      raw.frame_number as u64,
      seconds_to_ns(raw.t_capture),
      ball,
      robots,
    )
  } else {
    (0, TimestampNs(0), None, Vec::new())
  };

  let tasks = wrapper
    .robot_commands
    .iter()
    .map(|robot| {
      known_robot_ids.insert(robot.robot_id);
      (
        (robot.robot_id, robot.infos.team_color),
        format!(
          "{} / {}",
          proto::CpState::try_from(robot.cmd.state)
            .map_or("STATE_UNSPECIFIED", |value| value.as_str_name()),
          proto::CpTask::try_from(robot.cmd.task)
            .map_or("TASK_UNSPECIFIED", |value| value.as_str_name())
        ),
      )
    })
    .collect::<BTreeMap<_, _>>();
  for robot in &mut robots {
    known_robot_ids.insert(robot.id);
    robot.task = tasks
      .get(&(robot.id, robot.team == TeamColor::Blue))
      .cloned();
  }

  let referee = wrapper.gc_data.as_ref().map(map_referee);
  let score = referee
    .as_ref()
    .map(|referee| referee.score.clone())
    .unwrap_or(Score { blue: 0, yellow: 0 });
  let properties = properties(wrapper);
  SystemSnapshot {
    worlds: vec![WorldState {
      world_id: 0,
      frame,
      simulation_time_ns,
      field,
      ball,
      robots,
      referee,
      score,
      events: Vec::new(),
    }],
    debug_layers: Vec::new(),
    debug_items: Vec::new(),
    properties,
  }
}

pub fn encode_command(
  command: CrashPilotCommand,
  options: &mut CrashPilotOptions,
  known_robot_ids: &BTreeSet<u32>,
) -> Result<proto::InterfaceWrapperCp, BridgeError> {
  let mut robot_commands = Vec::new();
  match command {
    CrashPilotCommand::SetOptions(new_options) => *options = new_options,
    CrashPilotCommand::SendRobotCommand(command) => {
      robot_commands = manual_robot_commands(&command)?;
    }
    CrashPilotCommand::HaltAll => {
      robot_commands = emergency_commands(known_robot_ids, proto::CpState::StateHalt);
    }
    CrashPilotCommand::StopAll => {
      robot_commands = emergency_commands(known_robot_ids, proto::CpState::StateStop);
    }
    CrashPilotCommand::Reconnect => return Err(BridgeError::UnsupportedCommand),
  }

  Ok(proto::InterfaceWrapperCp {
    robot_commands,
    interface_command: proto::InterfaceCommandCp {
      mode: match options.mode {
        CrashPilotMode::Manual => proto::CpMode::ModeManual as i32,
        CrashPilotMode::Game => proto::CpMode::ModeGame as i32,
        CrashPilotMode::Test => proto::CpMode::ModeTest as i32,
      },
      manual: proto::InterfaceManualCp {
        enable_testfield: options.enable_test_field,
        testfield: options.test_field,
        ball_tracked: options.tracked_ball,
        gc_data: options.game_controller,
      },
      game: proto::InterfaceGameCp {
        running: options.running,
        goalkeeper_id: options.goalkeeper_id,
        max_speed: options.max_speed_mm_per_s,
      },
      test: proto::InterfaceTestCp {
        test: proto::CpTests::from_str_name(&options.test).unwrap_or(proto::CpTests::TestNone)
          as i32,
        robot_ids: options.test_robot_ids.clone(),
      },
      side: !options.defends_positive_x,
      team_color: options.team == TeamColor::Blue,
    },
  })
}

fn manual_robot_commands(
  command: &RobotManualCommand,
) -> Result<Vec<proto::InterfaceRobotCommandsCp>, BridgeError> {
  let state =
    proto::CpState::from_str_name(&command.state).ok_or(BridgeError::UnsupportedCommand)? as i32;
  let task =
    proto::CpTask::from_str_name(&command.task).ok_or(BridgeError::UnsupportedCommand)? as i32;
  let cp_command = proto::CpCommand {
    state,
    task,
    pos: command.position.map(|point| proto::CpVector2 {
      x: point.x_mm.0.round() as i32,
      y: point.y_mm.0.round() as i32,
    }),
    speed: command.speed_mm_per_s,
    raw: command.raw,
    inwall: command.in_wall,
    ignore_robots: command.ignore_robots.clone(),
    orientation: command.orientation_millirad,
    kick_orient: command.kick_orientation_millirad,
    kick_speed: command.kick_speed,
    enemy_id: command.enemy_id,
  };
  Ok(
    command
      .robot_ids
      .iter()
      .copied()
      .map(|robot_id| proto::InterfaceRobotCommandsCp {
        robot_id,
        command: cp_command.clone(),
      })
      .collect(),
  )
}

fn emergency_commands(
  ids: &BTreeSet<u32>,
  state: proto::CpState,
) -> Vec<proto::InterfaceRobotCommandsCp> {
  ids
    .iter()
    .copied()
    .map(|robot_id| proto::InterfaceRobotCommandsCp {
      robot_id,
      command: proto::CpCommand {
        state: state as i32,
        task: proto::CpTask::TaskUnspecified as i32,
        ..Default::default()
      },
    })
    .collect()
}

fn tracked_ball(ball: &proto::TrackedBall) -> BallState {
  let velocity = ball.vel.unwrap_or_default();
  BallState {
    position: Point3Mm {
      x_mm: Millimetres(ball.pos.x as f64 * 1000.0),
      y_mm: Millimetres(ball.pos.y as f64 * 1000.0),
      z_mm: Millimetres(ball.pos.z as f64 * 1000.0),
    },
    velocity: VelocityMmPerS {
      x_mm_per_s: MillimetresPerSecond(velocity.x as f64 * 1000.0),
      y_mm_per_s: MillimetresPerSecond(velocity.y as f64 * 1000.0),
      z_mm_per_s: MillimetresPerSecond(velocity.z as f64 * 1000.0),
    },
    visibility: ball.visibility,
    source: Some("tracked".into()),
  }
}

fn tracked_robot(robot: &proto::TrackedRobot) -> Option<RobotState> {
  let team = match robot
    .robot_id
    .team
    .and_then(|team| proto::Team::try_from(team).ok())
  {
    Some(proto::Team::Blue) => TeamColor::Blue,
    Some(proto::Team::Yellow) => TeamColor::Yellow,
    _ => return None,
  };
  let velocity = robot.vel.unwrap_or_default();
  Some(RobotState {
    id: robot.robot_id.id?,
    team,
    position: PointMm {
      x_mm: Millimetres(robot.pos.x as f64 * 1000.0),
      y_mm: Millimetres(robot.pos.y as f64 * 1000.0),
    },
    orientation_rad: Radians(robot.orientation as f64),
    velocity: VelocityMmPerS {
      x_mm_per_s: MillimetresPerSecond(velocity.x as f64 * 1000.0),
      y_mm_per_s: MillimetresPerSecond(velocity.y as f64 * 1000.0),
      z_mm_per_s: MillimetresPerSecond(0.0),
    },
    angular_velocity_rad_per_s: RadiansPerSecond(robot.vel_angular.unwrap_or_default() as f64),
    visible: robot.visibility.unwrap_or(1.0) > 0.0,
    visibility: robot.visibility,
    infrared: None,
    dribbler_enabled: None,
    task: None,
  })
}

fn raw_robot(robot: &proto::SslDetectionRobot, team: TeamColor) -> Option<RobotState> {
  Some(RobotState {
    id: robot.robot_id?,
    team,
    position: PointMm {
      x_mm: Millimetres(robot.x as f64),
      y_mm: Millimetres(robot.y as f64),
    },
    orientation_rad: Radians(robot.orientation.unwrap_or_default() as f64),
    velocity: VelocityMmPerS::default(),
    angular_velocity_rad_per_s: RadiansPerSecond(0.0),
    visible: robot.confidence > 0.0,
    visibility: Some(robot.confidence),
    infrared: None,
    dribbler_enabled: None,
    task: None,
  })
}

fn field_from_wrapper(wrapper: &proto::CpInterfaceWrapper) -> Option<FieldGeometry> {
  wrapper
    .vision_raw
    .iter()
    .chain(wrapper.vision_raw_sources.iter())
    .find_map(|packet| packet.geometry.as_ref())
    .map(|geometry| {
      let field = &geometry.field;
      FieldGeometry {
        field_length_mm: Millimetres(field.field_length as f64),
        field_width_mm: Millimetres(field.field_width as f64),
        goal_width_mm: Millimetres(field.goal_width as f64),
        goal_depth_mm: Millimetres(field.goal_depth as f64),
        boundary_width_mm: Millimetres(field.boundary_width as f64),
        penalty_area_depth_mm: Millimetres(field.penalty_area_depth.unwrap_or(1000) as f64),
        penalty_area_width_mm: Millimetres(field.penalty_area_width.unwrap_or(2000) as f64),
        center_circle_radius_mm: Millimetres(field.center_circle_radius.unwrap_or(500) as f64),
        line_thickness_mm: Millimetres(field.line_thickness.unwrap_or(10) as f64),
        max_robot_radius_mm: Millimetres(field.max_robot_radius.unwrap_or(90.0) as f64),
        ball_radius_mm: Millimetres(field.ball_radius.unwrap_or(21.5) as f64),
      }
    })
}

fn map_referee(referee: &proto::Referee) -> RefereeState {
  RefereeState {
    stage: proto::referee::Stage::try_from(referee.stage)
      .ok()
      .map(|stage| stage.as_str_name().to_string()),
    command: proto::referee::Command::try_from(referee.command)
      .map_or_else(|_| "UNKNOWN".into(), |command| command.as_str_name().into()),
    next_command: referee.next_command.and_then(|command| {
      proto::referee::Command::try_from(command)
        .ok()
        .map(|command| command.as_str_name().into())
    }),
    command_counter: referee.command_counter,
    stage_time_left_ns: referee
      .stage_time_left
      .map(|microseconds| microseconds.saturating_mul(1000)),
    action_time_remaining_ns: referee
      .current_action_time_remaining
      .map(|microseconds| microseconds.saturating_mul(1000)),
    designated_position: referee.designated_position.map(|point| PointMm {
      x_mm: Millimetres(point.x as f64),
      y_mm: Millimetres(point.y as f64),
    }),
    blue_team_on_positive_half: referee.blue_team_on_positive_half,
    score: Score {
      blue: referee.blue.score,
      yellow: referee.yellow.score,
    },
  }
}

fn properties(wrapper: &proto::CpInterfaceWrapper) -> BTreeMap<String, Value> {
  let mut properties = BTreeMap::new();
  properties.insert(
    "vision.raw_sources".into(),
    json!(wrapper.vision_raw_sources.len()),
  );
  properties.insert(
    "vision.tracked_sources".into(),
    json!(wrapper.vision_tracked_sources.len()),
  );
  properties.insert(
    "commands".into(),
    Value::Array(
      wrapper
        .robot_commands
        .iter()
        .map(|robot| {
          json!({
            "robot_id": robot.robot_id,
            "packet_id": robot.packet_id,
            "timestamp": robot.timestamp,
            "state": proto::CpState::try_from(robot.cmd.state).ok().map(|value| value.as_str_name()),
            "task": proto::CpTask::try_from(robot.cmd.task).ok().map(|value| value.as_str_name()),
            "speed_mm_per_s": robot.cmd.speed,
            "orientation": robot.cmd.orientation,
            "kick_orientation": robot.cmd.kick_orient,
            "kick_speed": robot.cmd.kick_speed,
            "enemy_id": robot.cmd.enemy_id,
          })
        })
        .collect(),
    ),
  );
  if let Some(phase) = &wrapper.cp_gamephase {
    properties.insert(
      "game_phase".into(),
      json!({
        "game": phase.game_phase.and_then(|value| proto::cp_game_phase::GamePhase::try_from(value).ok()).map(|value| value.as_str_name()),
        "preparation": phase.prep_phase.and_then(|value| proto::cp_game_phase::PrepPhase::try_from(value).ok()).map(|value| value.as_str_name()),
      }),
    );
  }
  if let Some(quality) = &wrapper.world_model_quality {
    properties.insert(
      "world_model_quality".into(),
      json!({
        "timestamp": quality.timestamp,
        "ball_confidence": quality.ball.map(|quality| quality.overall_confidence),
        "robots": quality.robots.iter().map(|quality| json!({
          "robot_id": quality.robot_id,
          "team": quality.team,
          "valid": quality.valid,
          "confidence": quality.overall_confidence,
          "measurement_age_s": quality.measurement_age_s,
          "trajectory_confidence": quality.trajectory_confidence,
        })).collect::<Vec<_>>(),
      }),
    );
  }
  properties
}

fn seconds_to_ns(seconds: f64) -> TimestampNs {
  if seconds.is_finite() && seconds > 0.0 {
    TimestampNs((seconds * 1_000_000_000.0).min(u64::MAX as f64) as u64)
  } else {
    TimestampNs(0)
  }
}

fn default_options() -> CrashPilotOptions {
  CrashPilotOptions {
    mode: CrashPilotMode::Manual,
    defends_positive_x: true,
    team: TeamColor::Yellow,
    enable_test_field: false,
    test_field: 0,
    tracked_ball: true,
    game_controller: true,
    running: false,
    goalkeeper_id: 0,
    max_speed_mm_per_s: 0,
    test: "TEST_NONE".into(),
    test_robot_ids: Vec::new(),
  }
}

fn capability(id: &str, mutable: bool) -> Capability {
  Capability {
    id: id.into(),
    mutable,
    description: id.replace('.', " "),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn tracked_metres_convert_to_canonical_millimetres_without_mirroring() {
    let mut known = BTreeSet::new();
    let snapshot = canonical_snapshot(
      &proto::CpInterfaceWrapper {
        vision_tracked: Some(proto::TrackerWrapperPacket {
          uuid: "fixture".into(),
          source_name: Some("fixture".into()),
          tracked_frame: Some(proto::TrackedFrame {
            frame_number: 7,
            timestamp: 1.25,
            balls: vec![proto::TrackedBall {
              pos: proto::Vector3 {
                x: -1.2345,
                y: 0.67825,
                z: 0.0,
              },
              vel: None,
              visibility: Some(1.0),
            }],
            robots: Vec::new(),
            kicked_ball: None,
            capabilities: Vec::new(),
          }),
        }),
        ..Default::default()
      },
      FieldGeometry::default(),
      &mut known,
    );
    let ball = snapshot.worlds[0].ball.as_ref().unwrap();
    assert!((ball.position.x_mm.0 - -1234.5).abs() < 0.001);
    assert!((ball.position.y_mm.0 - 678.25).abs() < 0.001);
  }

  #[test]
  fn emergency_command_targets_all_known_robots() {
    let ids = BTreeSet::from([1, 4, 9]);
    let mut options = default_options();
    let packet = encode_command(CrashPilotCommand::HaltAll, &mut options, &ids).unwrap();
    assert_eq!(packet.robot_commands.len(), 3);
    assert!(
      packet
        .robot_commands
        .iter()
        .all(|command| command.command.state == proto::CpState::StateHalt as i32)
    );
  }
}
