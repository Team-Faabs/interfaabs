import { useState, useCallback, useEffect } from "react";
import { useVisionSocket } from "./hooks/useVisionSocket";
import { useCommandSocket, InterfaceCommandOptions } from "./hooks/useCommandSocket";
import FieldCanvas from "./components/FieldCanvas";
import TeamSelector from "./components/TeamSelector";
import RobotPanel from "./components/RobotPanel";
import DebugPanel from "./components/DebugPanel";

export default function App() {
  const [myTeam, setMyTeam] = useState<"blue" | "yellow">("blue");
  const [selectedRobotIds, setSelectedRobotIds] = useState<number[]>([]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [fieldClickPos, setFieldClickPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [interfaceCommand, setInterfaceCommand] = useState<InterfaceCommandOptions>({
    enableTestfield: false,
    testfield: 0,
    ballTracked: true,
    gcData: true,
  });

  const { fieldState, connected: visionConnected } = useVisionSocket();
  const {
    sendCommands,
    connected: commandConnected,
    commandHistory,
  } = useCommandSocket();

  useEffect(() => {
    if (!multiSelect && selectedRobotIds.length > 1) {
      setSelectedRobotIds([selectedRobotIds[0]]);
    }
  }, [multiSelect, selectedRobotIds]);

  const handleRobotSelect = useCallback(
    (id: number) => {
      setSelectedRobotIds((prev) => {
        if (!multiSelect) {
          return [id];
        }
        return prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id];
      });
    },
    [multiSelect]
  );

  const handleFieldClick = useCallback((x: number, y: number) => {
    setFieldClickPos({ x, y });
  }, []);

  const myTeamRobots =
    (myTeam === "blue" ? fieldState?.robots_blue : fieldState?.robots_yellow) ?? [];
  const myTeamRobotIds = myTeamRobots.map((r) => r.id);

  const selectedRobotId = selectedRobotIds.length === 1 ? selectedRobotIds[0] : null;
  const selectedRobotData =
    selectedRobotId !== null
      ? myTeamRobots.find((r) => r.id === selectedRobotId)
      : undefined;

  const handleSendCommands = useCallback(
    (robotIds: number[], command: Omit<Parameters<typeof sendCommands>[0][number], "robotId">) => {
      if (robotIds.length === 0) return;
      sendCommands(
        robotIds.map((robotId) => ({ robotId, ...command })),
        interfaceCommand
      );
    },
    [sendCommands, interfaceCommand]
  );

  return (
    <div className="h-full flex flex-col bg-dot-pattern text-slate-100">
      {/* Top header bar */}
      <header className="flex items-center justify-between px-5 py-2.5 bg-slate-900/80 backdrop-blur-xl border-b border-slate-700/40 shrink-0 relative">
        {/* Accent line at bottom of header */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-linear-to-r from-transparent via-cyan-500/30 to-transparent" />

        <div className="flex items-center gap-4">
          {/* Logo / App name */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-linear-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <h1 className="text-lg font-bold tracking-tight">
              <span className="text-cyan-400">Crash</span>
              <span className="text-slate-200">Pilot</span>
            </h1>
          </div>
          <div className="h-4 w-px bg-slate-700/60" />
          <span className="text-xs text-slate-500 font-mono tracking-wide">
            RoboCup SSL Control
          </span>
        </div>

        {/* Header connection indicators */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/30">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full transition-all duration-300 ${
                  visionConnected
                    ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                    : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]"
                }`}
              />
              <span className="text-xs font-mono text-slate-400">VIS</span>
            </div>
            <div className="h-3 w-px bg-slate-700/40" />
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full transition-all duration-300 ${
                  commandConnected
                    ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
                    : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]"
                }`}
              />
              <span className="text-xs font-mono text-slate-400">CMD</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex min-h-0 gap-2 p-2">
        {/* Left: Field visualization */}
        <div className="flex-1 min-w-0">
          <div className="h-full glass-panel overflow-hidden panel-accent">
            <FieldCanvas
              fieldState={fieldState}
              myTeam={myTeam}
              selectedRobotIds={selectedRobotIds}
              onRobotSelect={handleRobotSelect}
              onFieldClick={handleFieldClick}
            />
          </div>
        </div>

        {/* Right: Command panel */}
        <div className="w-75 shrink-0 glass-panel panel-accent flex flex-col overflow-hidden">
          {/* Team selector section */}
          <div className="p-3 border-b border-slate-700/30">
            <h2 className="text-[10px] font-semibold text-cyan-400/80 uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Team
            </h2>
            <TeamSelector team={myTeam} onTeamChange={setMyTeam} />
          </div>

          {/* Robot selector */}
          <div className="px-3 py-2.5 border-b border-slate-700/30">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[10px] font-semibold text-cyan-400/80 uppercase tracking-[0.15em] flex items-center gap-1.5">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <circle cx="12" cy="5" r="4" />
                </svg>
                Robots
              </h2>
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={multiSelect}
                    onChange={(e) => setMultiSelect(e.target.checked)}
                  />
                  Multi
                </label>
                <button
                  onClick={() => setSelectedRobotIds([])}
                  className="text-slate-400 hover:text-slate-200"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {myTeamRobots
                .slice()
                .sort((a, b) => a.id - b.id)
                .map((robot) => (
                  <button
                    key={robot.id}
                    onClick={() => handleRobotSelect(robot.id)}
                    className={`w-9 h-9 rounded-lg text-xs font-bold transition-all duration-200 border ${
                      selectedRobotIds.includes(robot.id)
                        ? myTeam === "blue"
                          ? "bg-blue-600 text-white border-blue-400/60 shadow-[0_0_12px_rgba(59,130,246,0.4)] animate-glow-blue"
                          : "bg-amber-500 text-slate-900 border-amber-400/60 shadow-[0_0_12px_rgba(245,158,11,0.4)] animate-glow-yellow"
                        : myTeam === "blue"
                          ? "bg-blue-600/15 text-blue-400 border-blue-500/20 hover:bg-blue-600/30 hover:border-blue-400/40"
                          : "bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/30 hover:border-amber-400/40"
                    }`}
                  >
                    {robot.id}
                  </button>
                )) ?? (
                <span className="text-xs text-slate-500 italic">
                  No robots detected
                </span>
              )}
            </div>
          </div>

          {/* Command builder */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-2 border-b border-slate-700/30">
              <h2 className="text-[10px] font-semibold text-cyan-400/80 uppercase tracking-[0.15em] flex items-center gap-1.5">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                Command
              </h2>
            </div>
            <RobotPanel
              selectedRobotIds={selectedRobotIds}
              allRobotIds={myTeamRobotIds}
              robotData={selectedRobotData}
              onSendCommands={handleSendCommands}
              commandHistory={commandHistory}
              fieldClickPos={fieldClickPos}
              interfaceCommand={interfaceCommand}
              onInterfaceCommandChange={setInterfaceCommand}
            />
          </div>
        </div>
      </div>

      {/* Bottom: Debug panel */}
      <DebugPanel
        fieldState={fieldState}
        visionWsConnected={visionConnected}
        commandWsConnected={commandConnected}
      />
    </div>
  );
}
