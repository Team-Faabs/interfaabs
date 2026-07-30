//! Crash-recoverable `.faabsrec` recording support.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, BufWriter, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;
use webinterface_protocol::{
  EventEnvelope, SessionDescriptor, SessionLifecycle, StateEnvelope, SystemId,
};

const MAGIC: &[u8; 8] = b"FAABSREC";
const CHUNK_MAGIC: &[u8; 4] = b"CHNK";
const INDEX_MAGIC: &[u8; 4] = b"INDX";
const FORMAT_VERSION: u32 = 1;
const DEFAULT_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_CHUNK_TIME: Duration = Duration::from_secs(1);

#[derive(Debug, Clone)]
pub enum RecordingMode {
  Disk { directory: PathBuf },
  Temp,
  Memory { max_bytes: usize },
  Off,
}

impl Default for RecordingMode {
  fn default() -> Self {
    Self::Disk {
      directory: PathBuf::from("recordings"),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingHeader {
  pub format_version: u32,
  pub protocol_version: u32,
  pub recording_id: Uuid,
  pub created_at_ns: u64,
  pub server_build_fingerprint: String,
  pub session: SessionDescriptor,
  pub metadata: BTreeMap<String, String>,
}

impl RecordingHeader {
  pub fn new(
    protocol_version: u32,
    created_at_ns: u64,
    server_build_fingerprint: impl Into<String>,
    session: SessionDescriptor,
  ) -> Self {
    Self {
      format_version: FORMAT_VERSION,
      protocol_version,
      recording_id: Uuid::new_v4(),
      created_at_ns,
      server_build_fingerprint: server_build_fingerprint.into(),
      session,
      metadata: BTreeMap::new(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum RecordedItem {
  State(StateEnvelope),
  Event(EventEnvelope),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChunkPayload {
  checkpoints: Vec<StateEnvelope>,
  items: Vec<RecordedItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkIndexEntry {
  pub offset: u64,
  pub compressed_bytes: u32,
  pub uncompressed_bytes: u32,
  pub first_frame: Option<u64>,
  pub last_frame: Option<u64>,
  pub first_timestamp_ns: Option<u64>,
  pub last_timestamp_ns: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingIndex {
  pub chunks: Vec<ChunkIndexEntry>,
  pub terminal_lifecycle: Option<SessionLifecycle>,
  pub terminal_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RecoveredRecording {
  pub header: RecordingHeader,
  pub index: RecordingIndex,
  pub items: Vec<RecordedItem>,
  pub truncated: bool,
}

#[derive(Debug, Error)]
pub enum RecordingError {
  #[error("recording I/O error: {0}")]
  Io(#[from] io::Error),
  #[error("recording encoding error: {0}")]
  Encode(#[from] rmp_serde::encode::Error),
  #[error("recording decoding error: {0}")]
  Decode(#[from] rmp_serde::decode::Error),
  #[error("invalid recording: {0}")]
  Invalid(String),
  #[error("recording has already been finalized")]
  Finalized,
  #[error("recording memory limit exceeded ({limit} bytes)")]
  MemoryLimit { limit: usize },
}

enum Target {
  Disk {
    writer: BufWriter<File>,
    partial_path: PathBuf,
    final_path: PathBuf,
    sidecar_path: PathBuf,
  },
  Memory {
    cursor: io::Cursor<Vec<u8>>,
    max_bytes: usize,
  },
  Off,
}

impl Target {
  fn write_all(&mut self, bytes: &[u8]) -> Result<(), RecordingError> {
    match self {
      Self::Disk { writer, .. } => writer.write_all(bytes)?,
      Self::Memory { cursor, max_bytes } => {
        if cursor.get_ref().len().saturating_add(bytes.len()) > *max_bytes {
          return Err(RecordingError::MemoryLimit { limit: *max_bytes });
        }
        cursor.write_all(bytes)?;
      }
      Self::Off => {}
    }
    Ok(())
  }

  fn stream_position(&mut self) -> Result<u64, RecordingError> {
    match self {
      Self::Disk { writer, .. } => Ok(writer.stream_position()?),
      Self::Memory { cursor, .. } => Ok(cursor.position()),
      Self::Off => Ok(0),
    }
  }

  fn flush(&mut self) -> Result<(), RecordingError> {
    match self {
      Self::Disk { writer, .. } => writer.flush()?,
      Self::Memory { cursor, .. } => cursor.flush()?,
      Self::Off => {}
    }
    Ok(())
  }
}

pub struct RecordingWriter {
  target: Target,
  header: RecordingHeader,
  checkpoints: BTreeMap<SystemId, StateEnvelope>,
  pending: Vec<RecordedItem>,
  pending_bytes: usize,
  chunk_started: Instant,
  index: RecordingIndex,
  finalized: bool,
}

impl RecordingWriter {
  pub fn create(
    mode: RecordingMode,
    header: RecordingHeader,
    name: &str,
  ) -> Result<Self, RecordingError> {
    let target = match mode {
      RecordingMode::Disk { directory } => {
        let created_at_seconds = header.created_at_ns / 1_000_000_000;
        let days = (created_at_seconds / 86_400) as i64;
        let seconds_of_day = created_at_seconds % 86_400;
        let (year, month, day) = civil_date_from_unix_days(days);
        let hour = seconds_of_day / 3_600;
        let minute = seconds_of_day % 3_600 / 60;
        let second = seconds_of_day % 60;
        let directory = directory.join(format!("{year:04}-{month:02}-{day:02}"));
        fs::create_dir_all(&directory)?;
        let safe_name = sanitize_name(name);
        let final_path = directory.join(format!(
          "{hour:02}-{minute:02}-{second:02}_{safe_name}.faabsrec"
        ));
        let partial_path = final_path.with_extension("faabsrec.partial");
        let sidecar_path = final_path.with_extension("faabsrec.index.partial");
        let writer = BufWriter::new(
          OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&partial_path)?,
        );
        Target::Disk {
          writer,
          partial_path,
          final_path,
          sidecar_path,
        }
      }
      RecordingMode::Temp => {
        let directory = std::env::temp_dir().join("faabs-recordings");
        fs::create_dir_all(&directory)?;
        let final_path = directory.join(format!("{}.faabsrec", sanitize_name(name)));
        let partial_path = final_path.with_extension("faabsrec.partial");
        let sidecar_path = final_path.with_extension("faabsrec.index.partial");
        let writer = BufWriter::new(
          OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&partial_path)?,
        );
        Target::Disk {
          writer,
          partial_path,
          final_path,
          sidecar_path,
        }
      }
      RecordingMode::Memory { max_bytes } => Target::Memory {
        cursor: io::Cursor::new(Vec::new()),
        max_bytes,
      },
      RecordingMode::Off => Target::Off,
    };

    let mut writer = Self {
      target,
      header,
      checkpoints: BTreeMap::new(),
      pending: Vec::new(),
      pending_bytes: 0,
      chunk_started: Instant::now(),
      index: RecordingIndex {
        chunks: Vec::new(),
        terminal_lifecycle: None,
        terminal_error: None,
      },
      finalized: false,
    };
    writer.write_header()?;
    Ok(writer)
  }

  pub fn append(&mut self, item: RecordedItem) -> Result<(), RecordingError> {
    if self.finalized {
      return Err(RecordingError::Finalized);
    }
    if let RecordedItem::State(state) = &item {
      self
        .checkpoints
        .insert(state.system_id.clone(), state.clone());
    }
    self.pending_bytes = self
      .pending_bytes
      .saturating_add(rmp_serde::to_vec_named(&item)?.len());
    self.pending.push(item);
    if self.pending_bytes >= DEFAULT_CHUNK_BYTES
      || self.chunk_started.elapsed() >= DEFAULT_CHUNK_TIME
    {
      self.flush_chunk()?;
    }
    Ok(())
  }

  pub fn flush_boundary(&mut self) -> Result<(), RecordingError> {
    self.flush_chunk()
  }

  pub fn finalize(
    mut self,
    lifecycle: SessionLifecycle,
    error: Option<String>,
  ) -> Result<Option<PathBuf>, RecordingError> {
    if self.finalized {
      return Err(RecordingError::Finalized);
    }
    self.index.terminal_lifecycle = Some(lifecycle);
    self.index.terminal_error = error;
    self.flush_chunk()?;
    let encoded_index = rmp_serde::to_vec_named(&self.index)?;
    self.target.write_all(INDEX_MAGIC)?;
    self
      .target
      .write_all(&(encoded_index.len() as u32).to_le_bytes())?;
    self.target.write_all(&encoded_index)?;
    self.target.flush()?;
    self.finalized = true;

    match self.target {
      Target::Disk {
        mut writer,
        partial_path,
        final_path,
        sidecar_path,
      } => {
        writer.flush()?;
        writer.get_ref().sync_all()?;
        drop(writer);
        fs::rename(&partial_path, &final_path)?;
        if sidecar_path.exists() {
          let _ = fs::remove_file(sidecar_path);
        }
        Ok(Some(final_path))
      }
      Target::Memory { .. } | Target::Off => Ok(None),
    }
  }

  pub fn memory_bytes(&self) -> Option<&[u8]> {
    match &self.target {
      Target::Memory { cursor, .. } => Some(cursor.get_ref()),
      _ => None,
    }
  }

  pub fn path(&self) -> Option<&Path> {
    match &self.target {
      Target::Disk { partial_path, .. } => Some(partial_path),
      _ => None,
    }
  }

  fn write_header(&mut self) -> Result<(), RecordingError> {
    let encoded = rmp_serde::to_vec_named(&self.header)?;
    self.target.write_all(MAGIC)?;
    self
      .target
      .write_all(&(encoded.len() as u32).to_le_bytes())?;
    self.target.write_all(&encoded)?;
    self.target.flush()
  }

  fn flush_chunk(&mut self) -> Result<(), RecordingError> {
    if self.pending.is_empty() {
      return self.target.flush();
    }
    let payload = ChunkPayload {
      checkpoints: self.checkpoints.values().cloned().collect(),
      items: std::mem::take(&mut self.pending),
    };
    let raw = rmp_serde::to_vec_named(&payload)?;
    let compressed = zstd::stream::encode_all(raw.as_slice(), 3)?;
    let crc = crc32fast::hash(&compressed);
    let offset = self.target.stream_position()?;
    self.target.write_all(CHUNK_MAGIC)?;
    self
      .target
      .write_all(&(compressed.len() as u32).to_le_bytes())?;
    self.target.write_all(&(raw.len() as u32).to_le_bytes())?;
    self.target.write_all(&crc.to_le_bytes())?;
    self.target.write_all(&compressed)?;
    self.target.flush()?;

    let entry = index_entry(offset, compressed.len(), raw.len(), &payload.items);
    self.index.chunks.push(entry);
    self.pending_bytes = 0;
    self.chunk_started = Instant::now();
    self.write_sidecar()
  }

  fn write_sidecar(&self) -> Result<(), RecordingError> {
    let Target::Disk { sidecar_path, .. } = &self.target else {
      return Ok(());
    };
    let bytes = serde_json::to_vec(&self.index)
      .map_err(|error| RecordingError::Invalid(error.to_string()))?;
    fs::write(sidecar_path, bytes)?;
    Ok(())
  }
}

pub fn read_recording(path: impl AsRef<Path>) -> Result<RecoveredRecording, RecordingError> {
  let mut reader = BufReader::new(File::open(path)?);
  let mut magic = [0; 8];
  reader.read_exact(&mut magic)?;
  if &magic != MAGIC {
    return Err(RecordingError::Invalid("bad magic".into()));
  }
  let header_len = read_u32(&mut reader)? as usize;
  let mut header_bytes = vec![0; header_len];
  reader.read_exact(&mut header_bytes)?;
  let header = rmp_serde::from_slice(&header_bytes)?;
  let mut items = Vec::new();
  let mut chunks = Vec::new();
  let mut terminal_lifecycle = None;
  let mut terminal_error = None;
  let truncated = loop {
    let offset = reader.stream_position()?;
    let mut marker = [0; 4];
    match reader.read_exact(&mut marker) {
      Ok(()) => {}
      Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
        break true;
      }
      Err(error) => return Err(error.into()),
    }
    if &marker == INDEX_MAGIC {
      let len = match read_u32(&mut reader) {
        Ok(value) => value as usize,
        Err(_) => break true,
      };
      let mut encoded = vec![0; len];
      if reader.read_exact(&mut encoded).is_err() {
        break true;
      }
      let Ok(index) = rmp_serde::from_slice::<RecordingIndex>(&encoded) else {
        break true;
      };
      terminal_lifecycle = index.terminal_lifecycle;
      terminal_error = index.terminal_error;
      break false;
    }
    if &marker != CHUNK_MAGIC {
      break true;
    }
    let compressed_len = match read_u32(&mut reader) {
      Ok(value) => value as usize,
      Err(_) => {
        break true;
      }
    };
    let uncompressed_len = match read_u32(&mut reader) {
      Ok(value) => value as usize,
      Err(_) => break true,
    };
    let crc = match read_u32(&mut reader) {
      Ok(value) => value,
      Err(_) => break true,
    };
    let mut compressed = vec![0; compressed_len];
    if reader.read_exact(&mut compressed).is_err() {
      break true;
    }
    if crc32fast::hash(&compressed) != crc {
      break true;
    }
    let Ok(raw) = zstd::stream::decode_all(compressed.as_slice()) else {
      break true;
    };
    if raw.len() != uncompressed_len {
      break true;
    }
    let Ok(payload) = rmp_serde::from_slice::<ChunkPayload>(&raw) else {
      break true;
    };
    chunks.push(index_entry(
      offset,
      compressed_len,
      uncompressed_len,
      &payload.items,
    ));
    items.extend(payload.items);
  };

  Ok(RecoveredRecording {
    header,
    index: RecordingIndex {
      chunks,
      terminal_lifecycle,
      terminal_error,
    },
    items,
    truncated,
  })
}

fn index_entry(
  offset: u64,
  compressed_bytes: usize,
  uncompressed_bytes: usize,
  items: &[RecordedItem],
) -> ChunkIndexEntry {
  let mut frames = Vec::new();
  let mut timestamps = Vec::new();
  for item in items {
    match item {
      RecordedItem::State(state) => {
        timestamps.push(state.published_at_ns.0);
        frames.extend(state.snapshot.worlds.iter().map(|world| world.frame));
      }
      RecordedItem::Event(event) => timestamps.push(event.published_at_ns.0),
    }
  }
  ChunkIndexEntry {
    offset,
    compressed_bytes: compressed_bytes as u32,
    uncompressed_bytes: uncompressed_bytes as u32,
    first_frame: frames.iter().min().copied(),
    last_frame: frames.iter().max().copied(),
    first_timestamp_ns: timestamps.iter().min().copied(),
    last_timestamp_ns: timestamps.iter().max().copied(),
  }
}

fn read_u32(reader: &mut impl Read) -> Result<u32, RecordingError> {
  let mut bytes = [0; 4];
  reader.read_exact(&mut bytes)?;
  Ok(u32::from_le_bytes(bytes))
}

fn sanitize_name(name: &str) -> String {
  let safe = name
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
        ch
      } else {
        '_'
      }
    })
    .collect::<String>();
  if safe.is_empty() {
    "recording".into()
  } else {
    safe
  }
}

// Howard Hinnant's civil-from-days conversion, with day zero at the Unix
// epoch. Keeping this local avoids pulling a clock/time-zone dependency into
// the recording hot path; recording directory names are always UTC.
fn civil_date_from_unix_days(days_since_epoch: i64) -> (i64, u32, u32) {
  let z = days_since_epoch + 719_468;
  let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
  let day_of_era = z - era * 146_097;
  let year_of_era =
    (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
  let mut year = year_of_era + era * 400;
  let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
  let month_prime = (5 * day_of_year + 2) / 153;
  let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
  let month = month_prime + if month_prime < 10 { 3 } else { -9 };
  year += i64::from(month <= 2);
  (year, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
  use super::*;
  use webinterface_protocol::{
    PROTOCOL_VERSION, SessionId, SessionKind, SessionLifecycle, TimestampNs,
  };

  fn session() -> SessionDescriptor {
    SessionDescriptor {
      id: Uuid::new_v4(),
      label: "test".into(),
      kind: SessionKind::Simulation,
      lifecycle: SessionLifecycle::Running,
      mutable: true,
      created_at_ns: TimestampNs(1),
      system_ids: vec!["simhark".into()],
      world_count: 1,
      live_frame: None,
      terminal_error: None,
    }
  }

  fn state_item(session_id: SessionId, frame: u64) -> RecordedItem {
    RecordedItem::State(StateEnvelope {
      system_id: "simhark".into(),
      generation: 1,
      session_id,
      sequence: frame + 1,
      published_at_ns: TimestampNs(frame * 1_000_000),
      snapshot: webinterface_protocol::SystemSnapshot {
        worlds: Vec::new(),
        debug_layers: Vec::new(),
        debug_items: Vec::new(),
        properties: BTreeMap::new(),
      },
    })
  }

  #[test]
  fn failed_recording_is_finalized_and_openable() {
    let dir = tempfile::tempdir().unwrap();
    let session = session();
    let header = RecordingHeader::new(PROTOCOL_VERSION, 1, "test-build", session.clone());
    let writer = RecordingWriter::create(
      RecordingMode::Disk {
        directory: dir.path().into(),
      },
      header,
      "failed",
    )
    .unwrap();
    let path = writer
      .finalize(SessionLifecycle::Failed, Some("expected".into()))
      .unwrap()
      .unwrap();
    let recovered = read_recording(path).unwrap();
    assert_eq!(
      recovered.index.terminal_lifecycle,
      Some(SessionLifecycle::Failed)
    );
    assert_eq!(recovered.index.terminal_error.as_deref(), Some("expected"));
    assert!(!recovered.truncated);
  }

  #[test]
  fn partial_recording_header_can_be_recovered() {
    let dir = tempfile::tempdir().unwrap();
    let session = session();
    let header = RecordingHeader::new(PROTOCOL_VERSION, 1, "test-build", session);
    let writer = RecordingWriter::create(
      RecordingMode::Disk {
        directory: dir.path().into(),
      },
      header,
      "partial",
    )
    .unwrap();
    let path = writer.path().unwrap().to_owned();
    drop(writer);
    let recovered = read_recording(path).unwrap();
    assert!(recovered.truncated);
  }

  #[test]
  fn unix_epoch_uses_a_civil_utc_directory() {
    assert_eq!(civil_date_from_unix_days(0), (1970, 1, 1));
    assert_eq!(civil_date_from_unix_days(1), (1970, 1, 2));
    assert_eq!(civil_date_from_unix_days(-1), (1969, 12, 31));
  }

  #[test]
  fn completed_and_cancelled_recordings_round_trip_items() {
    for lifecycle in [SessionLifecycle::Completed, SessionLifecycle::Cancelled] {
      let dir = tempfile::tempdir().unwrap();
      let session = session();
      let header = RecordingHeader::new(PROTOCOL_VERSION, 1, "test-build", session.clone());
      let mut writer = RecordingWriter::create(
        RecordingMode::Disk {
          directory: dir.path().into(),
        },
        header,
        "roundtrip",
      )
      .unwrap();
      writer.append(state_item(session.id, 42)).unwrap();
      let path = writer.finalize(lifecycle.clone(), None).unwrap().unwrap();
      let recovered = read_recording(path).unwrap();
      assert_eq!(recovered.items.len(), 1);
      assert_eq!(recovered.index.terminal_lifecycle, Some(lifecycle));
      assert!(!recovered.truncated);
    }
  }

  #[test]
  fn truncated_final_index_recovers_completed_chunks() {
    let dir = tempfile::tempdir().unwrap();
    let session = session();
    let header = RecordingHeader::new(PROTOCOL_VERSION, 1, "test-build", session.clone());
    let mut writer = RecordingWriter::create(
      RecordingMode::Disk {
        directory: dir.path().into(),
      },
      header,
      "truncated",
    )
    .unwrap();
    writer.append(state_item(session.id, 9)).unwrap();
    let path = writer
      .finalize(SessionLifecycle::Completed, None)
      .unwrap()
      .unwrap();
    let file = OpenOptions::new().write(true).open(&path).unwrap();
    let len = file.metadata().unwrap().len();
    file.set_len(len - 3).unwrap();
    let recovered = read_recording(path).unwrap();
    assert_eq!(recovered.items.len(), 1);
    assert!(recovered.truncated);
  }
}
