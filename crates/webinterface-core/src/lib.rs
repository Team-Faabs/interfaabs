//! Shared Rust host for CrashPilot, simhark, replay, and debug adapters.

use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::Body;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderValue, Response, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use parking_lot::{Mutex, RwLock};
use thiserror::Error;
use tokio::sync::{broadcast, mpsc, oneshot};
use tower_http::trace::TraceLayer;
use uuid::Uuid;
use webinterface_protocol::{
  Bootstrap, BrowserCommand, ClientHello, ClientMessage, CommandAcknowledgement, CommandAction,
  CommandOrigin, CommandStatus, DurableEvent, EventEnvelope, HealthLevel, PROTOCOL_VERSION,
  RELOAD_REQUIRED_CLOSE_CODE, ServerControl, ServerMessage, SessionDescriptor, SessionId,
  SessionKind, SessionLifecycle, StateEnvelope, SystemCommand, SystemDescriptor, SystemHealth,
  SystemId, SystemSnapshot, TimestampNs, ViewerCursor,
};
use webinterface_recording::{
  RecordedItem, RecordingError, RecordingHeader, RecordingMode, RecordingWriter,
};

pub trait AssetSource: Send + Sync + 'static {
  fn fingerprint(&self) -> &str;
  fn get(&self, path: &str) -> Option<Asset>;
}

#[derive(Debug, Clone)]
pub struct Asset {
  pub content_type: String,
  pub bytes: Arc<[u8]>,
  pub immutable: bool,
}

#[derive(Default)]
pub struct BlankAssetSource;

impl AssetSource for BlankAssetSource {
  fn fingerprint(&self) -> &str {
    "backend-only"
  }

  fn get(&self, path: &str) -> Option<Asset> {
    let path = path.trim_start_matches('/');
    if !path.is_empty() && path != "index.html" {
      return None;
    }
    Some(Asset {
      content_type: "text/html; charset=utf-8".into(),
      bytes: Arc::from(
        b"<!doctype html><html><head><meta charset=\"UTF-8\"><title>FAABS Interface</title></head><body><div id=\"root\"></div></body></html>"
          .as_slice(),
      ),
      immutable: false,
    })
  }
}

#[derive(Clone)]
pub struct InterfaceConfig {
  pub bind_address: SocketAddr,
  pub server_build_fingerprint: String,
  pub assets: Arc<dyn AssetSource>,
  pub recording_mode: RecordingMode,
  pub broadcast_capacity: usize,
}

impl Default for InterfaceConfig {
  fn default() -> Self {
    Self {
      bind_address: SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 8080),
      server_build_fingerprint: option_env!("VERGEN_GIT_SHA")
        .unwrap_or(env!("CARGO_PKG_VERSION"))
        .to_string(),
      assets: Arc::new(BlankAssetSource),
      recording_mode: RecordingMode::default(),
      broadcast_capacity: 1024,
    }
  }
}

#[derive(Debug, Error)]
pub enum InterfaceError {
  #[error("failed to bind interface at {address}: {source}")]
  Bind {
    address: SocketAddr,
    source: std::io::Error,
  },
  #[error("interface runtime failed to start: {0}")]
  Runtime(String),
  #[error("system {0} is already registered")]
  DuplicateSystem(String),
  #[error("unknown system {0}")]
  UnknownSystem(String),
  #[error("unknown session {0}")]
  UnknownSession(SessionId),
  #[error("command rejected: {0}")]
  CommandRejected(String),
  #[error("recording error: {0}")]
  Recording(#[from] RecordingError),
}

#[derive(Debug, Clone)]
pub struct QueuedSystemCommand {
  pub browser_command_id: Uuid,
  pub origin: CommandOrigin,
  pub command: SystemCommand,
}

pub struct RegisteredSystem {
  pub publisher: SystemPublisher,
  pub commands: mpsc::UnboundedReceiver<QueuedSystemCommand>,
}

#[derive(Clone)]
pub struct SystemPublisher {
  inner: Arc<Inner>,
  system_id: SystemId,
  generation: u64,
  sequence: Arc<AtomicU64>,
}

impl SystemPublisher {
  pub fn publish(
    &self,
    session_id: SessionId,
    snapshot: SystemSnapshot,
  ) -> Result<(), InterfaceError> {
    let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
    let envelope = StateEnvelope {
      system_id: self.system_id.clone(),
      generation: self.generation,
      session_id,
      sequence,
      published_at_ns: now_ns(),
      snapshot,
    };
    self.inner.publish_state(envelope)
  }

  pub fn event(&self, session_id: SessionId, event: DurableEvent) -> Result<(), InterfaceError> {
    let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
    let envelope = EventEnvelope {
      system_id: self.system_id.clone(),
      generation: self.generation,
      session_id,
      sequence,
      published_at_ns: now_ns(),
      event,
    };
    self.inner.publish_event(envelope)
  }

