# Backend parity matrix

This matrix is intentionally backend-only.

The frontend now exists (`frontend/app`) and consumes every row below, but its
own parity rows are not filled in here yet: the panels are written against the
canonical protocol rather than against captured legacy behaviour, so claiming
green for them would not be falsifiable. Frontend rows belong in this matrix
once the legacy Go and simhark captures from Phase 1 can be replayed against
them.

The one exception is `simhark.ai-lab`, which is a deliberate compatibility
change rather than a port: the legacy console re-sent an `activate` on every
form edit and the controller rebuilt the entry on every tick, so a stateful
skill could never progress past its first step. Loading and starting are now
separate commands and an entry is instantiated exactly once per start.

| Capability ID | Legacy source | New backend contract | Automated check | Status |
|---|---|---|---|---|
| global.bootstrap | Go HTTP service, simhark viewer | `GET /api/v1/bootstrap` | core host tests | green |
| global.handshake | separate legacy sockets | JSON hello then named MessagePack | stale/valid WebSocket integration tests | green |
| global.review-guard | absent | cursor/session mutation validation | `historical_cursor_rejects_mutation` | green |
| global.multi-host | absent | independent `InterfaceHost` values | `two_independent_hosts_can_run_in_one_process` | green |
| global.recording | simhark replay only | crash-recoverable `.faabsrec` chunks | completion/cancellation/truncation tests and match smoke run | green |
| global.recording-seek | simhark replay only | indexed detached-cursor historical state | recording reader and detached cursor seek tests | green |
| global.recording-library | recording directory was write-only | recursive opaque-ID recording summaries, including partial and unreadable files | recording listing tests | green |
| global.recording-open | simhark replay picker | opaque-ID `.faabsrec` replay sessions; honest rejection for pending legacy importers | recording open tests | green |
| global.recording-import | absent | capped raw HTTP upload with filename traversal guard | recording import test | green |
| crashpilot.options | Go `set_options` | `CrashPilotCommand::SetOptions` | bridge tests | green |
| crashpilot.robot-command | Go `send_command` | `CrashPilotCommand::SendRobotCommand` | bridge tests | green |
| crashpilot.emergency | manual repeated commands | typed Halt All / Stop All | bridge tests | green |
| crashpilot.snapshot | protobuf controller stream | canonical `SystemSnapshot` | bridge fixtures | green |
| simhark.lifecycle | viewer text commands | typed `SimharkCommand` | adapter tests | green |
| simhark.mutation | viewer text commands | robot/ball typed mutations | adapter tests | green |
| simhark.world-state | viewer JSON | canonical millimetre world state | asymmetric fixture | green |
| simhark.no-args | default match | empty host with no world | bootstrap/health smoke run | green |
| simhark.match-recording | `.shreplay` only | canonical `.faabsrec` stream | `--record-interface` smoke run | green |
| simhark.strategy-debug | viewer-only `debug` blob | canonical layers and primitives for strategy text, robot tasks, holograms and kick lines | `canonical_debug_items` tests | green |
| simhark.robot-task | viewer-only `debug` blob | `RobotState::task` from the controller's own label | `canonical_debug_items` tests | green |
| simhark.referee | viewer-only `game_state` blob | canonical `RefereeState` and accumulated `Score` | viewer publish path | green |
| simhark.ai-lab | implicit activate on every form edit | explicit `Load`/`Start`/`Stop` with published `DeveloperRunState` | `direct_dehumanized` lifecycle tests and viewer request tests | green |
| crashpilot.vision-replay | embedded legacy executable | in-process shared host/bridge | workspace compile | green |
| dehumanized.debug | local debug types | canonical layers and every debug primitive | adapter unit test | green |
| assets.isolation | simhark `build.rs` | dedicated assets crate + pnpm | rebuild check | green |
