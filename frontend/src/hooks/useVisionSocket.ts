import { useState, useEffect, useRef, useCallback } from "react";

export interface FieldLine {
  name: string;
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
  thickness: number;
}

export interface FieldArc {
  name: string;
  center_x: number;
  center_y: number;
  radius: number;
  a1: number;
  a2: number;
  thickness: number;
}

export interface FieldGeometry {
  field_length: number;
  field_width: number;
  goal_width: number;
  goal_depth: number;
  boundary_width: number;
  lines: FieldLine[];
  arcs: FieldArc[];
}

export interface BallState {
  x: number;
  y: number;
  z: number;
  confidence: number;
}

export interface RobotState {
  id: number;
  x: number;
  y: number;
  orientation: number;
  confidence: number;
}

export interface VisionStats {
  vision_packets: number;
  tracked_packets: number;
  packets_per_sec: number;
  last_packet_time: number;
  processing_delay_ms: number;
  active_source: string;
  vision_connected: boolean;
  tracked_connected: boolean;
}

export interface RobotCommandState {
  id: number;
  state: number;
  task: number;
  pos_x?: number;
  pos_y?: number;
  orientation?: number;
  kick_orient?: number;
  speed?: number;
  kick_speed?: number;
}

export interface FieldState {
  source: string;
  geometry?: FieldGeometry;
  balls: BallState[];
  robots_blue: RobotState[];
  robots_yellow: RobotState[];
  robot_commands: RobotCommandState[];
  stats: VisionStats;
}

const RECONNECT_DELAY = 2000;

export function useVisionSocket() {
  const [fieldState, setFieldState] = useState<FieldState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/vision`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const data: FieldState = JSON.parse(event.data);
          setFieldState(data);
        } catch (e) {
          console.error("Failed to parse vision message:", e);
        }
      };

      ws.onerror = () => {
        setError("WebSocket connection error");
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Auto-reconnect
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY);
      };
    } catch (e) {
      setError(`Failed to connect: ${e}`);
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

  return { fieldState, connected, error };
}
