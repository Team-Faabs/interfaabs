import type { VisionStats } from "../hooks/useVisionSocket";

interface VisionPanelProps {
  stats?: VisionStats;
  onSwitchSource: (source: "vision" | "tracked") => void;
}

export default function VisionPanel({ stats, onSwitchSource }: VisionPanelProps) {
  return (
    <div className="px-3 py-2.5 border-b border-slate-700/30">
      <h2 className="text-[10px] font-semibold text-cyan-400/80 uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
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
        Vision
      </h2>
      <div className="flex rounded-lg overflow-hidden border border-slate-700/30 bg-slate-900/50 p-0.5 gap-0.5 mb-2">
        <button
          onClick={() => onSwitchSource("vision")}
          className={`flex-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${
            stats?.active_source === "vision"
              ? "bg-emerald-600/90 text-white shadow-[0_0_8px_rgba(16,185,129,0.3)]"
              : "bg-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
          }`}
        >
          Vision
        </button>
        <button
          onClick={() => onSwitchSource("tracked")}
          className={`flex-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 ${
            stats?.active_source === "tracked"
              ? "bg-emerald-600/90 text-white shadow-[0_0_8px_rgba(16,185,129,0.3)]"
              : "bg-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
          }`}
        >
          Tracked
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
        <div className="flex items-center justify-between">
          <span>Rate</span>
          <span className="text-slate-200">
            {stats ? stats.packets_per_sec.toFixed(1) : "0"} /s
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Delay</span>
          <span className="text-slate-200">
            {stats ? stats.processing_delay_ms.toFixed(1) : "0"} ms
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Vision</span>
          <span className={stats?.vision_connected ? "text-emerald-400" : "text-red-400"}>
            {stats?.vision_connected ? "on" : "off"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Tracked</span>
          <span className={stats?.tracked_connected ? "text-emerald-400" : "text-red-400"}>
            {stats?.tracked_connected ? "on" : "off"}
          </span>
        </div>
      </div>
    </div>
  );
}

