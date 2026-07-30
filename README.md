# FAABS shared operator-interface backend

This branch replaces the legacy interface backend with a Rust host shared by
CrashPilot and simhark. The React application is deliberately blank; frontend
implementation is a separate milestone. The approved mockups remain in
`mockups/`.

## Backend crates

- `webinterface-protocol`: canonical millimetre/radian contract, sessions,
  capabilities, typed commands, debug primitives, and browser messages.
- `webinterface-core`: same-origin HTTP/WebSocket host, system registry,
  command routing, review guards, health, and recording orchestration.
- `webinterface-recording`: crash-recoverable, indexed, chunked and compressed
  `.faabsrec` recordings.
- `webinterface-assets`: isolated pnpm/Vite build and Rust asset embedding.
- `webinterface-crashpilot-bridge`: legacy CrashPilot protobuf compatibility
  adapter and reconnecting controller client.
- `crashpilot-interface`: standalone Rust composition root.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
cargo test --workspace
cargo run -p xtask -- parity-scan
cargo run -p crashpilot-interface
```

The standalone host binds to `0.0.0.0:8080` by default. Override it with
`FAABS_INTERFACE_BIND`, the recording directory with `FAABS_RECORDINGS`, and
the legacy controller stream with `CRASHPILOT_WS_URL`.

The simhark and CrashPilot integration branches live in separate clean
worktrees. Their local manifests point at these crates until the interface
milestone is published and can be pinned to an exact Git revision.