  pub fn health(&self, level: HealthLevel, message: impl Into<String>) {
    let health = SystemHealth {
      level,
      message: message.into(),
      updated_at_ns: now_ns(),
    };
    if let Some(system) = self.inner.systems.read().get(&self.system_id) {
      *system.health.write() = health.clone();
    }
    let _ = self.inner.broadcast.send(ServerMessage::SystemHealth {
      system_id: self.system_id.clone(),
      health,
    });
  }

  pub fn acknowledge(&self, command_id: Uuid, status: CommandStatus, message: impl Into<String>) {
    let ack = CommandAcknowledgement {
      command_id,
      status,
      message: message.into(),
      accepted_at_ns: now_ns(),
      completed_at_ns: Some(now_ns()),
    };
    if let Some(Some(session_id)) = self.inner.pending_commands.lock().remove(&command_id) {
      let _ = self.inner.synthetic_event(
        session_id,
        DurableEvent::CommandAcknowledgement(ack.clone()),
      );
    }
    let _ = self
      .inner
      .broadcast
      .send(ServerMessage::CommandAcknowledgement(ack));
  }
}

pub struct InterfaceHost;

pub struct InterfaceHostGuard {
  shutdown: Option<oneshot::Sender<()>>,
  thread: Option<thread::JoinHandle<()>>,
}

impl Drop for InterfaceHostGuard {
  fn drop(&mut self) {
    if let Some(shutdown) = self.shutdown.take() {
      let _ = shutdown.send(());
    }
    if let Some(thread) = self.thread.take() {
      let _ = thread.join();
    }
  }
}

#[derive(Clone)]
pub struct InterfaceHandle {
  inner: Arc<Inner>,
}

struct SystemEntry {
  descriptor: SystemDescriptor,
  commands: mpsc::UnboundedSender<QueuedSystemCommand>,
  health: RwLock<SystemHealth>,
}

struct Inner {
  config: InterfaceConfig,
  local_address: RwLock<SocketAddr>,
  systems: RwLock<BTreeMap<SystemId, Arc<SystemEntry>>>,
  sessions: RwLock<BTreeMap<SessionId, SessionDescriptor>>,
  cursors: RwLock<BTreeMap<Uuid, ViewerCursor>>,
  snapshots: RwLock<BTreeMap<(SystemId, SessionId), StateEnvelope>>,
  broadcast: broadcast::Sender<ServerMessage>,
  connected_browsers: AtomicUsize,
  last_command_origin: RwLock<Option<CommandOrigin>>,
  recordings: Mutex<BTreeMap<SessionId, RecordingWriter>>,
  pending_commands: Mutex<BTreeMap<Uuid, Option<SessionId>>>,
  interface_sequence: AtomicU64,
  shutting_down: AtomicBool,
}

impl InterfaceHost {
  pub fn start(
    config: InterfaceConfig,
  ) -> Result<(InterfaceHostGuard, InterfaceHandle), InterfaceError> {
    let (broadcast, _) = broadcast::channel(config.broadcast_capacity.max(16));
    let inner = Arc::new(Inner {
      local_address: RwLock::new(config.bind_address),
      config,
      systems: RwLock::new(BTreeMap::new()),
      sessions: RwLock::new(BTreeMap::new()),
      cursors: RwLock::new(BTreeMap::new()),
      snapshots: RwLock::new(BTreeMap::new()),
      broadcast,
      connected_browsers: AtomicUsize::new(0),
      last_command_origin: RwLock::new(None),
      recordings: Mutex::new(BTreeMap::new()),
      pending_commands: Mutex::new(BTreeMap::new()),
      interface_sequence: AtomicU64::new(0),
      shutting_down: AtomicBool::new(false),
    });

    let std_listener =
      std::net::TcpListener::bind(inner.config.bind_address).map_err(|source| {
        InterfaceError::Bind {
          address: inner.config.bind_address,
          source,
        }
      })?;
    std_listener
      .set_nonblocking(true)
      .map_err(|source| InterfaceError::Bind {
        address: inner.config.bind_address,
        source,
      })?;
    let local_address = std_listener
      .local_addr()
      .map_err(|source| InterfaceError::Bind {
        address: inner.config.bind_address,
        source,
      })?;
    *inner.local_address.write() = local_address;

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel(1);
    let server_inner = Arc::clone(&inner);
    let thread = thread::Builder::new()
      .name("faabs-interface-host".into())
      .spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
          .enable_all()
          .thread_name("faabs-interface-worker")
          .build()
        {
          Ok(runtime) => runtime,
          Err(error) => {
            let _ = started_tx.send(Err(error.to_string()));
            return;
          }
        };
        runtime.block_on(async move {
          let listener = match tokio::net::TcpListener::from_std(std_listener) {
            Ok(listener) => listener,
            Err(error) => {
              let _ = started_tx.send(Err(error.to_string()));
              return;
            }
          };
          let router = router(Arc::clone(&server_inner));
          let _ = started_tx.send(Ok(()));
          let server = axum::serve(listener, router).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
          });
          if let Err(error) = server.await {
            tracing::error!(%error, "interface server stopped with an error");
          }
          server_inner.shutting_down.store(true, Ordering::Relaxed);
          let recordings = std::mem::take(&mut *server_inner.recordings.lock());
          for (_, writer) in recordings {
            if let Err(error) = writer.finalize(
              SessionLifecycle::Cancelled,
              Some("interface host shut down".into()),
            ) {
              tracing::error!(%error, "failed to finalize recording during shutdown");
            }
          }
        });
      })
      .map_err(|error| InterfaceError::Runtime(error.to_string()))?;

    match started_rx.recv() {
      Ok(Ok(())) => Ok((
        InterfaceHostGuard {
          shutdown: Some(shutdown_tx),
          thread: Some(thread),
        },
        InterfaceHandle { inner },
      )),
      Ok(Err(error)) => {
        let _ = thread.join();
        Err(InterfaceError::Runtime(error))
      }
      Err(error) => {
        let _ = thread.join();
        Err(InterfaceError::Runtime(error.to_string()))
      }
    }
  }
}

