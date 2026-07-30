use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct Inventory {
  command_variants: BTreeSet<String>,
  routes: BTreeSet<String>,
}

fn main() -> anyhow::Result<()> {
  let command = std::env::args().nth(1).unwrap_or_default();
  let update = std::env::args().any(|argument| argument == "--update");
  match command.as_str() {
    "parity-scan" => parity_scan(update),
    _ => bail!("usage: cargo xtask parity-scan [--update]"),
  }
}

fn parity_scan(update: bool) -> anyhow::Result<()> {
  let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
  let generated = Inventory {
    command_variants: scan_tokens(
      &root.join("crates/webinterface-protocol/src/lib.rs"),
      &[
        "Command", "Start", "Stop", "Pause", "Restart", "Move", "Set", "Halt",
      ],
    )?,
    routes: scan_tokens(
      &root.join("crates/webinterface-core/src/lib.rs"),
      &["/api/", "route("],
    )?,
  };
  let path = root.join("docs/parity-inventory.json");
  if update {
    fs::write(
      &path,
      format!("{}\n", serde_json::to_string_pretty(&generated)?),
    )
    .with_context(|| format!("write {}", path.display()))?;
    println!("updated {}", path.display());
    return Ok(());
  }
  let expected: Inventory =
    serde_json::from_slice(&fs::read(&path).with_context(|| format!("read {}", path.display()))?)?;
  if serde_json::to_value(&generated)? != serde_json::to_value(&expected)? {
    bail!("backend inventory changed; update docs/parity-inventory.json and the parity matrix");
  }
  println!("parity inventory is current");
  Ok(())
}

fn scan_tokens(path: &Path, needles: &[&str]) -> anyhow::Result<BTreeSet<String>> {
  let source = fs::read_to_string(path)?;
  Ok(
    source
      .lines()
      .filter(|line| needles.iter().any(|needle| line.contains(needle)))
      .map(|line| line.trim().to_string())
      .collect(),
  )
}
