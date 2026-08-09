use std::io;
use std::path::PathBuf;

fn main() -> io::Result<()> {
  let proto_root = PathBuf::from("proto");
  let schema = proto_root.join("crashpilot/interface/cp_interface.proto");
  println!("cargo:rerun-if-changed={}", proto_root.display());
  let protoc =
    protoc_bin_vendored::protoc_bin_path().map_err(|error| io::Error::other(error.to_string()))?;
  let include =
    protoc_bin_vendored::include_path().map_err(|error| io::Error::other(error.to_string()))?;
  let mut config = prost_build::Config::new();
  config.protoc_executable(protoc);
  config.extern_path(".google.protobuf.Timestamp", "::prost_types::Timestamp");
  config.extern_path(".google.protobuf.Duration", "::prost_types::Duration");
  config.compile_protos(&[schema], &[proto_root, include])?;
  Ok(())
}