impl InterfaceHandle {
  pub fn local_address(&self) -> SocketAddr {
    *self.inner.local_address.read()
  }

  pub fn http_url(&self) -> String {
    let address = self.local_address();
    let host = if address.ip().is_unspecified() {
      match address.ip() {
        IpAddr::V4(_) => "127.0.0.1".into(),
        IpAddr::V6(_) => "[::1]".into(),
      }
    } else {
      address.ip().to_string()
    };
    format!("http://{host}:{}", address.port())
  }

  pub fn bootstrap(&self) -> Bootstrap {
    self.inner.bootstrap()
  }

  pub fn register_system(
    &self,
    descriptor: SystemDescriptor,
  ) -> Result<RegisteredSystem, InterfaceError> {
    let mut systems = self.inner.systems.write();
    if systems.contains_key(&descriptor.id) {
      return Err(InterfaceError::DuplicateSystem(descriptor.id));
    }
    let (tx, rx) = mpsc::unbounded_channel();
    let sequence = Arc::new(AtomicU64::new(0));
    let publisher = SystemPublisher {
      inner: Arc::clone(&self.inner),
      system_id: descriptor.id.clone(),
      generation: descriptor.generation,
      sequence: Arc::clone(&sequence),
    };
    systems.insert(
      descriptor.id.clone(),
      Arc::new(SystemEntry {
        descriptor: descriptor.clone(),
        commands: tx,
        health: RwLock::new(SystemHealth {
          level: HealthLevel::Healthy,
          message: "registered".into(),
          updated_at_ns: now_ns(),
        }),
      }),
    );
    drop(systems);
    let _ = self.inner.broadcast.send(ServerMessage::System(descriptor));
    Ok(RegisteredSystem {
      publisher,
      commands: rx,
    })
  }

  pub fn unregister_system(&self, system_id: &str) -> bool {
    self.inner.systems.write().remove(system_id).is_some()
  }

  pub fn create_session(
    &self,
    label: impl Into<String>,
    kind: SessionKind,
    mutable: bool,
    system_ids: Vec<SystemId>,
    world_count: u32,
  ) -> SessionDescriptor {
    let session = SessionDescriptor {
      id: Uuid::new_v4(),
      label: label.into(),
      kind,
      lifecycle: SessionLifecycle::Empty,
      mutable,
      created_at_ns: now_ns(),
      system_ids,
      world_count,
      live_frame: None,
      terminal_error: None,
    };
    self
      .inner
      .sessions
      .write()
      .insert(session.id, session.clone());
    let _ = self
      .inner
      .broadcast
      .send(ServerMessage::Session(session.clone()));
    session
  }

  pub fn update_session(
    &self,
    session_id: SessionId,
    lifecycle: SessionLifecycle,
    terminal_error: Option<String>,
  ) -> Result<SessionDescriptor, InterfaceError> {
    let mut sessions = self.inner.sessions.write();
    let session = sessions
      .get_mut(&session_id)
      .ok_or(InterfaceError::UnknownSession(session_id))?;
    session.lifecycle = lifecycle.clone();
    session.terminal_error = terminal_error.clone();
    if matches!(
      lifecycle,
      SessionLifecycle::Completed | SessionLifecycle::Failed | SessionLifecycle::Cancelled
    ) {
      session.mutable = false;
    }
    let updated = session.clone();
    drop(sessions);
    let _ = self.inner.synthetic_event(
      session_id,
      DurableEvent::Lifecycle {
        lifecycle: lifecycle.clone(),
        message: terminal_error.clone(),
      },
    );
    let _ = self
      .inner
      .broadcast
      .send(ServerMessage::Session(updated.clone()));

    if let Some(writer) = self.inner.recordings.lock().remove(&session_id) {
      writer.finalize(lifecycle, terminal_error)?;
    }
    Ok(updated)
  }

