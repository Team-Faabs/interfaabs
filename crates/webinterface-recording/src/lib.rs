//! Crash-recoverable `.faabsrec` recording support.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
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
const MAX_HEADER_BYTES: usize = 16 * 1024 * 1024;
const MAX_INDEX_BYTES: usize = 64 * 1024 * 1024;

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

impl RecordingMode {
  pub fn directory(&self) -> Option<PathBuf> {
    match self {
      Self::Disk { directory } => Some(directory.clone()),
      Self::Temp => Some(temp_recording_directory()),
      Self::Memory { .. } | Self::Off => None,
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
        let directory = temp_recording_directory();
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

/// Reads a recording back at a requested frame.
pub struct RecordingReader {
  path: PathBuf,
  reader: BufReader<File>,
  header: RecordingHeader,
  index: RecordingIndex,
}

impl RecordingReader {
  /// Opens a finalised `.faabsrec` or a `.partial` still being written.
  pub fn open(path: &Path) -> Result<Self, RecordingError> {
    let mut reader = BufReader::new(File::open(path)?);
    let (header, data_start) = read_header(&mut reader)?;
    let partial = path
      .file_name()
      .is_some_and(|name| name.to_string_lossy().ends_with(".faabsrec.partial"));
    let index = if partial {
      match read_sidecar_index(path)? {
        Some(index) => index,
        None => scan_index(&mut reader, data_start)?,
      }
    } else {
      read_final_index(&mut reader, data_start)?
    };
    Ok(Self {
      path: path.to_owned(),
      reader,
      header,
      index,
    })
  }

  pub fn header(&self) -> &RecordingHeader {
    &self.header
  }

  /// Lowest and highest frame numbers available, or `None` if empty.
  pub fn frame_range(&self) -> Option<(u64, u64)> {
    frame_range(&self.index)
  }

  /// The state of every system at `frame`, reconstructed from the newest
  /// checkpoint at or before `frame` plus the deltas after it. Returns the
  /// nearest available frame's state when `frame` falls in a gap, and
  /// `Ok(vec![])` when the recording holds no state at all.
  pub fn state_at(&mut self, frame: u64) -> Result<Vec<StateEnvelope>, RecordingError> {
    self.refresh_partial_index()?;
    let Some((first_frame, last_frame)) = self.frame_range() else {
      return Ok(Vec::new());
    };
    let frame = frame.clamp(first_frame, last_frame);
    let chunk_index = self
      .index
      .chunks
      .iter()
      .position(|chunk| chunk.last_frame.is_some_and(|last| last >= frame))
      .or_else(|| {
        self
          .index
          .chunks
          .iter()
          .rposition(|chunk| chunk.last_frame.is_some())
      })
      .expect("a frame range requires at least one state-bearing chunk");

    let mut states = BTreeMap::new();
    if chunk_index > 0 {
      let payload = read_chunk(&mut self.reader, &self.index.chunks[chunk_index - 1])?;
      for checkpoint in payload.checkpoints {
        states.insert(checkpoint.system_id.clone(), checkpoint);
      }
      // Replaying the boundary chunk is idempotent when its checkpoint is the
      // end state and also supports recordings whose checkpoint is the start
      // state, without searching any earlier chunks.
      apply_all_states(&mut states, payload.items);
    }

    let payload = read_chunk(&mut self.reader, &self.index.chunks[chunk_index])?;
    apply_states_through_frame(&mut states, payload.items, frame);
    Ok(states.into_values().collect())
  }

  fn refresh_partial_index(&mut self) -> Result<(), RecordingError> {
    if let Some(index) = read_sidecar_index(&self.path)?
      && index.chunks.len() >= self.index.chunks.len()
    {
      self.index = index;
    }
    Ok(())
  }
}

#[derive(Debug, Clone)]
pub struct RecordingInspection {
  pub header: RecordingHeader,
  pub index: RecordingIndex,
}

pub fn inspect_recording_header(path: impl AsRef<Path>) -> Result<RecordingHeader, RecordingError> {
  let mut reader = BufReader::new(File::open(path)?);
  let (header, _) = read_header(&mut reader)?;
  Ok(header)
}

/// Reads only a recording's header, chunk headers, and final index.
pub fn inspect_finalized_recording(
  path: impl AsRef<Path>,
) -> Result<RecordingInspection, RecordingError> {
  let mut reader = BufReader::new(File::open(path)?);
  let (header, data_start) = read_header(&mut reader)?;
  let index = read_final_index(&mut reader, data_start)?;
  Ok(RecordingInspection { header, index })
}

fn read_header(reader: &mut BufReader<File>) -> Result<(RecordingHeader, u64), RecordingError> {
  reader.seek(SeekFrom::Start(0))?;
  let mut magic = [0; 8];
  reader.read_exact(&mut magic)?;
  if &magic != MAGIC {
    return Err(RecordingError::Invalid("bad magic".into()));
  }
  let header_len = read_u32(reader)? as usize;
  if header_len > MAX_HEADER_BYTES {
    return Err(RecordingError::Invalid("header is too large".into()));
  }
  let mut encoded = vec![0; header_len];
  reader.read_exact(&mut encoded)?;
  let header = rmp_serde::from_slice(&encoded)?;
  Ok((header, reader.stream_position()?))
}

fn read_final_index(
  reader: &mut BufReader<File>,
  data_start: u64,
) -> Result<RecordingIndex, RecordingError> {
  reader.seek(SeekFrom::Start(data_start))?;
  loop {
    let mut marker = [0; 4];
    reader
      .read_exact(&mut marker)
      .map_err(|error| match error.kind() {
        io::ErrorKind::UnexpectedEof => {
          RecordingError::Invalid("recording has no final index".into())
        }
        _ => error.into(),
      })?;
    if &marker == INDEX_MAGIC {
      let index_len = read_u32(reader)? as usize;
      if index_len > MAX_INDEX_BYTES {
        return Err(RecordingError::Invalid("final index is too large".into()));
      }
      let mut encoded = vec![0; index_len];
      reader.read_exact(&mut encoded)?;
      return Ok(rmp_serde::from_slice(&encoded)?);
    }
    if &marker != CHUNK_MAGIC {
      return Err(RecordingError::Invalid(
        "unexpected data before final index".into(),
      ));
    }
    let compressed_bytes = read_u32(reader)?;
    let _uncompressed_bytes = read_u32(reader)?;
    let _crc = read_u32(reader)?;
    reader.seek(SeekFrom::Current(i64::from(compressed_bytes)))?;
  }
}

fn read_sidecar_index(path: &Path) -> Result<Option<RecordingIndex>, RecordingError> {
  let sidecar_path = path.with_extension("faabsrec.index.partial");
  match fs::read(sidecar_path) {
    Ok(bytes) => serde_json::from_slice(&bytes)
      .map(Some)
      .map_err(|error| RecordingError::Invalid(error.to_string())),
    Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
    Err(error) => Err(error.into()),
  }
}

fn scan_index(
  reader: &mut BufReader<File>,
  data_start: u64,
) -> Result<RecordingIndex, RecordingError> {
  reader.seek(SeekFrom::Start(data_start))?;
  let mut chunks = Vec::new();
  loop {
    let offset = reader.stream_position()?;
    let mut marker = [0; 4];
    match reader.read_exact(&mut marker) {
      Ok(()) => {}
      Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
      Err(error) => return Err(error.into()),
    }
    if &marker == INDEX_MAGIC {
      let len = read_u32(reader)? as usize;
      let mut encoded = vec![0; len];
      reader.read_exact(&mut encoded)?;
      return Ok(rmp_serde::from_slice(&encoded)?);
    }
    if &marker != CHUNK_MAGIC {
      break;
    }
    let compressed_bytes = read_u32(reader)?;
    let uncompressed_bytes = read_u32(reader)?;
    let _crc = read_u32(reader)?;
    chunks.push(ChunkIndexEntry {
      offset,
      compressed_bytes,
      uncompressed_bytes,
      first_frame: None,
      last_frame: None,
      first_timestamp_ns: None,
      last_timestamp_ns: None,
    });
    reader.seek(SeekFrom::Current(i64::from(compressed_bytes)))?;
  }

  // A partial file normally has a sidecar. Falling back to decoding each
  // complete chunk keeps externally produced or recovered partials seekable.
  for chunk in &mut chunks {
    let payload = read_chunk(reader, chunk)?;
    *chunk = index_entry(
      chunk.offset,
      chunk.compressed_bytes as usize,
      chunk.uncompressed_bytes as usize,
      &payload.items,
    );
  }
  Ok(RecordingIndex {
    chunks,
    terminal_lifecycle: None,
    terminal_error: None,
  })
}

fn read_chunk(
  reader: &mut BufReader<File>,
  entry: &ChunkIndexEntry,
) -> Result<ChunkPayload, RecordingError> {
  reader.seek(SeekFrom::Start(entry.offset))?;
  let mut marker = [0; 4];
  reader.read_exact(&mut marker)?;
  if &marker != CHUNK_MAGIC {
    return Err(RecordingError::Invalid(
      "indexed chunk has bad magic".into(),
    ));
  }
  let compressed_len = read_u32(reader)? as usize;
  let uncompressed_len = read_u32(reader)? as usize;
  let crc = read_u32(reader)?;
  if compressed_len != entry.compressed_bytes as usize
    || uncompressed_len != entry.uncompressed_bytes as usize
  {
    return Err(RecordingError::Invalid(
      "indexed chunk length does not match its header".into(),
    ));
  }
  let mut compressed = vec![0; compressed_len];
  reader.read_exact(&mut compressed)?;
  if crc32fast::hash(&compressed) != crc {
    return Err(RecordingError::Invalid(
      "indexed chunk checksum does not match".into(),
    ));
  }
  let raw = zstd::stream::decode_all(compressed.as_slice())?;
  if raw.len() != uncompressed_len {
    return Err(RecordingError::Invalid(
      "indexed chunk decompressed to an unexpected length".into(),
    ));
  }
  Ok(rmp_serde::from_slice(&raw)?)
}

fn frame_range(index: &RecordingIndex) -> Option<(u64, u64)> {
  let first = index
    .chunks
    .iter()
    .filter_map(|chunk| chunk.first_frame)
    .min()?;
  let last = index
    .chunks
    .iter()
    .filter_map(|chunk| chunk.last_frame)
    .max()?;
  Some((first, last))
}

fn state_frame(state: &StateEnvelope) -> Option<u64> {
  state.snapshot.worlds.iter().map(|world| world.frame).max()
}

fn apply_all_states(states: &mut BTreeMap<SystemId, StateEnvelope>, items: Vec<RecordedItem>) {
  for item in items {
    if let RecordedItem::State(state) = item {
      states.insert(state.system_id.clone(), state);
    }
  }
}

fn apply_states_through_frame(
  states: &mut BTreeMap<SystemId, StateEnvelope>,
  items: Vec<RecordedItem>,
  frame: u64,
) {
  for item in items {
    let RecordedItem::State(state) = item else {
      continue;
    };
    if state_frame(&state).is_some_and(|state_frame| state_frame > frame) {
      continue;
    }
    states.insert(state.system_id.clone(), state);
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

fn temp_recording_directory() -> PathBuf {
  std::env::temp_dir().join("faabs-recordings")
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
        worlds: vec![webinterface_protocol::WorldState {
          world_id: 0,
          frame,
          simulation_time_ns: TimestampNs(frame * 1_000_000),
          field: webinterface_protocol::FieldGeometry::default(),
          ball: None,
          robots: Vec::new(),
          referee: None,
          score: webinterface_protocol::Score { blue: 0, yellow: 0 },
          events: Vec::new(),
        }],
        debug_layers: Vec::new(),
        debug_items: Vec::new(),
        properties: BTreeMap::new(),
      },
      cursor_id: None,
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
  fn recording_reader_reconstructs_state_at_a_past_frame() {
    let dir = tempfile::tempdir().unwrap();
    let session = session();
    let header = RecordingHeader::new(PROTOCOL_VERSION, 1, "test-build", session.clone());
    let mut writer = RecordingWriter::create(
      RecordingMode::Disk {
        directory: dir.path().into(),
      },
      header,
      "reader-past-frame",
    )
    .unwrap();
    for frame in [10, 20, 30] {
      writer.append(state_item(session.id, frame)).unwrap();
      writer.flush_boundary().unwrap();
    }
    let path = writer
      .finalize(SessionLifecycle::Completed, None)
      .unwrap()
      .unwrap();

    let mut reader = RecordingReader::open(&path).unwrap();
    assert_eq!(reader.frame_range(), Some((10, 30)));
    let states = reader.state_at(20).unwrap();
    assert_eq!(states.len(), 1);
    assert_eq!(states[0].snapshot.worlds[0].frame, 20);
  }

  #[test]
  fn state_at_handles_a_frame_between_checkpoints() {
    let dir = tempfile::tempdir().unwrap();
    let session = session();
    let header = RecordingHeader::new(PROTOCOL_VERSION, 1, "test-build", session.clone());
    let mut writer = RecordingWriter::create(
      RecordingMode::Disk {
        directory: dir.path().into(),
      },
      header,
      "reader-between-checkpoints",
    )
    .unwrap();
    writer.append(state_item(session.id, 10)).unwrap();
    writer.flush_boundary().unwrap();
    writer.append(state_item(session.id, 20)).unwrap();
    writer.append(state_item(session.id, 30)).unwrap();
    writer.flush_boundary().unwrap();
    let path = writer
      .finalize(SessionLifecycle::Completed, None)
      .unwrap()
      .unwrap();

    let mut reader = RecordingReader::open(&path).unwrap();
    let states = reader.state_at(25).unwrap();
    assert_eq!(states.len(), 1);
    assert_eq!(states[0].snapshot.worlds[0].frame, 20);
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
