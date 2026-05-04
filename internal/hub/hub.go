package hub

import (
	"log"
	"sync"
	"time"

	pb "github.com/technulgy-lgnu/crashpilot-interface/gen/proto"
)

// FieldState is the normalized JSON representation sent to websocket clients.
type FieldState struct {
	Source        string             `json:"source"`
	Geometry      *GeometryJSON      `json:"geometry,omitempty"`
	Balls         []BallJSON         `json:"balls"`
	RobotsBlue    []RobotJSON        `json:"robots_blue"`
	RobotsYellow  []RobotJSON        `json:"robots_yellow"`
	RobotCommands []RobotCommandJSON `json:"robot_commands"`
	Stats         DebugStats         `json:"stats"`
}

type GeometryJSON struct {
	FieldLength   float64    `json:"field_length"`
	FieldWidth    float64    `json:"field_width"`
	GoalWidth     float64    `json:"goal_width"`
	GoalDepth     float64    `json:"goal_depth"`
	BoundaryWidth float64    `json:"boundary_width"`
	Lines         []LineJSON `json:"lines"`
	Arcs          []ArcJSON  `json:"arcs"`
}

type LineJSON struct {
	Name      string  `json:"name"`
	P1X       float64 `json:"p1x"`
	P1Y       float64 `json:"p1y"`
	P2X       float64 `json:"p2x"`
	P2Y       float64 `json:"p2y"`
	Thickness float64 `json:"thickness"`
}

type ArcJSON struct {
	Name      string  `json:"name"`
	CenterX   float64 `json:"center_x"`
	CenterY   float64 `json:"center_y"`
	Radius    float64 `json:"radius"`
	A1        float64 `json:"a1"`
	A2        float64 `json:"a2"`
	Thickness float64 `json:"thickness"`
}

type BallJSON struct {
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Z          float64 `json:"z"`
	Confidence float64 `json:"confidence"`
}