  pub fn start_recording(&self, session_id: SessionId) -> Result<(), InterfaceError> {
    let session = self
      .inner
      .sessions
      .read()
      .get(&session_id)
      .cloned()
      .ok_or(InterfaceError::UnknownSession(session_id))?;
    let header = RecordingHeader::new(
      PROTOCOL_VERSION,
      now_ns().0,
      &self.inner.config.server_build_fingerprint,
      session.clone(),
    );
    let writer = RecordingWriter::create(
      self.inner.config.recording_mode.clone(),
      header,
      &format!("{}_{}", session.label, session.id),
    )?;
    self.inner.recordings.lock().insert(session_id, writer);
    Ok(())
  }

  pub fn stop_recording(&self, session_id: SessionId) -> Result<(), InterfaceError> {
    if let Some(writer) = self.inner.recordings.lock().remove(&session_id) {
      let lifecycle = self
        .inner
        .sessions
        .read()
        .get(&session_id)
        .map(|session| session.lifecycle.clone())
        .unwrap_or(SessionLifecycle::Completed);
      writer.finalize(lifecycle, None)?;
    }
    Ok(())
  }

  pub fn set_viewer_cursor(&self, cursor: ViewerCursor) -> Result<(), InterfaceError> {
    if !self.inner.sessions.read().contains_key(&cursor.session_id) {
      return Err(InterfaceError::UnknownSession(cursor.session_id));
    }
    self.inner.cursors.write().insert(cursor.id, cursor);
    Ok(())
  }

  pub fn submit_browser_command(
    &self,
    command: BrowserCommand,
  ) -> Result<CommandAcknowledgement, InterfaceError> {
    self.inner.submit_command(command)
  }
}

impl Inner {
  fn bootstrap(&self) -> Bootstrap {
    Bootstrap {
      protocol_version: PROTOCOL_VERSION,
      server_build_fingerprint: self.config.server_build_fingerprint.clone(),
      asset_build_fingerprint: self.config.assets.fingerprint().to_string(),
      capabilities: vec![
        "sessions".into(),
        "recording".into(),
        "live_replay".into(),
        "named_messagepack".into(),
      ],
      systems: self
        .systems
        .read()
        .values()
        .map(|system| system.descriptor.clone())
        .collect(),
      sessions: self.sessions.read().values().cloned().collect(),
      connected_browsers: self.connected_browsers.load(Ordering::Relaxed),
      last_accepted_command_origin: self.last_command_origin.read().clone(),
    }
  }

  fn initial_state(&self) -> ServerMessage {
    ServerMessage::InitialState {
      systems: self
        .systems
        .read()
        .values()
        .map(|system| system.descriptor.clone())
        .collect(),
      sessions: self.sessions.read().values().cloned().collect(),
      snapshots: self.snapshots.read().values().cloned().collect(),
    }
  }

  fn publish_state(&self, envelope: StateEnvelope) -> Result<(), InterfaceError> {
    if !self.systems.read().contains_key(&envelope.system_id) {
      return Err(InterfaceError::UnknownSystem(envelope.system_id));
    }
    if !self.sessions.read().contains_key(&envelope.session_id) {
      return Err(InterfaceError::UnknownSession(envelope.session_id));
    }
    if let Some(frame) = envelope
      .snapshot
      .worlds
      .iter()
      .map(|world| world.frame)
      .max()
      && let Some(session) = self.sessions.write().get_mut(&envelope.session_id)
    {
      session.live_frame = Some(frame);
    }
    self.snapshots.write().insert(
      (envelope.system_id.clone(), envelope.session_id),
      envelope.clone(),
    );
    self.record(envelope.session_id, RecordedItem::State(envelope.clone()));
    let _ = self.broadcast.send(ServerMessage::State(envelope));
    Ok(())
  }

  fn publish_event(&self, envelope: EventEnvelope) -> Result<(), InterfaceError> {
    if !self.sessions.read().contains_key(&envelope.session_id) {
      return Err(InterfaceError::UnknownSession(envelope.session_id));
    }
    self.record(envelope.session_id, RecordedItem::Event(envelope.clone()));
    let _ = self.broadcast.send(ServerMessage::Event(envelope));
    Ok(())
  }

  fn record(&self, session_id: SessionId, item: RecordedItem) {
    let error = self
      .recordings
      .lock()
      .get_mut(&session_id)
      .and_then(|writer| writer.append(item).err());
    if let Some(error) = error {
      let _ = self.broadcast.send(ServerMessage::SystemHealth {
        system_id: "recording".into(),
        health: SystemHealth {
          level: HealthLevel::Failed,
          message: error.to_string(),
          updated_at_ns: now_ns(),
        },
      });
    }
  }

