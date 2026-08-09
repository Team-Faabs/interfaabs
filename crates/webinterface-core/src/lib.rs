//! Shared Rust host for CrashPilot, simhark, replay, and debug adapters.

use std::collections::BTreeMap;
use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path as FilePath, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::body::Body;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, Response, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use futures_util::{SinkExt, StreamExt};
use parking_lot::{Mutex, RwLock};
use serde::Deserialize;
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::sync::{broadcast, mpsc, oneshot};
use tower_http::trace::TraceLayer;
use uuid::Uuid;
use webinterface_protocol::{
  Bootstrap, BrowserCommand, ClientHello, ClientMessage, CommandAcknowledgement, CommandAction,
  CommandOrigin, CommandStatus, DurableEvent, EventEnvelope, HealthLevel, PROTOCOL_VERSION,
  RELOAD_REQUIRED_CLOSE_CODE, RecordingFormat, RecordingSummary, ServerControl, ServerMessage,
  SessionDescriptor, SessionId, SessionKind, SessionLifecycle, StateEnvelope, SystemCommand,
  SystemDescriptor, SystemHealth, SystemId, SystemSnapshot, TimestampNs, ViewerCursor,
};
use webinterface_recording::{
  RecordedItem, RecordingError, RecordingHeader, RecordingMode, RecordingReader, RecordingWriter,
  inspect_finalized_recording, inspect_recording_header,
};

const MAX_IMPORT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

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
        b"<!doctype html><html><head><meta charset=\"UTF-8\"><title>interfaabs</title></head><body><div id=\"root\"></div></body></html>"
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
      cursor_id: None,
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

