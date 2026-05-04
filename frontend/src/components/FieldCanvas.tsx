import { useRef, useEffect, useCallback } from "react";
import type { FieldState, RobotState } from "../hooks/useVisionSocket";

interface FieldCanvasProps {
  fieldState: FieldState | null;
  myTeam: "blue" | "yellow";
  selectedRobotIds: number[];
  onRobotSelect: (id: number) => void;
  onFieldClick?: (x: number, y: number) => void;
}

const FIELD_GREEN_LIGHT = "#1a5c34";
const FIELD_GREEN_DARK = "#0d3320";
const LINE_COLOR = "#ffffff";
const LINE_GLOW_COLOR = "rgba(255, 255, 255, 0.15)";
const BALL_COLOR = "#ff8c00";
const BALL_GLOW = "rgba(255, 140, 0, 0.4)";
const BLUE_COLOR = "#3b82f6";
const YELLOW_COLOR = "#f59e0b";
const SELECTED_COLOR = "#22d3ee";
const ROBOT_RADIUS_MM = 90;
const BALL_RADIUS_MM = 43;
const PADDING = 40;

export default function FieldCanvas({
  fieldState,
  myTeam,
  selectedRobotIds,
  onRobotSelect,
  onFieldClick,
}: FieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const transformRef = useRef<{
    scale: number;
    offsetX: number;
    offsetY: number;
    fieldLength: number;
    fieldWidth: number;
  } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    // Deep dark background
    ctx.fillStyle = "#070d15";
    ctx.fillRect(0, 0, w, h);

    if (!fieldState) {
      ctx.fillStyle = "#475569";
      ctx.font = '14px "Inter", system-ui';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Waiting for vision data...", w / 2, h / 2);
      // Draw subtle loading pulse
      ctx.strokeStyle = "rgba(6, 182, 212, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2 + 30, 12, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    const geom = fieldState.geometry;
    const fieldLength = geom?.field_length ?? 9000;
    const fieldWidth = geom?.field_width ?? 6000;
    const boundaryWidth = geom?.boundary_width ?? 300;
    const goalDepth = geom?.goal_depth ?? 180;
    const goalWidth = geom?.goal_width ?? 1000;

    const totalLength = fieldLength + 2 * boundaryWidth;
    const totalWidth = fieldWidth + 2 * boundaryWidth;

    const scaleX = (w - 2 * PADDING) / totalLength;
    const scaleY = (h - 2 * PADDING) / totalWidth;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = w / 2;
    const offsetY = h / 2;

    transformRef.current = {
      scale,
      offsetX,
      offsetY,
      fieldLength,
      fieldWidth,
    };

    const toCanvas = (fx: number, fy: number): [number, number] => {
      return [offsetX + fx * scale, offsetY - fy * scale];
    };

    // Field area - gradient fill
    const [flx, fly] = toCanvas(-fieldLength / 2, fieldWidth / 2);
    const fieldGrad = ctx.createLinearGradient(
      flx,
      fly,
      flx + fieldLength * scale,
      fly + fieldWidth * scale
    );
    fieldGrad.addColorStop(0, FIELD_GREEN_DARK);
    fieldGrad.addColorStop(0.5, FIELD_GREEN_LIGHT);
    fieldGrad.addColorStop(1, FIELD_GREEN_DARK);
    ctx.fillStyle = fieldGrad;
    ctx.fillRect(flx, fly, fieldLength * scale, fieldWidth * scale);

    // Subtle grid pattern on field
    ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
    ctx.lineWidth = 1;
    const gridSpacing = 500; // 500mm grid
    for (
      let gx = -fieldLength / 2;
      gx <= fieldLength / 2;
      gx += gridSpacing
    ) {
      const [x1, y1] = toCanvas(gx, fieldWidth / 2);
      const [x2, y2] = toCanvas(gx, -fieldWidth / 2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    for (
      let gy = -fieldWidth / 2;
      gy <= fieldWidth / 2;
      gy += gridSpacing
    ) {
      const [x1, y1] = toCanvas(-fieldLength / 2, gy);
      const [x2, y2] = toCanvas(fieldLength / 2, gy);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Field boundary subtle outline
    ctx.strokeStyle = "rgba(45, 90, 58, 0.5)";
    ctx.lineWidth = 1;
    const [blx, bly] = toCanvas(-totalLength / 2, totalWidth / 2);
    ctx.strokeRect(blx, bly, totalLength * scale, totalWidth * scale);

    // Helper: draw line with glow effect
    const drawGlowLine = (
      x1: number,
      y1: number,
      x2: number,
      y2: number
    ) => {
      // Glow pass
      ctx.strokeStyle = LINE_GLOW_COLOR;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Sharp pass
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    // Helper: draw arc with glow
    const drawGlowArc = (
      cx: number,
      cy: number,
      r: number,
      a1: number,
      a2: number
    ) => {
      // Glow pass
      ctx.strokeStyle = LINE_GLOW_COLOR;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a1, a2);
      ctx.stroke();
      // Sharp pass
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a1, a2);
      ctx.stroke();
    };

    // Helper: draw rect with glow
    const drawGlowRect = (
      rx: number,
      ry: number,
      rw: number,
      rh: number
    ) => {
      ctx.strokeStyle = LINE_GLOW_COLOR;
      ctx.lineWidth = 6;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.strokeStyle = LINE_COLOR;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx, ry, rw, rh);
    };

    // Draw lines from geometry
    if (geom?.lines) {
      for (const line of geom.lines) {
        const [x1, y1] = toCanvas(line.p1x, line.p1y);
        const [x2, y2] = toCanvas(line.p2x, line.p2y);
        drawGlowLine(x1, y1, x2, y2);
      }
    } else {
      // Fallback: draw basic field lines
      const [ox, oy] = toCanvas(-fieldLength / 2, fieldWidth / 2);
      drawGlowRect(ox, oy, fieldLength * scale, fieldWidth * scale);
      // Center line
      const [cx1, cy1] = toCanvas(0, fieldWidth / 2);
      const [cx2, cy2] = toCanvas(0, -fieldWidth / 2);
      drawGlowLine(cx1, cy1, cx2, cy2);
      // Center circle
      const [cc, ccY] = toCanvas(0, 0);
      drawGlowArc(cc, ccY, 500 * scale, 0, Math.PI * 2);
    }

    // Draw arcs from geometry
    if (geom?.arcs) {
      for (const arc of geom.arcs) {
        const [cx, cy] = toCanvas(arc.center_x, arc.center_y);
        const r = arc.radius * scale;
        drawGlowArc(cx, cy, r, -arc.a2, -arc.a1);
      }
    }

    // Draw goals with glow
    const [lgx, lgy] = toCanvas(
      -fieldLength / 2 - goalDepth,
      goalWidth / 2
    );
    drawGlowRect(lgx, lgy, goalDepth * scale, goalWidth * scale);
    const [rgx, rgy] = toCanvas(fieldLength / 2, goalWidth / 2);
    drawGlowRect(rgx, rgy, goalDepth * scale, goalWidth * scale);

    const selectedSet = new Set(selectedRobotIds);

    // Draw robots
    const drawRobot = (
      robot: RobotState,
      color: string,
      isMyTeam: boolean,
      isSelected: boolean
    ) => {
      const [rx, ry] = toCanvas(robot.x, robot.y);
      const r = Math.max(ROBOT_RADIUS_MM * scale, 8);

      // Outer glow / shadow
      const glowGrad = ctx.createRadialGradient(rx, ry, r, rx, ry, r * 2.5);
      glowGrad.addColorStop(0, color === BLUE_COLOR ? "rgba(59,130,246,0.15)" : "rgba(245,158,11,0.15)");
      glowGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(rx, ry, r * 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Selection animated pulse ring
      if (isSelected) {
        const time = timeRef.current;
        const pulsePhase = (Math.sin(time * 3) + 1) / 2; // 0 to 1
        const pulseRadius = r + 4 + pulsePhase * 6;
        const pulseAlpha = 0.7 - pulsePhase * 0.5;

        ctx.beginPath();
        ctx.arc(rx, ry, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34, 211, 238, ${pulseAlpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Second ring
        const pulse2Radius = r + 8 + pulsePhase * 10;
        const pulse2Alpha = 0.3 - pulsePhase * 0.25;
        ctx.beginPath();
        ctx.arc(rx, ry, pulse2Radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34, 211, 238, ${Math.max(0, pulse2Alpha)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Robot body with subtle gradient
      const bodyGrad = ctx.createRadialGradient(
        rx - r * 0.3,
        ry - r * 0.3,
        0,
        rx,
        ry,
        r
      );
      if (color === BLUE_COLOR) {
        bodyGrad.addColorStop(0, "#60a5fa");
        bodyGrad.addColorStop(1, "#2563eb");
      } else {
        bodyGrad.addColorStop(0, "#fbbf24");
        bodyGrad.addColorStop(1, "#d97706");
      }
      ctx.beginPath();
      ctx.arc(rx, ry, r, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // Border
      if (isMyTeam) {
        ctx.strokeStyle = isSelected ? SELECTED_COLOR : "rgba(255,255,255,0.6)";
        ctx.lineWidth = isSelected ? 2 : 1.5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Orientation arrow - team color with brighter tip
      const dirLen = r + 8;
      const dx = Math.cos(robot.orientation) * dirLen;
      const dy = -Math.sin(robot.orientation) * dirLen;
      const tipX = rx + dx;
      const tipY = ry + dy;

      // Arrow shaft
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(tipX, tipY);
      ctx.strokeStyle = color === BLUE_COLOR ? "#93c5fd" : "#fcd34d";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Bright arrow tip dot
      ctx.beginPath();
      ctx.arc(tipX, tipY, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      // Robot ID with dark outline for readability
      const fontSize = Math.max(r * 0.85, 9);
      ctx.font = `bold ${fontSize}px "Inter", system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Dark outline
      ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(String(robot.id), rx, ry);
      // White fill
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(robot.id), rx, ry);
    };

    // Draw command paths before robots
    if (fieldState.robot_commands.length > 0) {
      const robotIndex = new Map<number, { robot: RobotState; color: string }>();
      for (const robot of fieldState.robots_blue) {
        robotIndex.set(robot.id, { robot, color: BLUE_COLOR });
      }
      for (const robot of fieldState.robots_yellow) {
        robotIndex.set(robot.id, { robot, color: YELLOW_COLOR });
      }

      for (const cmd of fieldState.robot_commands) {
        if (cmd.pos_x === undefined || cmd.pos_y === undefined) continue;
        const entry = robotIndex.get(cmd.id);
        if (!entry) continue;

        const [sx, sy] = toCanvas(entry.robot.x, entry.robot.y);
        const [tx, ty] = toCanvas(cmd.pos_x, cmd.pos_y);

        ctx.save();
        ctx.strokeStyle = entry.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.beginPath();
        ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    for (const robot of fieldState.robots_blue) {
      const isMyTeam = myTeam === "blue";
      const isSelected = isMyTeam && selectedSet.has(robot.id);
      drawRobot(robot, BLUE_COLOR, isMyTeam, isSelected);
    }
    for (const robot of fieldState.robots_yellow) {
      const isMyTeam = myTeam === "yellow";
      const isSelected = isMyTeam && selectedSet.has(robot.id);
      drawRobot(robot, YELLOW_COLOR, isMyTeam, isSelected);
    }

    // Draw balls with warm glow
    for (const ball of fieldState.balls) {
      const [bx, by] = toCanvas(ball.x, ball.y);
      const r = Math.max(BALL_RADIUS_MM * scale, 5);

      // Outer glow
      const glowGrad = ctx.createRadialGradient(bx, by, r * 0.5, bx, by, r * 4);
      glowGrad.addColorStop(0, BALL_GLOW);
      glowGrad.addColorStop(1, "rgba(255, 140, 0, 0)");
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(bx, by, r * 4, 0, Math.PI * 2);
      ctx.fill();

      // Ball body with radial gradient
      const ballGrad = ctx.createRadialGradient(
        bx - r * 0.3,
        by - r * 0.3,
        0,
        bx,
        by,
        r
      );
      ballGrad.addColorStop(0, "#ffb347");
      ballGrad.addColorStop(0.7, BALL_COLOR);
      ballGrad.addColorStop(1, "#cc6600");
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = ballGrad;
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Field dimensions label
    ctx.fillStyle = "rgba(71, 85, 105, 0.7)";
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${fieldLength / 1000}m \u00d7 ${fieldWidth / 1000}m`,
      PADDING,
      h - 10
    );
  }, [fieldState, myTeam, selectedRobotIds]);

  // Animation loop for selected robot pulse
  useEffect(() => {
    let running = true;
    const animate = (t: number) => {
      if (!running) return;
      timeRef.current = t / 1000;
      draw();
      animFrameRef.current = requestAnimationFrame(animate);
    };
    // Only animate if there is a selected robot, otherwise draw once
    if (selectedRobotIds.length > 0) {
      animFrameRef.current = requestAnimationFrame(animate);
    } else {
      draw();
    }
    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [draw, selectedRobotIds]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const t = transformRef.current;
      if (!canvas || !t || !fieldState) return;

      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const fieldX = (cx - t.offsetX) / t.scale;
      const fieldY = -(cy - t.offsetY) / t.scale;

      const myRobots =
        myTeam === "blue" ? fieldState.robots_blue : fieldState.robots_yellow;
      const hitRadius = Math.max(ROBOT_RADIUS_MM * t.scale, 12);

      for (const robot of myRobots) {
        const [rx, ry] = [
          t.offsetX + robot.x * t.scale,
          t.offsetY - robot.y * t.scale,
        ];
        const dist = Math.sqrt((cx - rx) ** 2 + (cy - ry) ** 2);
        if (dist <= hitRadius) {
          onRobotSelect(robot.id);
          return;
        }
      }

      if (onFieldClick) {
        onFieldClick(Math.round(fieldX), Math.round(fieldY));
      }
    },
    [fieldState, myTeam, onRobotSelect, onFieldClick]
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative cursor-crosshair"
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="absolute inset-0"
      />
    </div>
  );
}