  fn submit_command(
    &self,
    command: BrowserCommand,
  ) -> Result<CommandAcknowledgement, InterfaceError> {
    self.validate_origin(&command)?;
    let now = now_ns();
    let mut ack = CommandAcknowledgement {
      command_id: command.id,
      status: CommandStatus::Accepted,
      message: "accepted".into(),
      accepted_at_ns: now,
      completed_at_ns: None,
    };
    if let Some(session_id) = command.origin.session_id {
      let _ = self.synthetic_event(session_id, DurableEvent::Command(command.clone()));
    }

    match &command.action {
      CommandAction::System {
        system_id,
        command: system_command,
      } => {
        let system = self
          .systems
          .read()
          .get(system_id)
          .cloned()
          .ok_or_else(|| InterfaceError::UnknownSystem(system_id.clone()))?;
        self
          .pending_commands
          .lock()
          .insert(command.id, command.origin.session_id);
        if system
          .commands
          .send(QueuedSystemCommand {
            browser_command_id: command.id,
            origin: command.origin.clone(),
            command: system_command.clone(),
          })
          .is_err()
        {
          self.pending_commands.lock().remove(&command.id);
          return Err(InterfaceError::CommandRejected(format!(
            "system {system_id} is offline"
          )));
        }
      }
      CommandAction::SetViewerCursor(cursor) => {
        if !self.sessions.read().contains_key(&cursor.session_id) {
          return Err(InterfaceError::UnknownSession(cursor.session_id));
        }
        self.cursors.write().insert(cursor.id, cursor.clone());
        ack.status = CommandStatus::Applied;
        ack.completed_at_ns = Some(now_ns());
      }
      CommandAction::SetSessionLifecycle {
        session_id,
        lifecycle,
      } => {
        let mut sessions = self.sessions.write();
        let session = sessions
          .get_mut(session_id)
          .ok_or(InterfaceError::UnknownSession(*session_id))?;
        session.lifecycle = lifecycle.clone();
        let updated = session.clone();
        drop(sessions);
        let _ = self.synthetic_event(
          *session_id,
          DurableEvent::Lifecycle {
            lifecycle: lifecycle.clone(),
            message: None,
          },
        );
        let _ = self.broadcast.send(ServerMessage::Session(updated));
        ack.status = CommandStatus::Applied;
        ack.completed_at_ns = Some(now_ns());
      }
      CommandAction::StartRecording { session_id } => {
        drop(self.start_recording_internal(*session_id)?);
        ack.status = CommandStatus::Applied;
        ack.completed_at_ns = Some(now_ns());
      }
      CommandAction::StopRecording { session_id } => {
        if let Some(writer) = self.recordings.lock().remove(session_id) {
          writer.finalize(SessionLifecycle::Completed, None)?;
        }
        ack.status = CommandStatus::Applied;
        ack.completed_at_ns = Some(now_ns());
      }
      CommandAction::CreateSession(request) => {
        let session = SessionDescriptor {
          id: Uuid::new_v4(),
          label: request.label.clone(),
          kind: request.kind.clone(),
          lifecycle: SessionLifecycle::Preparing,
          mutable: !matches!(request.kind, SessionKind::Replay),
          created_at_ns: now_ns(),
          system_ids: Vec::new(),
          world_count: request.controller.as_ref().map_or(0, |_| 1),
          live_frame: None,
          terminal_error: None,
        };
        self.sessions.write().insert(session.id, session.clone());
        let _ = self.broadcast.send(ServerMessage::Session(session));
        ack.status = CommandStatus::Applied;
        ack.completed_at_ns = Some(now_ns());
      }
      CommandAction::AddBookmark {
        session_id,
        frame,
        label,
      } => {
        self.synthetic_event(
          *session_id,
          DurableEvent::Bookmark {
            frame: *frame,
            label: label.clone(),
          },
        )?;
        ack.status = CommandStatus::Applied;
        ack.completed_at_ns = Some(now_ns());
      }
      CommandAction::AddAnnotation {
        session_id,
        frame,
        text,
      } => {
        self.synthetic_event(
          *session_id,
          DurableEvent::Annotation {
            frame: *frame,
            text: text.clone(),
          },
        )?;
        ack.status = CommandStatus::Applied;
        ack.completed_at_ns = Some(now_ns());
      }
      CommandAction::Export { .. } => {
        return Err(InterfaceError::CommandRejected(
          "exports require an adapter-provided destination".into(),
        ));
      }
    }

    *self.last_command_origin.write() = Some(command.origin.clone());
    if let Some(session_id) = command.origin.session_id {
      let _ = self.synthetic_event(
        session_id,
        DurableEvent::CommandAcknowledgement(ack.clone()),
      );
    }
    let _ = self
      .broadcast
      .send(ServerMessage::CommandAcknowledgement(ack.clone()));
    Ok(ack)
  }

