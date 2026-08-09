use std::collections::hash_map::DefaultHasher;
use std::env;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() -> io::Result<()> {
  let crate_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
  let root = crate_dir.join("../..").canonicalize()?;
  let app = root.join("frontend/app");
  let output = PathBuf::from(env::var("OUT_DIR").unwrap()).join("frontend");

  for input in [
    root.join("package.json"),
    root.join("pnpm-lock.yaml"),
    root.join("pnpm-workspace.yaml"),
    app.join("package.json"),
    app.join("index.html"),
    app.join("tsconfig.json"),
    app.join("vite.config.ts"),
    app.join("src"),
    // Workspace packages are compiled from source into the app bundle, so
    // they are build inputs just like `frontend/app/src`.
    root.join("frontend/packages"),
  ] {
    println!("cargo:rerun-if-changed={}", input.display());
  }
  println!("cargo:rerun-if-env-changed=WEBINTERFACE_SKIP_FRONTEND");

  if env::var_os("WEBINTERFACE_SKIP_FRONTEND").is_none() {
    if !root.join("node_modules").exists() {
      let status = Command::new("pnpm")
        .args(["install", "--frozen-lockfile"])
        .current_dir(&root)
        .status()?;
      if !status.success() {
        panic!("pnpm install failed with {status}");
      }
    }
    let status = Command::new("pnpm")
      .args([
        "--filter",
        "@faabs/interface-app",
        "exec",
        "vite",
        "build",
        "--outDir",
      ])
      .arg(&output)
      .arg("--emptyOutDir")
      .current_dir(&root)
      .status()?;
    if !status.success() {
      panic!("Vite build failed with {status}");
    }
  } else {
    fs::create_dir_all(&output)?;
    fs::write(
      output.join("index.html"),
      "<!doctype html><html><body><div id=\"root\"></div></body></html>",
    )?;
  }

  generate_assets(&output, &PathBuf::from(env::var("OUT_DIR").unwrap()))
}

fn generate_assets(output: &Path, out_dir: &Path) -> io::Result<()> {
  let mut files = Vec::new();
  visit(output, output, &mut files)?;
  files.sort_by(|left, right| left.0.cmp(&right.0));

  let mut hasher = DefaultHasher::new();
  let mut generated = String::from("pub static ASSETS: &[(&str, &str, &[u8])] = &[\n");
  for (relative, absolute) in &files {
    let bytes = fs::read(absolute)?;
    relative.hash(&mut hasher);
    bytes.hash(&mut hasher);
    let mime = mime(relative);
    generated.push_str(&format!(
      "  ({relative:?}, {mime:?}, include_bytes!({absolute:?})),\n",
      absolute = absolute.display().to_string(),
    ));
  }
  generated.push_str("];\n");
  generated.push_str(&format!(
    "pub const ASSET_FINGERPRINT: &str = \"{:016x}\";\n",
    hasher.finish()
  ));
  fs::write(out_dir.join("assets.rs"), generated)
}

fn visit(root: &Path, current: &Path, files: &mut Vec<(String, PathBuf)>) -> io::Result<()> {
  for entry in fs::read_dir(current)? {
    let entry = entry?;
    let path = entry.path();
    if path.is_dir() {
      visit(root, &path, files)?;
    } else {
      let relative = path
        .strip_prefix(root)
        .unwrap()
        .to_string_lossy()
        .replace('\\', "/");
      files.push((relative, path));
    }
  }
  Ok(())
}

fn mime(path: &str) -> &'static str {
  match Path::new(path).extension().and_then(|value| value.to_str()) {
    Some("html") => "text/html; charset=utf-8",
    Some("js") => "text/javascript; charset=utf-8",
    Some("css") => "text/css; charset=utf-8",
    Some("json") | Some("map") => "application/json",
    Some("svg") => "image/svg+xml",
    Some("png") => "image/png",
    Some("woff2") => "font/woff2",
    _ => "application/octet-stream",
  }
}