type RobotJSON struct {
	Id          uint32  `json:"id"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	Orientation float64 `json:"orientation"`
	Confidence  float64 `json:"confidence"`
}

type RobotCommandJSON struct {
	Id          uint32   `json:"id"`
	State       uint32   `json:"state"`
	Task        uint32   `json:"task"`
	PosX        *float64 `json:"pos_x,omitempty"`
	PosY        *float64 `json:"pos_y,omitempty"`
	Orientation *float64 `json:"orientation,omitempty"`
	KickOrient  *float64 `json:"kick_orient,omitempty"`
	Speed       *uint32  `json:"speed,omitempty"`
	KickSpeed   *uint32  `json:"kick_speed,omitempty"`
}

type DebugStats struct {
	VisionPackets     uint64  `json:"vision_packets"`
	TrackedPackets    uint64  `json:"tracked_packets"`
	PacketsPerSec     float64 `json:"packets_per_sec"`
	LastPacketTime    int64   `json:"last_packet_time"`
	ProcessingDelayMs float64 `json:"processing_delay_ms"`
	ActiveSource      string  `json:"active_source"`
	VisionConnected   bool    `json:"vision_connected"`
	TrackedConnected  bool    `json:"tracked_connected"`
}

// Hub is the central state manager.
type Hub struct {
	mu sync.RWMutex

	activeSource string // "vision" or "tracked"

	// Latest geometry from vision
	geometry *GeometryJSON

	// Vision detection state
	visionBalls        []BallJSON
	visionRobotsBlue   []RobotJSON
	visionRobotsYellow []RobotJSON

	// Tracked detection state
	trackedBalls        []BallJSON
	trackedRobotsBlue   []RobotJSON
	trackedRobotsYellow []RobotJSON

	// Robot command targets
	robotCommands []RobotCommandJSON

	// Stats
	visionPackets    uint64
	trackedPackets   uint64
	lastPacketTime   time.Time
	visionConnected  bool
	trackedConnected bool

	// Rate tracking
	packetTimes []time.Time

	// Processing delay tracking
	lastProcessingDelay time.Duration

	// Subscribers
	subMu       sync.RWMutex
	subscribers map[chan *FieldState]struct{}

	// Notify channel for broadcast loop
	notify chan struct{}

	// Done channel for shutdown
	done chan struct{}
}

// New creates a new Hub with the given default source.
func New(defaultSource string) *Hub {
	if defaultSource != "vision" && defaultSource != "tracked" {
		defaultSource = "vision"
	}
	h := &Hub{
		activeSource: defaultSource,
		subscribers:  make(map[chan *FieldState]struct{}),
		notify:       make(chan struct{}, 1),
		done:         make(chan struct{}),
	}
	go h.broadcastLoop()
	return h
}

// Stop shuts down the hub broadcast loop.
func (h *Hub) Stop() {
	close(h.done)
}

// Subscribe returns a channel that receives FieldState updates.
func (h *Hub) Subscribe() chan *FieldState {
	ch := make(chan *FieldState, 8)
	h.subMu.Lock()
	h.subscribers[ch] = struct{}{}
	h.subMu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber channel.
func (h *Hub) Unsubscribe(ch chan *FieldState) {
	h.subMu.Lock()
	delete(h.subscribers, ch)
	h.subMu.Unlock()
	close(ch)
}

// SetSource switches the active source ("vision" or "tracked").
func (h *Hub) SetSource(source string) {
	if source != "vision" && source != "tracked" {
		return
	}
	h.mu.Lock()
	h.activeSource = source
	h.mu.Unlock()
	h.triggerBroadcast()
}

// GetSource returns the current active source.
func (h *Hub) GetSource() string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.activeSource
}

// UpdateVision processes an SSL_WrapperPacket from the vision receiver.
func (h *Hub) UpdateVision(wrapper *pb.SSL_WrapperPacket) {
	start := time.Now()
	h.mu.Lock()

	h.visionPackets++
	h.lastPacketTime = start
	h.visionConnected = true
	h.recordPacketTime(start)

	if det := wrapper.GetDetection(); det != nil {
		h.visionBalls = convertDetectionBalls(det.GetBalls())
		h.visionRobotsBlue = convertDetectionRobots(det.GetRobotsBlue())
		h.visionRobotsYellow = convertDetectionRobots(det.GetRobotsYellow())
	}

	if geo := wrapper.GetGeometry(); geo != nil {
		if field := geo.GetField(); field != nil {
			h.geometry = convertGeometry(field)
		}
	}

	h.lastProcessingDelay = time.Since(start)
	h.mu.Unlock()

	h.triggerBroadcast()
}

// UpdateTracked processes a TrackerWrapperPacket from the tracked receiver.
func (h *Hub) UpdateTracked(wrapper *pb.TrackerWrapperPacket) {
	start := time.Now()
	h.mu.Lock()

	h.trackedPackets++
	h.lastPacketTime = start
	h.trackedConnected = true
	h.recordPacketTime(start)

	if frame := wrapper.GetTrackedFrame(); frame != nil {
		h.trackedBalls = convertTrackedBalls(frame.GetBalls())
		blue, yellow := convertTrackedRobots(frame.GetRobots())
		h.trackedRobotsBlue = blue
		h.trackedRobotsYellow = yellow
	}

	h.lastProcessingDelay = time.Since(start)
	h.mu.Unlock()

	h.triggerBroadcast()
}

// UpdateRobotCommands stores the latest robot command targets from Crashpilot.
func (h *Hub) UpdateRobotCommands(commands []*pb.CP_Robot) {
	h.mu.Lock()
	if len(commands) == 0 {
		h.robotCommands = nil
		h.mu.Unlock()
		return
	}

	cmds := make([]RobotCommandJSON, 0, len(commands))
	for _, r := range commands {
		if r == nil {
			continue
		}
		cmd := r.GetCmd()
		if cmd == nil {
			continue
		}

		entry := RobotCommandJSON{
			Id:    r.GetRobotId(),
			State: uint32(cmd.GetState()),
			Task:  uint32(cmd.GetTask()),
		}

		if pos := cmd.GetPos(); pos != nil {
			x := float64(pos.GetX())
			y := float64(pos.GetY())
			entry.PosX = &x
			entry.PosY = &y
		}
		if cmd.Orientation != nil {
			v := float64(cmd.GetOrientation())
			entry.Orientation = &v
		}
		if cmd.KickOrient != nil {
			v := float64(cmd.GetKickOrient())
			entry.KickOrient = &v
		}
		if cmd.Speed != nil {
			v := cmd.GetSpeed()
			entry.Speed = &v
		}
		if cmd.KickSpeed != nil {
			v := cmd.GetKickSpeed()
			entry.KickSpeed = &v
		}

		cmds = append(cmds, entry)
	}

	h.robotCommands = cmds
	h.mu.Unlock()

	h.triggerBroadcast()
}

func (h *Hub) triggerBroadcast() {
	select {
	case h.notify <- struct{}{}:
	default:
	}
}

func (h *Hub) recordPacketTime(t time.Time) {
	cutoff := t.Add(-1 * time.Second)
	// Trim old entries
	start := 0
	for start < len(h.packetTimes) && h.packetTimes[start].Before(cutoff) {
		start++
	}
	h.packetTimes = append(h.packetTimes[start:], t)
}

func (h *Hub) buildState() *FieldState {
	h.mu.RLock()
	defer h.mu.RUnlock()

	state := &FieldState{
		Source:        h.activeSource,
		Geometry:      h.geometry,
		RobotCommands: h.robotCommands,
	}

	if h.activeSource == "tracked" {
		state.Balls = h.trackedBalls
		state.RobotsBlue = h.trackedRobotsBlue
		state.RobotsYellow = h.trackedRobotsYellow
	} else {
		state.Balls = h.visionBalls
		state.RobotsBlue = h.visionRobotsBlue
		state.RobotsYellow = h.visionRobotsYellow
	}

	// Ensure non-nil slices for JSON
	if state.Balls == nil {
		state.Balls = []BallJSON{}
	}
	if state.RobotsBlue == nil {
		state.RobotsBlue = []RobotJSON{}
	}
	if state.RobotsYellow == nil {
		state.RobotsYellow = []RobotJSON{}
	}
	if state.RobotCommands == nil {
		state.RobotCommands = []RobotCommandJSON{}
	}

	var pps float64
	if len(h.packetTimes) > 1 {
		pps = float64(len(h.packetTimes))
	}

	var lastPkt int64
	if !h.lastPacketTime.IsZero() {
		lastPkt = h.lastPacketTime.UnixMilli()
	}

	state.Stats = DebugStats{
		VisionPackets:     h.visionPackets,
		TrackedPackets:    h.trackedPackets,
		PacketsPerSec:     pps,
		LastPacketTime:    lastPkt,
		ProcessingDelayMs: float64(h.lastProcessingDelay.Microseconds()) / 1000.0,
		ActiveSource:      h.activeSource,
		VisionConnected:   h.visionConnected,
		TrackedConnected:  h.trackedConnected,
	}

	return state
}

// broadcastLoop runs at up to ~60Hz, sending state to all subscribers.
func (h *Hub) broadcastLoop() {
	ticker := time.NewTicker(time.Second / 60)
	defer ticker.Stop()

	for {
		select {
		case <-h.done:
			return
		case <-h.notify:
			// Drain additional notifications
			select {
			case <-h.notify:
			default:
			}
		case <-ticker.C:
		}

		state := h.buildState()

		h.subMu.RLock()
		for ch := range h.subscribers {
			select {
			case ch <- state:
			default:
				// Skip slow consumers
				log.Println("hub: dropping frame for slow subscriber")
			}
		}
		h.subMu.RUnlock()
	}
}

// --- Conversion helpers ---

func convertDetectionBalls(balls []*pb.SSL_DetectionBall) []BallJSON {
	if len(balls) == 0 {
		return nil
	}
	result := make([]BallJSON, 0, len(balls))
	for _, b := range balls {
		if b == nil {
			continue
		}
		result = append(result, BallJSON{
			X:          float64(b.GetX()),
			Y:          float64(b.GetY()),
			Z:          float64(b.GetZ()),
			Confidence: float64(b.GetConfidence()),
		})
	}
	return result
}

func convertDetectionRobots(robots []*pb.SSL_DetectionRobot) []RobotJSON {
	if len(robots) == 0 {
		return nil
	}
	result := make([]RobotJSON, 0, len(robots))
	for _, r := range robots {
		if r == nil {
			continue
		}
		result = append(result, RobotJSON{
			Id:          r.GetRobotId(),
			X:           float64(r.GetX()),
			Y:           float64(r.GetY()),
			Orientation: float64(r.GetOrientation()),
			Confidence:  float64(r.GetConfidence()),
		})
	}
	return result
}

func convertTrackedBalls(balls []*pb.TrackedBall) []BallJSON {
	if len(balls) == 0 {
		return nil
	}
	result := make([]BallJSON, 0, len(balls))
	for _, b := range balls {
		if b == nil || b.GetPos() == nil {
			continue
		}
		pos := b.GetPos()
		// Tracked positions are in meters, convert to mm
		result = append(result, BallJSON{
			X:          float64(pos.GetX()) * 1000.0,
			Y:          float64(pos.GetY()) * 1000.0,
			Z:          float64(pos.GetZ()) * 1000.0,
			Confidence: float64(b.GetVisibility()),
		})
	}
	return result
}

func convertTrackedRobots(robots []*pb.TrackedRobot) (blue []RobotJSON, yellow []RobotJSON) {
	for _, r := range robots {
		if r == nil || r.GetPos() == nil {
			continue
		}
		rid := r.GetRobotId()
		if rid == nil {
			continue
		}

		rj := RobotJSON{
			Id:          rid.GetId(),
			X:           float64(r.GetPos().GetX()) * 1000.0, // meters to mm
			Y:           float64(r.GetPos().GetY()) * 1000.0,
			Orientation: float64(r.GetOrientation()),
			Confidence:  float64(r.GetVisibility()),
		}

		switch rid.GetTeam() {
		case pb.Team_BLUE:
			blue = append(blue, rj)
		case pb.Team_YELLOW:
			yellow = append(yellow, rj)
		}
	}
	return
}

func convertGeometry(field *pb.SSL_GeometryFieldSize) *GeometryJSON {
	geo := &GeometryJSON{
		FieldLength:   float64(field.GetFieldLength()),
		FieldWidth:    float64(field.GetFieldWidth()),
		GoalWidth:     float64(field.GetGoalWidth()),
		GoalDepth:     float64(field.GetGoalDepth()),
		BoundaryWidth: float64(field.GetBoundaryWidth()),
	}

	for _, line := range field.GetFieldLines() {
		if line == nil {
			continue
		}
		lj := LineJSON{
			Name:      line.GetName(),
			Thickness: float64(line.GetThickness()),
		}
		if p1 := line.GetP1(); p1 != nil {
			lj.P1X = float64(p1.GetX())
			lj.P1Y = float64(p1.GetY())
		}
		if p2 := line.GetP2(); p2 != nil {
			lj.P2X = float64(p2.GetX())
			lj.P2Y = float64(p2.GetY())
		}
		geo.Lines = append(geo.Lines, lj)
	}

	for _, arc := range field.GetFieldArcs() {
		if arc == nil {
			continue
		}
		aj := ArcJSON{
			Name:      arc.GetName(),
			Radius:    float64(arc.GetRadius()),
			A1:        float64(arc.GetA1()),
			A2:        float64(arc.GetA2()),
			Thickness: float64(arc.GetThickness()),
		}
		if c := arc.GetCenter(); c != nil {
			aj.CenterX = float64(c.GetX())
			aj.CenterY = float64(c.GetY())
		}
		geo.Arcs = append(geo.Arcs, aj)
	}

	// Ensure non-nil slices
	if geo.Lines == nil {
		geo.Lines = []LineJSON{}
	}
	if geo.Arcs == nil {
		geo.Arcs = []ArcJSON{}
	}

	return geo
}