  fn validate_origin(&self, command: &BrowserCommand) -> Result<(), InterfaceError> {
    if let Some(session_id) = command.origin.session_id {
      let session = self
        .sessions
        .read()
        .get(&session_id)
        .cloned()
        .ok_or(InterfaceError::UnknownSession(session_id))?;
      let mutating = !matches!(command.action, CommandAction::SetViewerCursor(_));
      if mutating && !session.mutable {
        return Err(InterfaceError::CommandRejected(
          "historical or completed sessions are read-only".into(),
        ));
      }
    }
    if let Some(cursor_id) = command.origin.viewer_cursor_id {
      let cursor = self
        .cursors
        .read()
        .get(&cursor_id)
        .cloned()
        .ok_or_else(|| InterfaceError::CommandRejected("unknown viewer cursor".into()))?;
      if !cursor.live && matches!(command.action, CommandAction::System { .. }) {
        return Err(InterfaceError::CommandRejected(
          "system mutations are forbidden from a historical cursor".into(),
        ));
      }
    }
    Ok(())
  }

  fn synthetic_event(
    &self,
    session_id: SessionId,
    event: DurableEvent,
  ) -> Result<(), InterfaceError> {
    self.publish_event(EventEnvelope {
      system_id: "interface-host".into(),
      generation: 1,
      session_id,
      sequence: self.interface_sequence.fetch_add(1, Ordering::Relaxed) + 1,
      published_at_ns: now_ns(),
      event,
    })
  }

  fn start_recording_internal(
    &self,
    session_id: SessionId,
  ) -> Result<Option<RecordingWriter>, InterfaceError> {
    let session = self
      .sessions
      .read()
      .get(&session_id)
      .cloned()
      .ok_or(InterfaceError::UnknownSession(session_id))?;
    let header = RecordingHeader::new(
      PROTOCOL_VERSION,
      now_ns().0,
      &self.config.server_build_fingerprint,
      session.clone(),
    );
    let writer = RecordingWriter::create(
      self.config.recording_mode.clone(),
      header,
      &format!("{}_{}", session.label, session.id),
    )?;
    Ok(self.recordings.lock().insert(session_id, writer))
  }
}

fn router(inner: Arc<Inner>) -> Router {
  Router::new()
    .route("/api/v1/bootstrap", get(bootstrap))
    .route("/api/v1/health", get(health))
    .route("/api/v1/ws", get(websocket))
    .route("/", get(index))
    .route("/{*path}", get(asset))
    .layer(TraceLayer::new_for_http())
    .with_state(inner)
}

async fn bootstrap(State(inner): State<Arc<Inner>>) -> impl IntoResponse {
  axum::Json(inner.bootstrap())
}

async fn health(State(inner): State<Arc<Inner>>) -> impl IntoResponse {
  axum::Json(serde_json::json!({
    "ok": !inner.shutting_down.load(Ordering::Relaxed),
    "connectedBrowsers": inner.connected_browsers.load(Ordering::Relaxed),
    "systems": inner.systems.read().len(),
    "sessions": inner.sessions.read().len(),
  }))
}

async fn websocket(ws: WebSocketUpgrade, State(inner): State<Arc<Inner>>) -> impl IntoResponse {
  ws.on_upgrade(move |socket| websocket_connection(socket, inner))
}

