use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Context;
use tracing_subscriber::EnvFilter;
use webinterface_assets::embedded_assets;
use webinterface_core::{InterfaceConfig, InterfaceHost};
use webinterface_crashpilot_bridge::{
  CrashPilotAdapter, LegacyBridgeConfig, run_legacy_controller,
};
use webinterface_protocol::{SessionKind, SessionLifecycle};
use webinterface_recording::RecordingMode;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
  tracing_subscriber::fmt()
    .with_env_filter(EnvFilter::from_default_env())
    .try_init()
    .ok();

  let bind_address = std::env::var("FAABS_INTERFACE_BIND")
    .unwrap_or_else(|_| "0.0.0.0:8080".into())
    .parse::<SocketAddr>()
    .context("invalid FAABS_INTERFACE_BIND")?;
  let recording_mode = std::env::var_os("FAABS_RECORDINGS")
    .map(PathBuf::from)
    .map_or_else(RecordingMode::default, |directory| RecordingMode::Disk {
      directory,
    });
  let config = InterfaceConfig {
    bind_address,
    assets: embedded_assets(),
    recording_mode,
    ..InterfaceConfig::default()
  };
  let (_guard, handle) = InterfaceHost::start(config)?;
  let session = handle.create_session(
    "CrashPilot live",
    SessionKind::LiveMatch,
    true,
    vec!["crashpilot".into()],
    1,
  );
  handle.update_session(session.id, SessionLifecycle::Running, None)?;
  let adapter = CrashPilotAdapter::register(&handle, session.id)?;
  let websocket_url =
    std::env::var("CRASHPILOT_WS_URL").unwrap_or_else(|_| "ws://127.0.0.1:4096/ws".into());
  tokio::spawn(async move {
    if let Err(error) = run_legacy_controller(
      adapter,
      LegacyBridgeConfig {
        websocket_url,
        ..LegacyBridgeConfig::default()
      },
    )
    .await
    {
      tracing::error!(%error, "CrashPilot bridge stopped");
    }
  });
  println!("FAABS interface listening at {}", handle.http_url());
  tokio::signal::ctrl_c().await?;
  Ok(())
}
