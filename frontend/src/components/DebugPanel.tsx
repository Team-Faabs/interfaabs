import { useState, useCallback } from "react";
import type { FieldState } from "../hooks/useVisionSocket";
import ConnectionStatus from "./ConnectionStatus";

const STATE_LABELS: Record<number, string> = {
  0: "Unspecified",
  1: "Halt",
  2: "Stop",
  3: "Free",
  4: "Goalie",
  5: "Substitute",
};

const TASK_LABELS: Record<number, string> = {
  0: "Unspecified",
  1: "Position",
  2: "Kick",
  3: "Chip",
  4: "Receive Kick",
  5: "Steal",
  6: "Dribble",
  7: "Position Ball",
  9: "Kickoff",
  11: "Free Kick",
};

interface DebugPanelProps {
  fieldState: FieldState | null;
  visionWsConnected: boolean;
  commandWsConnected: boolean;
}

export default function DebugPanel({
  fieldState,
  visionWsConnected,
  commandWsConnected,
}: DebugPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);

  const stats = fieldState?.stats;
  const robotCommands = [...(fieldState?.robot_commands ?? [])].sort(
    (a, b) => a.id - b.id
  );

  const switchSource = useCallback((source: "vision" | "tracked") => {
    void fetch("/api/source", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source }),
    }).catch((error) => {
      console.error("Failed to switch source:", error);
    });
  }, []);

  return (
    <div className="border-t border-slate-700/30 bg-slate-900/60 backdrop-blur-xl">
      {/* Header bar - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-2 hover:bg-slate-800/30 transition-all duration-200"
      >
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-semibold text-cyan-400/70 uppercase tracking-[0.15em] flex items-center gap-1.5">
            <svg
              className="w-3 h-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 20V10" />
              <path d="M18 20V4" />
              <path d="M6 20v-4" />
            </svg>
            Debug
          </span>
          <div className="flex items-center gap-3">
            <ConnectionStatus
              label="Vision WS"
              connected={visionWsConnected}
            />
            <div className="h-3 w-px bg-slate-700/40" />
            <ConnectionStatus
              label="Command WS"
              connected={commandWsConnected}
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          {stats && (
            <span className="text-[11px] font-mono text-slate-500">
              {stats.packets_per_sec.toFixed(1)} pkt/s &middot;{" "}
              {stats.processing_delay_ms.toFixed(1)}ms
            </span>
          )}
          <svg
            className={`w-4 h-4 text-slate-500 transition-transform duration-300 ease-out ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3 animate-slide-down">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {/* Connection statuses */}
            <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30 hover-lift">
              <h4 className="text-[10px] text-cyan-400/60 uppercase tracking-[0.12em] mb-2.5 font-semibold flex items-center gap-1.5">
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                  <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                  <line x1="12" y1="20" x2="12.01" y2="20" />
                </svg>
                Streams
              </h4>
              <div className="space-y-2">
                <ConnectionStatus
                  label="Vision Raw"
                  connected={stats?.vision_connected ?? false}
                />
                <ConnectionStatus
                  label="Vision Tracked"
                  connected={stats?.tracked_connected ?? false}
                />
              </div>
            </div>

            {/* Active source */}
            <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30 hover-lift">
              <h4 className="text-[10px] text-cyan-400/60 uppercase tracking-[0.12em] mb-2.5 font-semibold flex items-center gap-1.5">
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
                Source
              </h4>
              <div className="flex rounded-lg overflow-hidden border border-slate-700/30 bg-slate-900/50 p-0.5 gap-0.5 mb-2">
                <button
                  onClick={() => switchSource("vision")}
                  className={`flex-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${
                    stats?.active_source === "vision"
                      ? "bg-emerald-600/90 text-white shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                      : "bg-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                  }`}
                >
                  Vision
                </button>
                <button
                  onClick={() => switchSource("tracked")}
                  className={`flex-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${
                    stats?.active_source === "tracked"
                      ? "bg-emerald-600/90 text-white shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                      : "bg-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                  }`}
                >
                  Tracked
                </button>
              </div>
              <p className="text-[11px] font-mono text-slate-500">
                Active:{" "}
                <span className="text-emerald-400/80">
                  {stats?.active_source ?? "unknown"}
                </span>
              </p>
            </div>

            {/* Packet counters */}
            <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30 hover-lift">
              <h4 className="text-[10px] text-cyan-400/60 uppercase tracking-[0.12em] mb-2.5 font-semibold flex items-center gap-1.5">
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="2" y="2" width="20" height="8" rx="2" />
                  <rect x="2" y="14" width="20" height="8" rx="2" />
                  <line x1="6" y1="6" x2="6.01" y2="6" />
                  <line x1="6" y1="18" x2="6.01" y2="18" />
                </svg>
                Packets
              </h4>
              <div className="space-y-1.5 text-[11px] font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Vision</span>
                  <span className="text-slate-300">
                    {stats?.vision_packets ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tracked</span>
                  <span className="text-slate-300">
                    {stats?.tracked_packets ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Rate</span>
                  <span className="text-cyan-400/80">
                    {stats?.packets_per_sec.toFixed(1) ?? 0} /s
                  </span>
                </div>
              </div>
            </div>

            {/* Timing */}
            <div className="bg-slate-800/30 rounded-xl p-3 border border-slate-700/30 hover-lift">
              <h4 className="text-[10px] text-cyan-400/60 uppercase tracking-[0.12em] mb-2.5 font-semibold flex items-center gap-1.5">
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                Timing
              </h4>
              <div className="space-y-1.5 text-[11px] font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Delay</span>
                  <span className="text-slate-300">
                    {stats?.processing_delay_ms.toFixed(2) ?? 0} ms
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last pkt</span>
                  <span className="text-slate-300">
                    {stats?.last_packet_time
                      ? new Date(
                          stats.last_packet_time * 1000
                        ).toLocaleTimeString()
                      : "N/A"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* CrashPilot robot commands */}
          <div className="bg-slate-800/30 rounded-xl border border-slate-700/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/30">
              <h4 className="text-[10px] text-cyan-400/60 uppercase tracking-[0.12em] font-semibold flex items-center gap-1.5">
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <circle cx="12" cy="5" r="4" />
                  <path d="M8 16h.01M16 16h.01" />
                </svg>
                Robot Tasks
              </h4>
              <span className="text-[11px] font-mono text-slate-500">
                {robotCommands.length} active
              </span>
            </div>

            {robotCommands.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[11px] font-mono">
                  <thead className="text-slate-500 bg-slate-900/40">
                    <tr className="border-b border-slate-700/30">
                      <th className="px-3 py-2 text-left font-semibold">Robot</th>
                      <th className="px-3 py-2 text-left font-semibold">State</th>
                      <th className="px-3 py-2 text-left font-semibold">Task</th>
                      <th className="px-3 py-2 text-right font-semibold">Target</th>
                      <th className="px-3 py-2 text-right font-semibold">Orient</th>
                      <th className="px-3 py-2 text-right font-semibold">Kick</th>
                      <th className="px-3 py-2 text-right font-semibold">Speed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {robotCommands.map((cmd, i) => (
                      <tr
                        key={cmd.id}
                        className={`border-b border-slate-700/20 last:border-0 ${
                          i % 2 === 0 ? "bg-slate-900/10" : "bg-slate-900/25"
                        }`}
                      >
                        <td className="px-3 py-2 text-cyan-400/80 font-semibold">
                          #{cmd.id}
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-md border border-slate-600/40 bg-slate-900/40 px-2 py-1 text-slate-200">
                            {STATE_LABELS[cmd.state] ?? `State ${cmd.state}`}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="rounded-md border border-slate-600/40 bg-slate-900/40 px-2 py-1 text-slate-200">
                            {TASK_LABELS[cmd.task] ?? `Task ${cmd.task}`}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {cmd.pos_x !== undefined && cmd.pos_y !== undefined
                            ? `${cmd.pos_x.toFixed(0)}, ${cmd.pos_y.toFixed(0)}`
                            : "-"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {cmd.orientation !== undefined
                            ? `${cmd.orientation.toFixed(0)} deg`
                            : "-"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {cmd.kick_orient !== undefined || cmd.kick_speed !== undefined
                            ? `${cmd.kick_orient?.toFixed(0) ?? "-"} deg / ${
                                cmd.kick_speed ?? "-"
                              }`
                            : "-"}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300">
                          {cmd.speed !== undefined ? cmd.speed : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-3 py-4 text-xs text-slate-500 italic">
                No robot commands received
              </div>
            )}
          </div>

          {/* Raw data viewer */}
          <div>
            <button
              onClick={() => setRawExpanded(!rawExpanded)}
              className="flex items-center gap-2 text-xs text-slate-500 hover:text-cyan-400/70 transition-all duration-200 group"
            >
              <svg
                className={`w-3 h-3 transition-transform duration-300 ease-out ${
                  rawExpanded ? "rotate-90" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              <span className="group-hover:underline underline-offset-2">
                Raw State Data
              </span>
            </button>
            {rawExpanded && (
              <pre className="mt-2 code-block p-3 text-[11px] font-mono text-slate-400 overflow-auto max-h-64 animate-fade-in leading-relaxed">
                {fieldState
                  ? JSON.stringify(fieldState, null, 2)
                  : "No data received"}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