async fn websocket_connection(socket: WebSocket, inner: Arc<Inner>) {
  let (mut sender, mut receiver) = socket.split();
  let hello = match receiver.next().await {
    Some(Ok(Message::Text(text))) => serde_json::from_str::<ClientHello>(&text),
    _ => return,
  };
  let hello = match hello {
    Ok(hello) => hello,
    Err(error) => {
      let control = ServerControl::ProtocolError {
        message: format!("first frame must be a JSON ClientHello: {error}"),
      };
      let _ = sender
        .send(Message::Text(
          serde_json::to_string(&control).unwrap_or_default().into(),
        ))
        .await;
      return;
    }
  };

  if hello.protocol_version != PROTOCOL_VERSION
    || hello.asset_build_fingerprint != inner.config.assets.fingerprint()
  {
    let control = ServerControl::ReloadRequired {
      expected_protocol_version: PROTOCOL_VERSION,
      expected_build_fingerprint: inner.config.assets.fingerprint().into(),
      reason: "client protocol or asset build does not match the host".into(),
    };
    let _ = sender
      .send(Message::Text(
        serde_json::to_string(&control).unwrap_or_default().into(),
      ))
      .await;
    let _ = sender
      .send(Message::Close(Some(CloseFrame {
        code: RELOAD_REQUIRED_CLOSE_CODE,
        reason: "reload required".into(),
      })))
      .await;
    return;
  }

  let connected = inner.connected_browsers.fetch_add(1, Ordering::Relaxed) + 1;
  let control = ServerControl::HelloAccepted {
    protocol_version: PROTOCOL_VERSION,
    server_build_fingerprint: inner.config.server_build_fingerprint.clone(),
    connected_browsers: connected,
  };
  if sender
    .send(Message::Text(
      serde_json::to_string(&control).unwrap_or_default().into(),
    ))
    .await
    .is_err()
  {
    inner.connected_browsers.fetch_sub(1, Ordering::Relaxed);
    return;
  }
  if send_messagepack(&mut sender, &inner.initial_state())
    .await
    .is_err()
  {
    inner.connected_browsers.fetch_sub(1, Ordering::Relaxed);
    return;
  }

  let mut broadcasts = inner.broadcast.subscribe();
  loop {
    tokio::select! {
      incoming = receiver.next() => {
        let Some(Ok(message)) = incoming else { break };
        match message {
          Message::Binary(bytes) => {
            match rmp_serde::from_slice::<ClientMessage>(&bytes) {
              Ok(ClientMessage::Command(command)) => {
                let command_id = command.id;
                if let Err(error) = inner.submit_command(command) {
                  let ack = CommandAcknowledgement {
                    command_id,
                    status: CommandStatus::Rejected,
                    message: error.to_string(),
                    accepted_at_ns: now_ns(),
                    completed_at_ns: Some(now_ns()),
                  };
                  if send_messagepack(&mut sender, &ServerMessage::CommandAcknowledgement(ack)).await.is_err() {
                    break;
                  }
                }
              }
              Ok(ClientMessage::Ping { nonce }) => {
                if send_messagepack(&mut sender, &ServerMessage::Pong { nonce }).await.is_err() {
                  break;
                }
              }
              Err(error) => {
                let control = ServerControl::ProtocolError {
                  message: format!("invalid MessagePack frame: {error}"),
                };
                if sender.send(Message::Text(serde_json::to_string(&control).unwrap_or_default().into())).await.is_err() {
                  break;
                }
              }
            }
          }
          Message::Close(_) => break,
          Message::Ping(bytes) => {
            if sender.send(Message::Pong(bytes)).await.is_err() {
              break;
            }
          }
          _ => {}
        }
      }
      outgoing = broadcasts.recv() => {
        match outgoing {
          Ok(message) => {
            if send_messagepack(&mut sender, &message).await.is_err() {
              break;
            }
          }
          Err(broadcast::error::RecvError::Lagged(dropped)) => {
            let message = ServerMessage::Event(EventEnvelope {
              system_id: "interface-host".into(),
              generation: 1,
              session_id: Uuid::nil(),
              sequence: 0,
              published_at_ns: now_ns(),
              event: DurableEvent::DataLoss {
                producer: "browser-broadcast".into(),
                dropped,
              },
            });
            if send_messagepack(&mut sender, &message).await.is_err() {
              break;
            }
          }
          Err(broadcast::error::RecvError::Closed) => break,
        }
      }
    }
  }
  inner.connected_browsers.fetch_sub(1, Ordering::Relaxed);
}

async fn send_messagepack(
  sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
  message: &ServerMessage,
) -> Result<(), axum::Error> {
  let bytes = rmp_serde::to_vec_named(message)
    .map_err(|error| axum::Error::new(InfallibleEncoding(error.to_string())))?;
  sender.send(Message::Binary(bytes.into())).await
}

#[derive(Debug)]
struct InfallibleEncoding(String);

impl std::fmt::Display for InfallibleEncoding {
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    formatter.write_str(&self.0)
  }
}

impl std::error::Error for InfallibleEncoding {}

async fn index(State(inner): State<Arc<Inner>>) -> Response<Body> {
  serve_asset(&inner, "index.html")
}

async fn asset(Path(path): Path<String>, State(inner): State<Arc<Inner>>) -> Response<Body> {
  if path.starts_with("api/") {
    return response(StatusCode::NOT_FOUND, "text/plain", b"not found", false);
  }
  let served = serve_asset(&inner, &path);
  if served.status() == StatusCode::NOT_FOUND {
    serve_asset(&inner, "index.html")
  } else {
    served
  }
}

fn serve_asset(inner: &Inner, path: &str) -> Response<Body> {
  match inner.config.assets.get(path) {
    Some(asset) => response(
      StatusCode::OK,
      &asset.content_type,
      &asset.bytes,
      asset.immutable,
    ),
    None => response(StatusCode::NOT_FOUND, "text/plain", b"not found", false),
  }
}

fn response(
  status: StatusCode,
  content_type: &str,
  body: &[u8],
  immutable: bool,
) -> Response<Body> {
  let mut response = Response::new(Body::from(body.to_vec()));
  *response.status_mut() = status;
  response.headers_mut().insert(
    header::CONTENT_TYPE,
    HeaderValue::from_str(content_type)
      .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
  );
  response.headers_mut().insert(
    header::CACHE_CONTROL,
    HeaderValue::from_static(if immutable {
      "public, max-age=31536000, immutable"
    } else {
      "no-cache"
    }),
  );
  response
}

pub fn now_ns() -> TimestampNs {
  TimestampNs(
    SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_nanos()
      .min(u64::MAX as u128) as u64,
  )
}

#[cfg(test)]
mod tests {
  use super::*;
  use futures_util::{SinkExt, StreamExt};
  use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;
  use webinterface_protocol::{
    Capability, CommandAction, CommandOrigin, CrashPilotCommand, SystemKind,
  };

