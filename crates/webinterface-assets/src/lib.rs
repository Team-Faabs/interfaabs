use std::sync::Arc;

use webinterface_core::{Asset, AssetSource};

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

#[derive(Default)]
pub struct EmbeddedAssets;

impl AssetSource for EmbeddedAssets {
  fn fingerprint(&self) -> &str {
    ASSET_FINGERPRINT
  }

  fn get(&self, path: &str) -> Option<Asset> {
    let path = path.trim_start_matches('/');
    ASSETS
      .iter()
      .find(|(asset_path, _, _)| *asset_path == path)
      .map(|(asset_path, content_type, bytes)| Asset {
        content_type: (*content_type).to_string(),
        bytes: Arc::from(*bytes),
        immutable: *asset_path != "index.html",
      })
  }
}

pub fn embedded_assets() -> Arc<dyn AssetSource> {
  Arc::new(EmbeddedAssets)
}
