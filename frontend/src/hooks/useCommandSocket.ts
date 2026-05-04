import { useState, useEffect, useRef, useCallback } from "react";
import protobuf from "protobufjs";

export interface InterfaceCommandOptions {
  enableTestfield: boolean;
  testfield: number;
  ballTracked: boolean;
  gcData: boolean;
}

export interface RobotCommand {
  robotId: number;
  state: number;
  task: number;
  posX?: number;
  posY?: number;
  orientation?: number;
  kickOrient?: number;
  speed?: number;
  kickSpeed?: number;
}

export interface SentCommand extends RobotCommand {
  timestamp: number;
}

const root = protobuf.Root.fromJSON({
  nested: {
    CP_Vector2: {
      fields: {
        x: { type: "int32", id: 1, rule: "required" },
        y: { type: "int32", id: 2, rule: "required" },
      },
    },
    CP_State: {
      values: {
        STATE_UNSPECIFIED: 0,
        STATE_HALT: 1,
        STATE_STOP: 2,
        STATE_FREE: 3,
        STATE_GOALIE: 4,
        STATE_SUBSTITUTE: 5,
      },
    },
    CP_Task: {
      values: {
        TASK_UNSPECIFIED: 0,
        TASK_POS: 1,
        TASK_KICK: 2,
        TASK_CHIP: 3,
        TASK_REC_KICK: 4,
        TASK_STEAL: 5,
        TASK_DRIBBLE: 6,
        TASK_PosBall: 7,
        STATE_KICKOFF: 9,
        STATE_FREEKICK: 11,
      },
    },
    CP_Command: {
      fields: {
        state: { type: "CP_State", id: 1, rule: "required" },
        task: { type: "CP_Task", id: 2, rule: "required" },
        pos: { type: "CP_Vector2", id: 3 },
        speed: { type: "uint32", id: 4 },
        orientation: { type: "uint32", id: 5 },
        kick_orient: { type: "uint32", id: 6 },
        kick_speed: { type: "uint32", id: 7 },
      },
    },
    InterfaceRobotCommands_CP: {
      fields: {
        robot_id: { type: "uint32", id: 1, rule: "required" },
        command: { type: "CP_Command", id: 2, rule: "required" },
      },
    },
    InterfaceCommand_CP: {
      fields: {
        enable_testfield: { type: "bool", id: 1, rule: "required" },
        testfield: { type: "uint32", id: 2, rule: "required" },
        ball_tracked: { type: "bool", id: 3, rule: "required" },
        gc_data: { type: "bool", id: 4, rule: "required" },
      },
    },
    InterfaceWrapper_CP: {
      fields: {
        robot_commands: { type: "InterfaceRobotCommands_CP", id: 1, rule: "repeated" },
        interface_command: { type: "InterfaceCommand_CP", id: 2, rule: "required" },
      },
    },
  },
});

const InterfaceWrapperCP = root.lookupType("InterfaceWrapper_CP");

const RECONNECT_DELAY = 2000;
const MAX_HISTORY = 10;

export function useCommandSocket() {
  const [connected, setConnected] = useState(false);
  const [lastSentCommand, setLastSentCommand] = useState<SentCommand | null>(
    null
  );
  const [commandHistory, setCommandHistory] = useState<SentCommand[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/command`;

    try {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onerror = () => console.error("Command WebSocket error");
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY);
      };
    } catch {
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const sendCommands = useCallback(
    (commands: RobotCommand[], interfaceCommand: InterfaceCommandOptions) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.error("Command WebSocket not connected");
        return;
      }

      if (commands.length === 0) return;

      const robotCommands = commands.map((cmd) => {
        const command: Record<string, unknown> = {
          state: cmd.state,
          task: cmd.task,
        };

        if (cmd.posX !== undefined && cmd.posY !== undefined) {
          command.pos = {
            x: Math.round(cmd.posX),
            y: Math.round(cmd.posY),
          };
        }
        if (cmd.speed !== undefined) {
          command.speed = Math.round(cmd.speed);
        }
        if (cmd.orientation !== undefined) {
          command.orientation = Math.round(cmd.orientation);
        }
        if (cmd.kickOrient !== undefined) {
          command.kick_orient = Math.round(cmd.kickOrient);
        }
        if (cmd.kickSpeed !== undefined) {
          command.kick_speed = Math.round(cmd.kickSpeed);
        }

        return {
          robot_id: cmd.robotId,
          command,
        };
      });

      const payload = {
        robot_commands: robotCommands,
        interface_command: {
          enable_testfield: interfaceCommand.enableTestfield,
          testfield: interfaceCommand.testfield,
          ball_tracked: interfaceCommand.ballTracked,
          gc_data: interfaceCommand.gcData,
        },
      };

      const errMsg = InterfaceWrapperCP.verify(payload);
      if (errMsg) {
        console.error("Protobuf verification failed:", errMsg);
        return;
      }

      const message = InterfaceWrapperCP.create(payload);
      const buffer = InterfaceWrapperCP.encode(message).finish();
      wsRef.current.send(buffer);

      const timestamp = Date.now();
      const sentBatch = commands.map((cmd) => ({
        ...cmd,
        timestamp,
      }));

      setLastSentCommand(sentBatch[0]);
      setCommandHistory((prev) =>
        [...sentBatch, ...prev].slice(0, MAX_HISTORY)
      );
    },
    []
  );

  return { sendCommands, connected, lastSentCommand, commandHistory };
}