  #[test]
  fn two_independent_hosts_can_run_in_one_process() {
    let config = InterfaceConfig {
      bind_address: "127.0.0.1:0".parse().unwrap(),
      recording_mode: RecordingMode::Off,
      ..InterfaceConfig::default()
    };
    let (first_guard, first) = InterfaceHost::start(config.clone()).unwrap();
    let (second_guard, second) = InterfaceHost::start(config).unwrap();
    assert_ne!(first.local_address(), second.local_address());
    drop((first_guard, second_guard));
  }

  #[test]
  fn historical_cursor_rejects_mutation() {
    let config = InterfaceConfig {
      bind_address: "127.0.0.1:0".parse().unwrap(),
      recording_mode: RecordingMode::Off,
      ..InterfaceConfig::default()
    };
    let (_guard, handle) = InterfaceHost::start(config).unwrap();
    let system = SystemDescriptor {
      id: "crashpilot".into(),
      label: "CrashPilot".into(),
      kind: SystemKind::CrashPilot,
      generation: 1,
      capabilities: vec![Capability {
        id: "crashpilot.command".into(),
        mutable: true,
        description: String::new(),
      }],
    };
    let _registered = handle.register_system(system).unwrap();
    let session = handle.create_session(
      "live",
      SessionKind::LiveMatch,
      true,
      vec!["crashpilot".into()],
      1,
    );
    let cursor = ViewerCursor {
      id: Uuid::new_v4(),
      session_id: session.id,
      live: false,
      frame: Some(0),
      world_ids: vec![0],
    };
    handle.set_viewer_cursor(cursor.clone()).unwrap();
    let result = handle.submit_browser_command(BrowserCommand {
      id: Uuid::new_v4(),
      origin: CommandOrigin {
        browser_instance_id: Uuid::new_v4(),
        panel_id: "test".into(),
        session_id: Some(session.id),
        viewer_cursor_id: Some(cursor.id),
        client_sequence: 1,
        workstation_label: None,
      },
      action: CommandAction::System {
        system_id: "crashpilot".into(),
        command: SystemCommand::CrashPilot(CrashPilotCommand::HaltAll),
      },
    });
    assert!(matches!(result, Err(InterfaceError::CommandRejected(_))));
  }

  #[tokio::test]
  async fn websocket_forces_reload_for_a_stale_client() {
    let config = InterfaceConfig {
      bind_address: "127.0.0.1:0".parse().unwrap(),
      recording_mode: RecordingMode::Off,
      ..InterfaceConfig::default()
    };
    let (_guard, handle) = InterfaceHost::start(config).unwrap();
    let url = format!("ws://{}/api/v1/ws", handle.local_address());
    let (mut socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    socket
      .send(TungsteniteMessage::Text(
        serde_json::to_string(&ClientHello {
          protocol_version: PROTOCOL_VERSION - 1,
          asset_build_fingerprint: "stale".into(),
          browser_instance_id: Uuid::new_v4(),
        })
        .unwrap()
        .into(),
      ))
      .await
      .unwrap();
    let text = socket.next().await.unwrap().unwrap().into_text().unwrap();
    let control: ServerControl = serde_json::from_str(&text).unwrap();
    assert!(matches!(control, ServerControl::ReloadRequired { .. }));
    let close = socket.next().await.unwrap().unwrap();
    assert!(matches!(
      close,
      TungsteniteMessage::Close(Some(frame))
        if u16::from(frame.code) == RELOAD_REQUIRED_CLOSE_CODE
    ));
  }

  #[tokio::test]
  async fn websocket_switches_to_named_messagepack_after_hello() {
    let config = InterfaceConfig {
      bind_address: "127.0.0.1:0".parse().unwrap(),
      recording_mode: RecordingMode::Off,
      ..InterfaceConfig::default()
    };
    let fingerprint = config.assets.fingerprint().to_string();
    let (_guard, handle) = InterfaceHost::start(config).unwrap();
    let url = format!("ws://{}/api/v1/ws", handle.local_address());
    let (mut socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    socket
      .send(TungsteniteMessage::Text(
        serde_json::to_string(&ClientHello {
          protocol_version: PROTOCOL_VERSION,
          asset_build_fingerprint: fingerprint,
          browser_instance_id: Uuid::new_v4(),
        })
        .unwrap()
        .into(),
      ))
      .await
      .unwrap();
    let accepted = socket.next().await.unwrap().unwrap().into_text().unwrap();
    let control: ServerControl = serde_json::from_str(&accepted).unwrap();
    assert!(matches!(control, ServerControl::HelloAccepted { .. }));
    let binary = socket.next().await.unwrap().unwrap().into_data();
    let initial: ServerMessage = rmp_serde::from_slice(&binary).unwrap();
    assert!(matches!(initial, ServerMessage::InitialState { .. }));
  }
}
