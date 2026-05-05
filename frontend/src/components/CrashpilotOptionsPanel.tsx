import type { InterfaceCommandOptions } from "../hooks/useCommandSocket";

interface CrashpilotOptionsPanelProps {
  interfaceCommand: InterfaceCommandOptions;
  onInterfaceCommandChange: (next: InterfaceCommandOptions) => void;
}

const inputClasses =
  "w-full bg-slate-900/80 border border-slate-700/50 rounded-lg px-3 py-2 text-sm font-mono text-slate-200 placeholder-slate-600 focus-cyan transition-all duration-200";

export default function CrashpilotOptionsPanel({
  interfaceCommand,
  onInterfaceCommandChange,
}: CrashpilotOptionsPanelProps) {
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
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        Crashpilot Options
      </h2>
      <div className="space-y-2 text-xs">
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="checkbox"
            checked={interfaceCommand.enableTestfield}
            onChange={(e) =>
              onInterfaceCommandChange({
                ...interfaceCommand,
                enableTestfield: e.target.checked,
              })
            }
          />
          Enable Testfield
        </label>
        <div className="flex items-center gap-2">
          <label className="text-slate-400 text-[11px] w-24">Testfield</label>
          <input
            type="number"
            placeholder="0"
            value={interfaceCommand.testfield}
            onChange={(e) =>
              onInterfaceCommandChange({
                ...interfaceCommand,
                testfield: Number(e.target.value || 0),
              })
            }
            className={inputClasses}
          />
        </div>
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="checkbox"
            checked={interfaceCommand.ballTracked}
            onChange={(e) =>
              onInterfaceCommandChange({
                ...interfaceCommand,
                ballTracked: e.target.checked,
              })
            }
          />
          Ball Tracked
        </label>
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="checkbox"
            checked={interfaceCommand.gcData}
            onChange={(e) =>
              onInterfaceCommandChange({
                ...interfaceCommand,
                gcData: e.target.checked,
              })
            }
          />
          Game Controller Data
        </label>
      </div>
    </div>
  );
}

