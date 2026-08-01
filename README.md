# FAABS shared operator-interface backend

This branch replaces the legacy interface backend with a Rust host shared by
CrashPilot and simhark, plus the React operator interface that runs on it. The
disposable Phase 2 mockups remain in `mockups/`.

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

## Frontend

`frontend/app` holds the operator interface. It talks only to the real host:
`GET /api/v1/bootstrap`, a stable JSON `ClientHello` on `/api/v1/ws`, then
named-MessagePack traffic. There is no fixture or demo mode.

Two axes combine freely:

- **Shell** — the chrome. `evolved` is the dense descendant of today's
  interface: wide toolbar, collapsing icon rails on both sides, bottom dock and
  a status bar. `brief` is the quiet one: one header line, a workspace subhead,
  and a permanent timeline footer.
- **Theme** — colour, radius and density. `evolved`, `console`, `studio`,
  `brief` and the light `ledger`. Console and Studio are looks, not layouts, so
  either shell can wear either one.

Both shells host the same drag-and-drop dock tree and the same panel registry,
so switching shells never loses a layout. Each workspace owns one layout and
its own top-bar item list; both are editable in Settings and survive export and
import. A railed tabset draws its tab strip as a vertical icon rail and
collapses to the rail when its active tab is deselected.

The field is a Canvas 2D renderer over a renderer-independent scene graph, with
offscreen tiles for the static field geometry and heatmaps, batched paths,
spatial-index picking, and viewport-only pan, zoom, fit, mirror and follow.
React never re-renders at simulation frame rate: the canvas reads the store
inside its own animation frame, and panels showing live numbers subscribe
through a coalescing ~10 Hz channel.

Field options live both behind the burger in the field toolbar and, in full, in
the Settings panel — nothing is reachable only from a popover.

Panels can be popped out into their own window, closed and reopened from the
`＋` on any tab strip, and reordered by dragging. Keyboard shortcuts are
rebindable in Settings; Halt All and Stop All ship unbound, because a stray
keystroke must not stop a live match. Referris UI is hidden entirely — including
from the add-panel menu and the command palette — unless the host advertises a
Referris system.

```bash
pnpm dev                              # Vite on :5173, needs a host for /api
pnpm build                            # tsc --noEmit && vite build
pnpm test                             # vitest
node --experimental-strip-types \
  frontend/app/scripts/protocol-smoke.ts http://127.0.0.1:8080
```

`protocol-smoke.ts` checks the wire contract against a running host: the
handshake, MessagePack framing, and that a `Uuid` travels as 16 raw bytes in
both directions. `rmp_serde::to_vec_named` is not human-readable, so a uuid sent
as a string is rejected — that is the easiest thing here to get silently wrong.

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
