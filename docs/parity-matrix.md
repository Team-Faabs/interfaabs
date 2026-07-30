# Backend parity matrix

This matrix is intentionally backend-only. Frontend panel/action work remains
unstarted.

| Capability ID | Legacy source | New backend contract | Automated check | Status |
|---|---|---|---|---|
| global.bootstrap | Go HTTP service, simhark viewer | `GET /api/v1/bootstrap` | core host tests | green |
| global.handshake | separate legacy sockets | JSON hello then named MessagePack | stale/valid WebSocket integration tests | green |
| global.review-guard | absent | cursor/session mutation validation | `historical_cursor_rejects_mutation` | green |
| global.multi-host | absent | independent `InterfaceHost` values | `two_independent_hosts_can_run_in_one_process` | green |
| global.recording | simhark replay only | crash-recoverable `.faabsrec` chunks | completion/cancellation/truncation tests and match smoke run | green |
| crashpilot.options | Go `set_options` | `CrashPilotCommand::SetOptions` | bridge tests | green |
| crashpilot.robot-command | Go `send_command` | `CrashPilotCommand::SendRobotCommand` | bridge tests | green |
| crashpilot.emergency | manual repeated commands | typed Halt All / Stop All | bridge tests | green |
| crashpilot.snapshot | protobuf controller stream | canonical `SystemSnapshot` | bridge fixtures | green |
| simhark.lifecycle | viewer text commands | typed `SimharkCommand` | adapter tests | green |
| simhark.mutation | viewer text commands | robot/ball typed mutations | adapter tests | green |
| simhark.world-state | viewer JSON | canonical millimetre world state | asymmetric fixture | green |
| simhark.no-args | default match | empty host with no world | bootstrap/health smoke run | green |
| simhark.match-recording | `.shreplay` only | canonical `.faabsrec` stream | `--record-interface` smoke run | green |
| crashpilot.vision-replay | embedded legacy executable | in-process shared host/bridge | workspace compile | green |
| dehumanized.debug | local debug types | canonical layers and every debug primitive | adapter unit test | green |
| assets.isolation | simhark `build.rs` | dedicated assets crate + pnpm | rebuild check | green |