#[derive(Clone)]
struct RecordingCatalogEntry {
  path: PathBuf,
  summary: RecordingSummary,
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
  recording_paths: Mutex<BTreeMap<SessionId, PathBuf>>,
  recording_readers: Mutex<BTreeMap<SessionId, RecordingReader>>,
  recording_catalog: RwLock<BTreeMap<String, RecordingCatalogEntry>>,
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
      recording_paths: Mutex::new(BTreeMap::new()),
      recording_readers: Mutex::new(BTreeMap::new()),
      recording_catalog: RwLock::new(BTreeMap::new()),
      pending_commands: Mutex::new(BTreeMap::new()),
      interface_sequence: AtomicU64::new(0),
      shutting_down: AtomicBool::new(false),
    });
    inner.refresh_recordings()?;

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
      .name("interfaabs-host".into())
      .spawn(move || {
        let runtime = match tokio::runtime::Builder::new_multi_thread()
          .enable_all()
          .thread_name("interfaabs-worker")
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

  pub fn attach_system_to_session(
    &self,
    session_id: SessionId,
    system_id: impl Into<SystemId>,
  ) -> Result<SessionDescriptor, InterfaceError> {
    let system_id = system_id.into();
    if !self.inner.systems.read().contains_key(&system_id) {
      return Err(InterfaceError::UnknownSystem(system_id));
    }
    let mut sessions = self.inner.sessions.write();
    let session = sessions
      .get_mut(&session_id)
      .ok_or(InterfaceError::UnknownSession(session_id))?;
    if !session.system_ids.contains(&system_id) {
      session.system_ids.push(system_id);
      session.system_ids.sort();
    }
    let updated = session.clone();
    drop(sessions);
    let _ = self
      .inner
      .broadcast
      .send(ServerMessage::Session(updated.clone()));
    Ok(updated)
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
      self.inner.recording_readers.lock().remove(&session_id);
      if let Some(path) = writer.finalize(lifecycle, terminal_error)? {
        self.inner.recording_paths.lock().insert(session_id, path);
      }
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
    self.inner.recording_readers.lock().remove(&session_id);
    self.inner.recording_paths.lock().remove(&session_id);
    if let Some(path) = writer.path() {
      self
        .inner
        .recording_paths
        .lock()
        .insert(session_id, path.to_owned());
    }
    self.inner.recordings.lock().insert(session_id, writer);
    Ok(())
  }

  pub fn stop_recording(&self, session_id: SessionId) -> Result<(), InterfaceError> {
    if let Some(writer) = self.inner.recordings.lock().remove(&session_id) {
      self.inner.recording_readers.lock().remove(&session_id);
      let lifecycle = self
        .inner
        .sessions
        .read()
        .get(&session_id)
        .map(|session| session.lifecycle.clone())
        .unwrap_or(SessionLifecycle::Completed);
      if let Some(path) = writer.finalize(lifecycle, None)? {
        self.inner.recording_paths.lock().insert(session_id, path);
      }
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

  fn recording_summaries(&self) -> Vec<RecordingSummary> {
    let mut recordings = self
      .recording_catalog
      .read()
      .values()
      .map(|entry| entry.summary.clone())
      .collect::<Vec<_>>();
    recordings.sort_by(|left, right| {
      left
        .label
        .cmp(&right.label)
        .then_with(|| left.id.cmp(&right.id))
    });
    recordings
  }

  fn refresh_recordings(&self) -> Result<Vec<RecordingSummary>, InterfaceError> {
    let Some(directory) = self.config.recording_mode.directory() else {
      self.recording_catalog.write().clear();
      let recordings = Vec::new();
      let _ = self.broadcast.send(ServerMessage::Recordings {
        recordings: recordings.clone(),
      });
      return Ok(recordings);
    };
    fs::create_dir_all(&directory).map_err(RecordingError::from)?;
    let paths = recording_paths_in(&directory).map_err(RecordingError::from)?;
    let existing_ids = self
      .recording_catalog
      .read()
      .values()
      .map(|entry| (entry.path.clone(), entry.summary.id.clone()))
      .collect::<BTreeMap<_, _>>();
    let mut catalog = BTreeMap::new();
    for path in paths {
      let id = existing_ids
        .get(&path)
        .cloned()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
      let summary = summarize_recording(&path, id.clone());
      catalog.insert(id, RecordingCatalogEntry { path, summary });
    }
    *self.recording_catalog.write() = catalog;
    let recordings = self.recording_summaries();
    let _ = self.broadcast.send(ServerMessage::Recordings {
      recordings: recordings.clone(),
    });
    Ok(recordings)
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
        if !cursor.live
          && let Some(frame) = cursor.frame
        {
          let Some(states) = self.recorded_state_at(cursor.session_id, frame)? else {
            ack.status = CommandStatus::Rejected;
            ack.message = "session is not recorded, so it cannot be seeked".into();
            ack.completed_at_ns = Some(now_ns());
            return self.finish_command(&command, ack);
          };
          self.cursors.write().insert(cursor.id, cursor.clone());
          for mut state in states {
            state.cursor_id = Some(cursor.id);
            let _ = self.broadcast.send(ServerMessage::State(state));
          }
        } else {
          self.cursors.write().insert(cursor.id, cursor.clone());
        }
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
          self.recording_readers.lock().remove(session_id);
          if let Some(path) = writer.finalize(SessionLifecycle::Completed, None)? {
            self.recording_paths.lock().insert(*session_id, path);
          }
        }
        ack.status = CommandStatus::Applied;
        ack.completed_at_ns = Some(now_ns());
      }
      CommandAction::RefreshRecordings => match self.refresh_recordings() {
        Ok(_) => {
          ack.status = CommandStatus::Applied;
          ack.completed_at_ns = Some(now_ns());
        }
        Err(error) => {
          ack.status = CommandStatus::Rejected;
          ack.message = error.to_string();
          ack.completed_at_ns = Some(now_ns());
        }
      },
      CommandAction::OpenRecording { recording_id } => {
        let Some(recording) = self.recording_catalog.read().get(recording_id).cloned() else {
          ack.status = CommandStatus::Rejected;
          ack.message = "unknown recording id".into();
          ack.completed_at_ns = Some(now_ns());
          return self.finish_command(&command, ack);
        };
        if recording.summary.format != RecordingFormat::Faabsrec {
          ack.status = CommandStatus::Rejected;
          ack.message = format!(
            "{} import is not implemented yet",
            recording_format_name(recording.summary.format)
          );
          ack.completed_at_ns = Some(now_ns());
          return self.finish_command(&command, ack);
        }
        let reader = match RecordingReader::open(&recording.path) {
          Ok(reader) => reader,
          Err(error) => {
            ack.status = CommandStatus::Rejected;
            ack.message = error.to_string();
            ack.completed_at_ns = Some(now_ns());
            return self.finish_command(&command, ack);
          }
        };
        let recorded_session = reader.header().session.clone();
        let session = SessionDescriptor {
          id: Uuid::new_v4(),
          label: recording.summary.label,
          kind: SessionKind::Replay,
          lifecycle: SessionLifecycle::Completed,
          mutable: false,
          created_at_ns: TimestampNs(reader.header().created_at_ns),
          system_ids: recorded_session.system_ids,
          world_count: recorded_session.world_count,
          live_frame: reader.frame_range().map(|(_, last)| last),
          terminal_error: None,
        };
        self
          .recording_paths
          .lock()
          .insert(session.id, recording.path);
        self.recording_readers.lock().insert(session.id, reader);
        self.sessions.write().insert(session.id, session.clone());
        let _ = self.broadcast.send(ServerMessage::Session(session));
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

    self.finish_command(&command, ack)
  }

  fn validate_origin(&self, command: &BrowserCommand) -> Result<(), InterfaceError> {
    if let Some(session_id) = command.origin.session_id {
      let session = self
        .sessions
        .read()
        .get(&session_id)
        .cloned()
        .ok_or(InterfaceError::UnknownSession(session_id))?;
      let mutating = !matches!(
        command.action,
        CommandAction::SetViewerCursor(_)
          | CommandAction::RefreshRecordings
          | CommandAction::OpenRecording { .. }
      );
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

  fn recorded_state_at(
    &self,
    session_id: SessionId,
    frame: u64,
  ) -> Result<Option<Vec<StateEnvelope>>, InterfaceError> {
    let active_path = {
      let mut recordings = self.recordings.lock();
      let Some(writer) = recordings.get_mut(&session_id) else {
        drop(recordings);
        return self.state_at_recording_path(session_id, frame);
      };
      writer.flush_boundary()?;
      writer.path().map(PathBuf::from)
    };
    let Some(path) = active_path else {
      return Ok(None);
    };
    self.recording_paths.lock().insert(session_id, path);
    self.state_at_recording_path(session_id, frame)
  }

  fn state_at_recording_path(
    &self,
    session_id: SessionId,
    frame: u64,
  ) -> Result<Option<Vec<StateEnvelope>>, InterfaceError> {
    let Some(path) = self.recording_paths.lock().get(&session_id).cloned() else {
      return Ok(None);
    };
    let mut readers = self.recording_readers.lock();
    if !readers.contains_key(&session_id) {
      readers.insert(session_id, RecordingReader::open(&path)?);
    }
    let mut states = readers
      .get_mut(&session_id)
      .expect("recording reader was just inserted")
      .state_at(frame)?;
    for state in &mut states {
      state.session_id = session_id;
    }
    Ok(Some(states))
  }

  fn finish_command(
    &self,
    command: &BrowserCommand,
    ack: CommandAcknowledgement,
  ) -> Result<CommandAcknowledgement, InterfaceError> {
    if ack.status != CommandStatus::Rejected {
      *self.last_command_origin.write() = Some(command.origin.clone());
    }
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
    self.recording_readers.lock().remove(&session_id);
    self.recording_paths.lock().remove(&session_id);
    if let Some(path) = writer.path() {
      self
        .recording_paths
        .lock()
        .insert(session_id, path.to_owned());
    }
    Ok(self.recordings.lock().insert(session_id, writer))
  }
}

fn recording_paths_in(directory: &FilePath) -> std::io::Result<Vec<PathBuf>> {
  let mut directories = vec![directory.to_owned()];
  let mut recordings = Vec::new();
  while let Some(directory) = directories.pop() {
    for entry in fs::read_dir(directory)? {
      let entry = entry?;
      let file_type = match entry.file_type() {
        Ok(file_type) => file_type,
        Err(_) if recording_format(&entry.file_name().to_string_lossy()).is_some() => {
          recordings.push(entry.path());
          continue;
        }
        Err(error) => return Err(error),
      };
      if file_type.is_dir() {
        directories.push(entry.path());
      } else if file_type.is_file()
        && recording_format(&entry.file_name().to_string_lossy()).is_some()
      {
        recordings.push(entry.path());
      }
    }
  }
  recordings.sort();
  Ok(recordings)
}

fn recording_format(filename: &str) -> Option<(RecordingFormat, bool)> {
  if filename.ends_with(".faabsrec.partial") {
    Some((RecordingFormat::Faabsrec, true))
  } else if filename.ends_with(".faabsrec") {
    Some((RecordingFormat::Faabsrec, false))
  } else if filename.ends_with(".shreplay") {
    Some((RecordingFormat::Shreplay, false))
  } else if filename.ends_with(".log.gz") {
    Some((RecordingFormat::SslLogGz, false))
  } else if filename.ends_with(".log") {
    Some((RecordingFormat::SslLog, false))
  } else {
    None
  }
}

fn recording_format_name(format: RecordingFormat) -> &'static str {
  match format {
    RecordingFormat::Faabsrec => "faabsrec",
    RecordingFormat::Shreplay => "shreplay",
    RecordingFormat::SslLog => "ssl_log",
    RecordingFormat::SslLogGz => "ssl_log_gz",
  }
}

fn summarize_recording(path: &FilePath, id: String) -> RecordingSummary {
  let filename = path
    .file_name()
    .map(|name| name.to_string_lossy().into_owned())
    .unwrap_or_else(|| "recording".into());
  let (format, partial) = recording_format(&filename)
    .expect("only supported recording paths are passed to summarize_recording");
  let mut summary = RecordingSummary {
    id,
    label: filename,
    format,
    size_bytes: 0,
    modified_at_ns: TimestampNs(0),
    frame_count: None,
    duration_ns: None,
    session_kind: None,
    partial,
    error: None,
  };
  match fs::metadata(path) {
    Ok(metadata) => {
      summary.size_bytes = metadata.len();
      let modified = match metadata.modified() {
        Ok(modified) => modified,
        Err(error) => {
          summary.error = Some(error.to_string());
          return summary;
        }
      };
      let modified = match modified.duration_since(UNIX_EPOCH) {
        Ok(modified) => modified,
        Err(error) => {
          summary.error = Some(error.to_string());
          return summary;
        }
      };
      summary.modified_at_ns = TimestampNs(modified.as_nanos().min(u64::MAX as u128) as u64);
    }
    Err(error) => {
      summary.error = Some(error.to_string());
      return summary;
    }
  }
  if format != RecordingFormat::Faabsrec || partial {
    return summary;
  }
  match inspect_recording_header(path) {
    Ok(header) => {
      summary.label = header.session.label;
      summary.session_kind = Some(header.session.kind);
    }
    Err(error) => {
      summary.error = Some(error.to_string());
      return summary;
    }
  }
  match inspect_finalized_recording(path) {
    Ok(recording) => {
      let first_frame = recording
        .index
        .chunks
        .iter()
        .filter_map(|chunk| chunk.first_frame)
        .min();
      let last_frame = recording
        .index
        .chunks
        .iter()
        .filter_map(|chunk| chunk.last_frame)
        .max();
      summary.frame_count = first_frame
        .zip(last_frame)
        .map(|(first, last)| last.saturating_sub(first).saturating_add(1));
      let first_timestamp = recording
        .index
        .chunks
        .iter()
        .filter_map(|chunk| chunk.first_timestamp_ns)
        .min();
      let last_timestamp = recording
        .index
        .chunks
        .iter()
        .filter_map(|chunk| chunk.last_timestamp_ns)
        .max();
      summary.duration_ns = first_timestamp
        .zip(last_timestamp)
        .map(|(first, last)| last.saturating_sub(first));
    }
    Err(error) => summary.error = Some(error.to_string()),
  }
  summary
}

fn router(inner: Arc<Inner>) -> Router {
  Router::new()
    .route("/api/v1/bootstrap", get(bootstrap))
    .route("/api/v1/health", get(health))
    .route("/api/v1/recordings/import", post(import_recording))
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

#[derive(Debug, Deserialize)]
struct ImportRecordingQuery {
  filename: String,
}

async fn import_recording(
  Query(query): Query<ImportRecordingQuery>,
  State(inner): State<Arc<Inner>>,
  body: Body,
) -> Response<Body> {
  if query.filename.contains('/') || query.filename.contains('\\') || query.filename.contains("..")
  {
    return response(
      StatusCode::BAD_REQUEST,
      "text/plain",
      b"invalid recording filename",
      false,
    );
  }
  if recording_format(&query.filename).is_none() {
    return response(
      StatusCode::BAD_REQUEST,
      "text/plain",
      b"unsupported recording format",
      false,
    );
  }
  let Some(directory) = inner.config.recording_mode.directory() else {
    return response(
      StatusCode::SERVICE_UNAVAILABLE,
      "text/plain",
      b"recording directory is unavailable",
      false,
    );
  };
  if tokio::fs::create_dir_all(&directory).await.is_err() {
    return response(
      StatusCode::INTERNAL_SERVER_ERROR,
      "text/plain",
      b"failed to create recording directory",
      false,
    );
  }
  let destination = directory.join(&query.filename);
  let mut file = match tokio::fs::OpenOptions::new()
    .create_new(true)
    .write(true)
    .open(&destination)
    .await
  {
    Ok(file) => file,
    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
      return response(
        StatusCode::CONFLICT,
        "text/plain",
        b"a recording with that filename already exists",
        false,
      );
    }
    Err(_) => {
      return response(
        StatusCode::INTERNAL_SERVER_ERROR,
        "text/plain",
        b"failed to create imported recording",
        false,
      );
    }
  };

  let mut received = 0_u64;
  let mut stream = body.into_data_stream();
  while let Some(chunk) = stream.next().await {
    let chunk = match chunk {
      Ok(chunk) => chunk,
      Err(_) => {
        drop(file);
        let _ = tokio::fs::remove_file(&destination).await;
        return response(
          StatusCode::BAD_REQUEST,
          "text/plain",
          b"failed to read request body",
          false,
        );
      }
    };
    received = received.saturating_add(chunk.len() as u64);
    if received > MAX_IMPORT_BYTES {
      drop(file);
      let _ = tokio::fs::remove_file(&destination).await;
      return response(
        StatusCode::PAYLOAD_TOO_LARGE,
        "text/plain",
        b"recording exceeds the 2 GiB limit",
        false,
      );
    }
    if file.write_all(&chunk).await.is_err() {
      drop(file);
      let _ = tokio::fs::remove_file(&destination).await;
      return response(
        StatusCode::INTERNAL_SERVER_ERROR,
        "text/plain",
        b"failed to write imported recording",
        false,
      );
    }
  }
  if file.flush().await.is_err() || file.sync_all().await.is_err() {
    drop(file);
    let _ = tokio::fs::remove_file(&destination).await;
    return response(
      StatusCode::INTERNAL_SERVER_ERROR,
      "text/plain",
      b"failed to finish imported recording",
      false,
    );
  }
  drop(file);

  if inner.refresh_recordings().is_err() {
    return response(
      StatusCode::INTERNAL_SERVER_ERROR,
      "text/plain",
      b"failed to refresh recordings",
      false,
    );
  }
  let summary = inner
    .recording_catalog
    .read()
    .values()
    .find(|entry| entry.path == destination)
    .map(|entry| entry.summary.clone());
  let Some(summary) = summary else {
    return response(
      StatusCode::INTERNAL_SERVER_ERROR,
      "text/plain",
      b"imported recording was not found after refresh",
      false,
    );
  };
  match serde_json::to_vec(&summary) {
    Ok(body) => response(StatusCode::OK, "application/json", &body, false),
    Err(_) => response(
      StatusCode::INTERNAL_SERVER_ERROR,
      "text/plain",
      b"failed to encode imported recording",
      false,
    ),
  }
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
  if send_messagepack(
    &mut sender,
    &ServerMessage::Recordings {
      recordings: inner.recording_summaries(),
    },
  )
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
    Capability, CommandAction, CommandOrigin, CrashPilotCommand, Score, SystemKind, WorldState,
  };

  fn system_descriptor(id: &str) -> SystemDescriptor {
    SystemDescriptor {
      id: id.into(),
      label: id.into(),
      kind: SystemKind::Simhark,
      generation: 1,
      capabilities: Vec::new(),
    }
  }

  fn snapshot_at(frame: u64) -> SystemSnapshot {
    SystemSnapshot {
      worlds: vec![WorldState {
        world_id: 0,
        frame,
        simulation_time_ns: TimestampNs(frame * 1_000_000),
        field: Default::default(),
        ball: None,
        robots: Vec::new(),
        referee: None,
        score: Score { blue: 0, yellow: 0 },
        events: Vec::new(),
      }],
      debug_layers: Vec::new(),
      debug_items: Vec::new(),
      properties: BTreeMap::new(),
    }
  }

  fn cursor_command(session_id: SessionId, cursor: ViewerCursor) -> BrowserCommand {
    BrowserCommand {
      id: Uuid::new_v4(),
      origin: CommandOrigin {
        browser_instance_id: Uuid::new_v4(),
        panel_id: "test".into(),
        session_id: Some(session_id),
        viewer_cursor_id: None,
        client_sequence: 1,
        workstation_label: None,
      },
      action: CommandAction::SetViewerCursor(cursor),
    }
  }

  fn browser_command(action: CommandAction) -> BrowserCommand {
    BrowserCommand {
      id: Uuid::new_v4(),
      origin: CommandOrigin {
        browser_instance_id: Uuid::new_v4(),
        panel_id: "test".into(),
        session_id: None,
        viewer_cursor_id: None,
        client_sequence: 1,
        workstation_label: None,
      },
      action,
    }
  }

  fn handle_without_server(recording_mode: RecordingMode) -> InterfaceHandle {
    let config = InterfaceConfig {
      bind_address: "127.0.0.1:0".parse().unwrap(),
      recording_mode,
      ..InterfaceConfig::default()
    };
    let (broadcast, _) = broadcast::channel(config.broadcast_capacity.max(16));
    InterfaceHandle {
      inner: Arc::new(Inner {
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
        recording_paths: Mutex::new(BTreeMap::new()),
        recording_readers: Mutex::new(BTreeMap::new()),
        recording_catalog: RwLock::new(BTreeMap::new()),
        pending_commands: Mutex::new(BTreeMap::new()),
        interface_sequence: AtomicU64::new(0),
        shutting_down: AtomicBool::new(false),
      }),
    }
  }

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
  fn recording_listing_includes_partial_files_and_marks_them() {
    let directory = tempfile::tempdir().unwrap();
    let nested = directory.path().join("nested");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("crashed.faabsrec.partial"), b"partial").unwrap();
    let handle = handle_without_server(RecordingMode::Disk {
      directory: directory.path().into(),
    });

    let recordings = handle.inner.refresh_recordings().unwrap();

    assert_eq!(recordings.len(), 1);
    assert_eq!(recordings[0].format, RecordingFormat::Faabsrec);
    assert!(recordings[0].partial);
    assert_eq!(recordings[0].frame_count, None);
    assert_eq!(recordings[0].duration_ns, None);
    assert_eq!(recordings[0].session_kind, None);
  }

  #[test]
  fn recording_listing_reports_an_unreadable_file_instead_of_hiding_it() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("broken.faabsrec"), b"not a recording").unwrap();
    let handle = handle_without_server(RecordingMode::Disk {
      directory: directory.path().into(),
    });

    let recordings = handle.inner.refresh_recordings().unwrap();

    assert_eq!(recordings.len(), 1);
    assert!(recordings[0].error.is_some());
    assert_eq!(recordings[0].frame_count, None);
  }

  #[test]
  fn opening_an_unknown_recording_id_is_rejected() {
    let handle = handle_without_server(RecordingMode::Off);

    let acknowledgement = handle
      .submit_browser_command(browser_command(CommandAction::OpenRecording {
        recording_id: "not-issued-by-this-host".into(),
      }))
      .unwrap();

    assert_eq!(acknowledgement.status, CommandStatus::Rejected);
    assert_eq!(acknowledgement.message, "unknown recording id");
  }

  #[test]
  fn opening_a_recording_creates_a_replay_session() {
    let directory = tempfile::tempdir().unwrap();
    let recorded_session = SessionDescriptor {
      id: Uuid::new_v4(),
      label: "Imported final".into(),
      kind: SessionKind::Simulation,
      lifecycle: SessionLifecycle::Completed,
      mutable: false,
      created_at_ns: TimestampNs(1),
      system_ids: vec!["simhark".into()],
      world_count: 1,
      live_frame: Some(7),
      terminal_error: None,
    };
    let header = RecordingHeader::new(PROTOCOL_VERSION, 1, "test", recorded_session.clone());
    let mut writer = RecordingWriter::create(
      RecordingMode::Disk {
        directory: directory.path().into(),
      },
      header,
      "imported",
    )
    .unwrap();
    writer
      .append(RecordedItem::State(StateEnvelope {
        system_id: "simhark".into(),
        generation: 1,
        session_id: recorded_session.id,
        sequence: 1,
        published_at_ns: TimestampNs(7_000_000),
        snapshot: snapshot_at(7),
        cursor_id: None,
      }))
      .unwrap();
    writer.finalize(SessionLifecycle::Completed, None).unwrap();
    let handle = handle_without_server(RecordingMode::Disk {
      directory: directory.path().into(),
    });
    let recordings = handle.inner.refresh_recordings().unwrap();

    let acknowledgement = handle
      .submit_browser_command(browser_command(CommandAction::OpenRecording {
        recording_id: recordings[0].id.clone(),
      }))
      .unwrap();

    assert_eq!(acknowledgement.status, CommandStatus::Applied);
    let sessions = handle.inner.sessions.read();
    assert_eq!(sessions.len(), 1);
    let replay = sessions.values().next().unwrap();
    assert_eq!(replay.kind, SessionKind::Replay);
    assert_eq!(replay.label, recordings[0].label);
    assert_eq!(replay.live_frame, Some(7));
    assert!(handle.inner.recording_paths.lock().contains_key(&replay.id));
  }

  #[tokio::test]
  async fn import_rejects_a_filename_that_escapes_the_directory() {
    let directory = tempfile::tempdir().unwrap();
    let handle = handle_without_server(RecordingMode::Disk {
      directory: directory.path().into(),
    });

    let response = import_recording(
      Query(ImportRecordingQuery {
        filename: "../escape.faabsrec".into(),
      }),
      State(Arc::clone(&handle.inner)),
      Body::from("not a recording"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(!directory.path().join("escape.faabsrec").exists());
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

  #[test]
  fn registered_system_can_be_attached_to_an_existing_session() {
    let config = InterfaceConfig {
      bind_address: "127.0.0.1:0".parse().unwrap(),
      recording_mode: RecordingMode::Off,
      ..InterfaceConfig::default()
    };
    let (_guard, handle) = InterfaceHost::start(config).unwrap();
    let session = handle.create_session("live", SessionKind::LiveMatch, true, Vec::new(), 1);
    let _registered = handle
      .register_system(SystemDescriptor {
        id: "referris".into(),
        label: "Referris".into(),
        kind: SystemKind::Referris,
        generation: 1,
        capabilities: Vec::new(),
      })
      .unwrap();

    let attached = handle
      .attach_system_to_session(session.id, "referris")
      .unwrap();
    assert_eq!(attached.system_ids, vec!["referris"]);
    let attached_again = handle
      .attach_system_to_session(session.id, "referris")
      .unwrap();
    assert_eq!(attached_again.system_ids, vec!["referris"]);
    assert_eq!(handle.bootstrap().sessions[0].system_ids, vec!["referris"]);
  }

  #[test]
  fn seeking_a_detached_cursor_does_not_move_the_live_head() {
    let dir = tempfile::tempdir().unwrap();
    let handle = handle_without_server(RecordingMode::Disk {
      directory: dir.path().into(),
    });
    let registered = handle
      .register_system(system_descriptor("simhark"))
      .unwrap();
    let session = handle.create_session(
      "recorded",
      SessionKind::Simulation,
      true,
      vec!["simhark".into()],
      1,
    );
    handle.start_recording(session.id).unwrap();
    registered
      .publisher
      .publish(session.id, snapshot_at(4))
      .unwrap();
    registered
      .publisher
      .publish(session.id, snapshot_at(8))
      .unwrap();
    let live_frame = handle.bootstrap().sessions[0].live_frame;
    let mut broadcasts = handle.inner.broadcast.subscribe();
    let cursor = ViewerCursor {
      id: Uuid::new_v4(),
      session_id: session.id,
      live: false,
      frame: Some(4),
      world_ids: vec![0],
    };

    let ack = handle
      .submit_browser_command(cursor_command(session.id, cursor.clone()))
      .unwrap();

    assert_eq!(ack.status, CommandStatus::Applied);
    assert_eq!(handle.bootstrap().sessions[0].live_frame, live_frame);
    let sought = std::iter::from_fn(|| broadcasts.try_recv().ok()).find_map(|message| {
      let ServerMessage::State(state) = message else {
        return None;
      };
      (state.cursor_id == Some(cursor.id)).then_some(state)
    });
    assert_eq!(sought.unwrap().snapshot.worlds[0].frame, 4);
  }

  #[test]
  fn seeking_an_unrecorded_session_is_rejected_with_a_message() {
    let handle = handle_without_server(RecordingMode::Off);
    let session = handle.create_session("unrecorded", SessionKind::Simulation, true, Vec::new(), 1);
    let cursor = ViewerCursor {
      id: Uuid::new_v4(),
      session_id: session.id,
      live: false,
      frame: Some(12),
      world_ids: vec![0],
    };

    let ack = handle
      .submit_browser_command(cursor_command(session.id, cursor))
      .unwrap();

    assert_eq!(ack.status, CommandStatus::Rejected);
    assert_eq!(
      ack.message,
      "session is not recorded, so it cannot be seeked"
    );
  }

  #[test]
  fn live_state_envelope_has_no_cursor_id() {
    let handle = handle_without_server(RecordingMode::Off);
    let registered = handle
      .register_system(system_descriptor("simhark"))
      .unwrap();
    let session = handle.create_session(
      "live",
      SessionKind::Simulation,
      true,
      vec!["simhark".into()],
      1,
    );

    registered
      .publisher
      .publish(session.id, snapshot_at(1))
      .unwrap();

    assert!(
      handle
        .inner
        .snapshots
        .read()
        .values()
        .all(|state| state.cursor_id.is_none())
    );
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
