package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math"
	"mime"
	"net/http"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	webassets "github.com/technulgy-lgnu/crashpilot-interface"
	"github.com/technulgy-lgnu/crashpilot-interface/gen/proto"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/config"
	"google.golang.org/protobuf/proto"
)

type Service struct {
	cfg             config.Config
	staticFS        fs.FS
	mu              sync.RWMutex
	snapshot        Snapshot
	clients         map[*uiClient]struct{}
	controllerConn  *websocket.Conn
	controllerWrite sync.Mutex
	upgrader        websocket.Upgrader
}

type uiClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func New(cfg config.Config) (*Service, error) {
	distFS, err := fs.Sub(webassets.Dist, "frontend/dist")
	if err != nil {
		return nil, fmt.Errorf("open embedded frontend: %w", err)
	}

	startedAt := time.Now().UTC()
	field := fieldFromConfig(cfg.Field)
	service := &Service{
		cfg:      cfg,
		staticFS: distFS,
		clients:  make(map[*uiClient]struct{}),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		},
		snapshot: Snapshot{
			UpdatedAt:     startedAt,
			Controller:    ControllerStatus{URL: cfg.CrashPilot.WSURL, ReconnectDelayMS: cfg.CrashPilot.ReconnectDelayMS},
			Field:         field,
			Vision:        VisionState{Source: "waiting", SourceLabel: "Waiting for controller data", Balls: []Ball{}, Robots: []Robot{}},
			RobotCommands: []RobotCommand{},
			InterfaceOptions: InterfaceOptions{
				Mode: cfg.InterfaceDefaults.Mode,
				Manual: ManualOptions{
					EnableTestfield: cfg.InterfaceDefaults.Manual.EnableTestfield,
					Testfield:       cfg.InterfaceDefaults.Manual.Testfield,
					BallTracked:     cfg.InterfaceDefaults.Manual.BallTracked,
					GCData:          cfg.InterfaceDefaults.Manual.GCData,
				},
				Game: GameOptions{
					Running:      cfg.InterfaceDefaults.Game.Running,
					Side:         cfg.InterfaceDefaults.Game.Side,
					TeamColor:    cfg.InterfaceDefaults.Game.TeamColor,
					GoalkeeperID: cfg.InterfaceDefaults.Game.Goalkeeper,
					MaxSpeed:     cfg.InterfaceDefaults.Game.MaxSpeed,
				},
				Test: TestOptions{
					Test:     cfg.InterfaceDefaults.Test.Test,
					RobotIDs: append([]uint32{}, cfg.InterfaceDefaults.Test.RobotIDs...),
				},
			},
			KnownRobotIDs: []uint32{},
			Debug:         DebugState{StartedAt: startedAt, LastEvent: "server started"},
		},
	}

	return service, nil
}

func (s *Service) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ws", s.handleBrowserWS)
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/", s.handleStatic)
	return mux
}

func (s *Service) RunController(ctx context.Context) {
	dialer := websocket.Dialer{
		HandshakeTimeout: time.Duration(s.cfg.CrashPilot.HandshakeTimeoutMS) * time.Millisecond,
	}
	retryDelay := time.Duration(s.cfg.CrashPilot.ReconnectDelayMS) * time.Millisecond

	for {
		select {
		case <-ctx.Done():
			s.disconnectController("controller loop stopped")
			return
		default:
		}

		conn, _, err := dialer.DialContext(ctx, s.cfg.CrashPilot.WSURL, nil)
		if err != nil {
			s.recordControllerError(fmt.Sprintf("connect failed: %v", err))
			if !sleepWithContext(ctx, retryDelay) {
				return
			}
			continue
		}

		s.attachController(conn)
		readErr := s.readControllerMessages(ctx, conn)
		if readErr != nil && !errors.Is(readErr, context.Canceled) && !websocket.IsCloseError(readErr, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
			log.Printf("controller websocket error: %v", readErr)
			s.recordControllerError(readErr.Error())
		}
		s.detachController(conn)

		if !sleepWithContext(ctx, retryDelay) {
			return
		}
	}
}

func (s *Service) handleHealth(w http.ResponseWriter, _ *http.Request) {
	payload, err := s.snapshotPayload()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(payload)
}

func (s *Service) handleBrowserWS(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade browser websocket: %v", err)
		return
	}

	client := &uiClient{conn: conn}
	s.addClient(client)
	defer s.removeClient(client)

	if payload, err := s.snapshotPayload(); err == nil {
		if err := client.write(websocket.TextMessage, payload); err != nil {
			return
		}
	}

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.TextMessage {
			s.sendClientError(client, "browser protocol only accepts JSON text messages")
			continue
		}

		var msg clientMessage
		if err := json.Unmarshal(payload, &msg); err != nil {
			s.sendClientError(client, "invalid JSON payload")
			continue
		}

		if err := s.handleClientMessage(msg); err != nil {
			s.sendClientError(client, err.Error())
			continue
		}
	}
}

func (s *Service) handleStatic(w http.ResponseWriter, r *http.Request) {
	requested := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if requested == "." || requested == "/" || requested == "" {
		requested = "index.html"
	}
	if strings.HasPrefix(requested, "../") || requested == ".." {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	payload, err := fs.ReadFile(s.staticFS, requested)
	if err != nil {
		payload, err = fs.ReadFile(s.staticFS, "index.html")
		if err != nil {
			http.Error(w, "frontend bundle not available", http.StatusInternalServerError)
			return
		}
		requested = "index.html"
	}

	if contentType := mime.TypeByExtension(path.Ext(requested)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	http.ServeContent(w, r, requested, time.Time{}, bytes.NewReader(payload))
}

func (s *Service) handleClientMessage(msg clientMessage) error {
	s.mu.Lock()
	s.snapshot.Debug.BrowserMessages++
	s.mu.Unlock()

	switch msg.Type {
	case "set_options":
		if msg.Options == nil {
			return fmt.Errorf("options payload is required")
		}
		s.setInterfaceOptions(*msg.Options)
		if err := s.sendInterfaceMessage(nil); err != nil {
			return err
		}
		return nil
	case "send_command":
		if msg.Command == nil {
			return fmt.Errorf("command payload is required")
		}
		if len(msg.RobotIDs) == 0 {
			return fmt.Errorf("at least one robot id is required")
		}
		robotCommands, summary, err := buildRobotCommands(msg.RobotIDs, *msg.Command)
		if err != nil {
			return err
		}
		s.mu.Lock()
		s.snapshot.Debug.LastCommand = summary
		s.snapshot.Debug.LastEvent = "command prepared for controller"
		s.snapshot.UpdatedAt = time.Now().UTC()
		s.mu.Unlock()
		if err := s.sendInterfaceMessage(robotCommands); err != nil {
			return err
		}
		return nil
	default:
		return fmt.Errorf("unsupported message type %q", msg.Type)
	}
}

func (s *Service) sendInterfaceMessage(commands []*crashpilot_interface.InterfaceRobotCommands_CP) error {
	s.mu.RLock()
	options := s.snapshot.InterfaceOptions
	conn := s.controllerConn
	writeTimeout := time.Duration(s.cfg.CrashPilot.WriteTimeoutMS) * time.Millisecond
	s.mu.RUnlock()

	if conn == nil {
		s.recordControllerError("cannot send command: controller websocket is disconnected")
		return fmt.Errorf("controller websocket is disconnected")
	}

	payload, err := proto.Marshal(&crashpilot_interface.InterfaceWrapper_CP{
		RobotCommands: commands,
		InterfaceCommand: &crashpilot_interface.InterfaceCommand_CP{
			Mode: cpModePtr(options.Mode),
			Manual: &crashpilot_interface.InterfaceManual_CP{
				EnableTestfield: boolPtr(options.Manual.EnableTestfield),
				Testfield:       uint32Ptr(options.Manual.Testfield),
				BallTracked:     boolPtr(options.Manual.BallTracked),
				GcData:          boolPtr(options.Manual.GCData),
			},
			Game: &crashpilot_interface.InterfaceGame_CP{
				Running:      boolPtr(options.Game.Running),
				Side:         boolPtr(options.Game.Side),
				TeamColor:    boolPtr(options.Game.TeamColor),
				GoalkeeperId: uint32Ptr(options.Game.GoalkeeperID),
				MaxSpeed:     uint32Ptr(options.Game.MaxSpeed),
			},
			Test: &crashpilot_interface.InterfaceTest_CP{
				Test:     cpTestPtr(options.Test.Test),
				RobotIds: append([]uint32(nil), options.Test.RobotIDs...),
			},
		},
	})
	if err != nil {
		return fmt.Errorf("encode controller payload: %w", err)
	}

	s.controllerWrite.Lock()
	defer s.controllerWrite.Unlock()

	if err := conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
		return fmt.Errorf("set controller write deadline: %w", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, payload); err != nil {
		s.recordControllerError(fmt.Sprintf("controller send failed: %v", err))
		return fmt.Errorf("send to controller: %w", err)
	}

	now := time.Now().UTC()
	s.mu.Lock()
	s.snapshot.Debug.PacketsSent++
	s.snapshot.Debug.LastOutboundBytes = len(payload)
	s.snapshot.Debug.LastOutboundAt = &now
	s.snapshot.Debug.LastEvent = "command sent to controller"
	s.snapshot.UpdatedAt = now
	s.mu.Unlock()

	s.broadcastSnapshot()
	return nil
}

func (s *Service) setInterfaceOptions(options InterfaceOptions) {
	now := time.Now().UTC()
	s.mu.Lock()
	s.snapshot.InterfaceOptions = options
	s.snapshot.Debug.LastEvent = "interface options updated"
	s.snapshot.UpdatedAt = now
	s.mu.Unlock()
	s.broadcastSnapshot()
}

func (s *Service) readControllerMessages(ctx context.Context, conn *websocket.Conn) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		if messageType != websocket.BinaryMessage {
			continue
		}

		var wrapper crashpilot_interface.CP_InterfaceWrapper
		if err := proto.Unmarshal(payload, &wrapper); err != nil {
			s.recordControllerError(fmt.Sprintf("decode protobuf failed: %v", err))
			continue
		}

		s.applyControllerSnapshot(&wrapper, len(payload))
	}
}

func (s *Service) applyControllerSnapshot(wrapper *crashpilot_interface.CP_InterfaceWrapper, payloadSize int) {
	now := time.Now().UTC()

	s.mu.Lock()
	defer s.mu.Unlock()

	s.snapshot.Controller.Connected = true
	s.snapshot.Controller.LastMessageAt = &now
	s.snapshot.Debug.PacketsReceived++
	s.snapshot.Debug.LastInboundBytes = payloadSize
	s.snapshot.Debug.LastInboundAt = &now
	s.snapshot.Debug.LastError = ""
	s.snapshot.Controller.LastError = ""

	geometryUpdated := false
	if raw := wrapper.GetVisionRaw(); raw != nil {
		s.snapshot.Debug.RawFrames++
		if geometry := raw.GetGeometry(); geometry != nil {
			s.snapshot.Field = mergeFieldGeometry(s.snapshot.Field, mapFieldGeometry(geometry))
			geometryUpdated = true
		}
		if detection := raw.GetDetection(); detection != nil {
			s.snapshot.Vision = mapRawVision(raw, s.snapshot.Field, geometryUpdated)
			s.snapshot.Debug.LastEvent = "received raw vision frame"
		}
	}

	if tracked := wrapper.GetVisionTracked(); tracked != nil && tracked.GetTrackedFrame() != nil {
		s.snapshot.Debug.TrackedFrames++
		s.snapshot.Vision = mapTrackedVision(tracked, s.snapshot.Field)
		s.snapshot.Debug.LastEvent = "received tracked vision frame"
	}

	if gc := wrapper.GetGcData(); gc != nil {
		state := mapReferee(gc)
		s.snapshot.Referee = &state
		if s.snapshot.Debug.LastEvent == "" {
			s.snapshot.Debug.LastEvent = "received referee update"
		}
	}

	if commands := wrapper.GetRobotCommands(); len(commands) > 0 {
		s.snapshot.Debug.CommandFrames++
		s.snapshot.RobotCommands = mapRobotCommands(commands, now)
		s.snapshot.Debug.LastEvent = fmt.Sprintf("received %d crashpilot robot commands", len(commands))
	}

	s.snapshot.KnownRobotIDs = collectKnownRobotIDs(s.snapshot.Vision.Robots, s.snapshot.RobotCommands)
	s.snapshot.UpdatedAt = now
	s.snapshot.Debug.Clients = len(s.clients)

	go s.broadcastSnapshot()
}

func (s *Service) snapshotPayload() ([]byte, error) {
	s.mu.RLock()
	message := serverMessage{Type: "snapshot", Snapshot: &s.snapshot}
	payload, err := json.Marshal(message)
	s.mu.RUnlock()
	if err != nil {
		return nil, fmt.Errorf("marshal snapshot: %w", err)
	}
	return payload, nil
}

func (s *Service) broadcastSnapshot() {
	payload, err := s.snapshotPayload()
	if err != nil {
		log.Printf("broadcast snapshot: %v", err)
		return
	}

	clients := s.clientList()
	dead := make([]*uiClient, 0)
	for _, client := range clients {
		if err := client.write(websocket.TextMessage, payload); err != nil {
			dead = append(dead, client)
		}
	}

	s.mu.Lock()
	for _, client := range dead {
		delete(s.clients, client)
	}
	s.snapshot.Debug.Clients = len(s.clients)
	s.snapshot.Debug.Broadcasts++
	s.mu.Unlock()

	for _, client := range dead {
		client.close()
	}
}

func (s *Service) clientList() []*uiClient {
	s.mu.RLock()
	defer s.mu.RUnlock()
	clients := make([]*uiClient, 0, len(s.clients))
	for client := range s.clients {
		clients = append(clients, client)
	}
	return clients
}

func (s *Service) addClient(client *uiClient) {
	s.mu.Lock()
	s.clients[client] = struct{}{}
	s.snapshot.Debug.Clients = len(s.clients)
	s.snapshot.Debug.LastEvent = "browser connected"
	s.snapshot.UpdatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.broadcastSnapshot()
}

func (s *Service) removeClient(client *uiClient) {
	client.close()
	s.mu.Lock()
	delete(s.clients, client)
	s.snapshot.Debug.Clients = len(s.clients)
	s.snapshot.Debug.LastEvent = "browser disconnected"
	s.snapshot.UpdatedAt = time.Now().UTC()
	s.mu.Unlock()
	s.broadcastSnapshot()
}

func (s *Service) sendClientError(client *uiClient, message string) {
	s.mu.Lock()
	s.snapshot.Debug.LastError = message
	s.snapshot.Debug.LastEvent = "browser command failed"
	s.snapshot.UpdatedAt = time.Now().UTC()
	s.mu.Unlock()
	_ = client.writeJSON(serverMessage{Type: "error", Error: message})
	s.broadcastSnapshot()
}

func (s *Service) attachController(conn *websocket.Conn) {
	now := time.Now().UTC()
	s.mu.Lock()
	s.controllerConn = conn
	s.snapshot.Controller.Connected = true
	s.snapshot.Controller.LastConnectedAt = &now
	s.snapshot.Controller.LastError = ""
	s.snapshot.Debug.LastError = ""
	s.snapshot.Debug.LastEvent = "controller connected"
	s.snapshot.UpdatedAt = now
	s.mu.Unlock()
	s.broadcastSnapshot()
}

func (s *Service) detachController(conn *websocket.Conn) {
	s.mu.Lock()
	if s.controllerConn == conn {
		s.controllerConn = nil
		s.snapshot.Controller.Connected = false
		s.snapshot.Debug.LastEvent = "controller disconnected"
		s.snapshot.UpdatedAt = time.Now().UTC()
	}
	s.mu.Unlock()
	_ = conn.Close()
	s.broadcastSnapshot()
}

func (s *Service) disconnectController(event string) {
	s.mu.Lock()
	conn := s.controllerConn
	s.controllerConn = nil
	s.snapshot.Controller.Connected = false
	s.snapshot.Debug.LastEvent = event
	s.snapshot.UpdatedAt = time.Now().UTC()
	s.mu.Unlock()
	if conn != nil {
		_ = conn.Close()
	}
	s.broadcastSnapshot()
}

func (s *Service) recordControllerError(message string) {
	now := time.Now().UTC()
	s.mu.Lock()
	s.snapshot.Controller.Connected = false
	s.snapshot.Controller.LastError = message
	s.snapshot.Debug.LastError = message
	s.snapshot.Debug.LastEvent = "controller error"
	s.snapshot.UpdatedAt = now
	s.mu.Unlock()
	s.broadcastSnapshot()
}

func mapRawVision(raw *crashpilot_interface.SSL_WrapperPacket, field FieldGeometry, hasGeometry bool) VisionState {
	detection := raw.GetDetection()
	robots := make([]Robot, 0, len(detection.GetRobotsBlue())+len(detection.GetRobotsYellow()))
	for _, robot := range detection.GetRobotsBlue() {
		robots = append(robots, Robot{
			ID:          robot.GetRobotId(),
			Team:        "blue",
			X:           float64(robot.GetX()),
			Y:           float64(robot.GetY()),
			Orientation: float64(robot.GetOrientation()),
			Confidence:  float64(robot.GetConfidence()),
			Source:      "vision_raw",
		})
	}
	for _, robot := range detection.GetRobotsYellow() {
		robots = append(robots, Robot{
			ID:          robot.GetRobotId(),
			Team:        "yellow",
			X:           float64(robot.GetX()),
			Y:           float64(robot.GetY()),
			Orientation: float64(robot.GetOrientation()),
			Confidence:  float64(robot.GetConfidence()),
			Source:      "vision_raw",
		})
	}

	balls := make([]Ball, 0, len(detection.GetBalls()))
	for _, ball := range detection.GetBalls() {
		balls = append(balls, Ball{X: float64(ball.GetX()), Y: float64(ball.GetY()), Z: float64(ball.GetZ()), Source: "vision_raw", Visibility: float64(ball.GetConfidence())})
	}

	now := time.Now().UTC()
	return VisionState{
		Source:      "vision_raw",
		SourceLabel: raw.GetSource().String(),
		FrameNumber: detection.GetFrameNumber(),
		Timestamp:   detection.GetTSent(),
		Balls:       balls,
		Robots:      robots,
		HasGeometry: hasGeometry || field.LengthMM > 0,
		UpdatedAt:   &now,
	}
}

func mapTrackedVision(tracked *crashpilot_interface.TrackerWrapperPacket, field FieldGeometry) VisionState {
	frame := tracked.GetTrackedFrame()
	robots := make([]Robot, 0, len(frame.GetRobots()))
	for _, robot := range frame.GetRobots() {
		team := trackedTeamLabel(robot.GetRobotId())
		robotID := uint32(0)
		idKnown := robot.GetRobotId() != nil
		if idKnown {
			robotID = robot.GetRobotId().GetId()
		}
		vx, vy := 0.0, 0.0
		if robot.GetVel() != nil {
			vx = float64(robot.GetVel().GetX()) * 1000
			vy = float64(robot.GetVel().GetY()) * 1000
		}
		robotTags := []string{}
		if !idKnown {
			robotTags = append(robotTags, "id_unknown")
		}
		robots = append(robots, Robot{
			ID:          robotID,
			Team:        team,
			X:           float64(robot.GetPos().GetX()) * 1000,
			Y:           float64(robot.GetPos().GetY()) * 1000,
			Orientation: float64(robot.GetOrientation()),
			VX:          vx,
			VY:          vy,
			Visibility:  float64(robot.GetVisibility()),
			Source:      "vision_tracked",
			Tags:        robotTags,
		})
	}

	balls := make([]Ball, 0, len(frame.GetBalls()))
	for _, ball := range frame.GetBalls() {
		vx, vy := 0.0, 0.0
		if ball.GetVel() != nil {
			vx = float64(ball.GetVel().GetX()) * 1000
			vy = float64(ball.GetVel().GetY()) * 1000
		}
		balls = append(balls, Ball{
			X:          float64(ball.GetPos().GetX()) * 1000,
			Y:          float64(ball.GetPos().GetY()) * 1000,
			Z:          float64(ball.GetPos().GetZ()) * 1000,
			VX:         vx,
			VY:         vy,
			Visibility: float64(ball.GetVisibility()),
			Source:     "vision_tracked",
		})
	}

	var kicked *KickedBall
	if frame.GetKickedBall() != nil {
		kick := frame.GetKickedBall()
		velocity := 0.0
		if kick.GetVel() != nil {
			velocity = math.Hypot(float64(kick.GetVel().GetX()), float64(kick.GetVel().GetY())) * 1000
		}
		stopX, stopY := 0.0, 0.0
		if kick.GetStopPos() != nil {
			stopX = float64(kick.GetStopPos().GetX()) * 1000
			stopY = float64(kick.GetStopPos().GetY()) * 1000
		}
		robotID := uint32(0)
		robotTeam := "unknown"
		if kick.GetRobotId() != nil {
			robotID = kick.GetRobotId().GetId()
			robotTeam = trackedTeamLabel(kick.GetRobotId())
		}
		kicked = &KickedBall{
			X:          float64(kick.GetPos().GetX()) * 1000,
			Y:          float64(kick.GetPos().GetY()) * 1000,
			StopX:      stopX,
			StopY:      stopY,
			RobotID:    robotID,
			RobotTeam:  robotTeam,
			VelocityMM: velocity,
		}
	}

	sourceLabel := tracked.GetSourceName()
	if sourceLabel == "" {
		sourceLabel = tracked.GetUuid()
	}
	now := time.Now().UTC()
	return VisionState{
		Source:      "vision_tracked",
		SourceLabel: sourceLabel,
		FrameNumber: frame.GetFrameNumber(),
		Timestamp:   frame.GetTimestamp(),
		Balls:       balls,
		Robots:      robots,
		HasGeometry: field.LengthMM > 0,
		UpdatedAt:   &now,
		KickedBall:  kicked,
	}
}

func mapRobotCommands(commands []*crashpilot_interface.CP_Robot, receivedAt time.Time) []RobotCommand {
	items := make([]RobotCommand, 0, len(commands))
	for _, command := range commands {
		self := findSelfRobot(command)
		ball := mapCPBall(command.GetBall())
		cmdView := mapCommandView(command.GetCmd())
		timestamp := ""
		ageMS := int64(0)
		if command.GetTimestamp() != nil {
			commandTime := command.GetTimestamp().AsTime().UTC()
			timestamp = commandTime.Format(time.RFC3339Nano)
			ageMS = receivedAt.Sub(commandTime).Milliseconds()
		}
		items = append(items, RobotCommand{
			RobotID:      command.GetRobotId(),
			PacketID:     command.GetPacketId(),
			Timestamp:    timestamp,
			Ball:         ball,
			Self:         self,
			Command:      cmdView,
			YellowCount:  len(command.GetRobotsYellow()),
			BlueCount:    len(command.GetRobotsBlue()),
			ReceivedAt:   receivedAt,
			CommandLabel: humanCommandLabel(cmdView),
			AgeMS:        ageMS,
			Meta: CommandMeta{
				HasTarget:      cmdView.Position != nil,
				HasKick:        cmdView.KickOrientation != nil || cmdView.KickSpeed != nil,
				HasSpeed:       cmdView.Speed != nil,
				HasOrientation: cmdView.Orientation != nil,
			},
		})
	}
	return items
}

func mapReferee(gc *crashpilot_interface.Referee) RefereeState {
	state := RefereeState{
		Stage:                  gc.GetStage().String(),
		Command:                gc.GetCommand().String(),
		NextCommand:            gc.GetNextCommand().String(),
		StatusMessage:          gc.GetStatusMessage(),
		StageTimeLeftUS:        gc.GetStageTimeLeft(),
		ActionTimeRemainingUS:  gc.GetCurrentActionTimeRemaining(),
		BlueTeamOnPositiveHalf: gc.GetBlueTeamOnPositiveHalf(),
		Blue:                   mapRefereeTeam(gc.GetBlue()),
		Yellow:                 mapRefereeTeam(gc.GetYellow()),
	}
	if gc.GetDesignatedPosition() != nil {
		state.DesignatedPosition = &Vector2{X: float64(gc.GetDesignatedPosition().GetX()), Y: float64(gc.GetDesignatedPosition().GetY())}
	}
	return state
}

func mapRefereeTeam(team *crashpilot_interface.Referee_TeamInfo) RefereeTeam {
	if team == nil {
		return RefereeTeam{YellowTimes: []uint32{}}
	}
	return RefereeTeam{
		Name:        team.GetName(),
		Score:       team.GetScore(),
		RedCards:    team.GetRedCards(),
		YellowCards: team.GetYellowCards(),
		YellowTimes: append([]uint32(nil), team.GetYellowCardTimes()...),
		Timeouts:    team.GetTimeouts(),
		Goalkeeper:  team.GetGoalkeeper(),
	}
}

func mapFieldGeometry(geometry *crashpilot_interface.SSL_GeometryData) FieldGeometry {
	field := geometry.GetField()
	if field == nil {
		return FieldGeometry{}
	}
	return FieldGeometry{
		LengthMM:           field.GetFieldLength(),
		WidthMM:            field.GetFieldWidth(),
		GoalWidthMM:        field.GetGoalWidth(),
		GoalDepthMM:        field.GetGoalDepth(),
		BoundaryWidthMM:    field.GetBoundaryWidth(),
		PenaltyAreaDepthMM: field.GetPenaltyAreaDepth(),
		PenaltyAreaWidthMM: field.GetPenaltyAreaWidth(),
		CenterCircleMM:     field.GetCenterCircleRadius(),
		LineThicknessMM:    field.GetLineThickness(),
		MaxRobotRadiusMM:   int32(field.GetMaxRobotRadius()),
		BallRadiusMM:       int32(field.GetBallRadius()),
	}
}

func mergeFieldGeometry(current, update FieldGeometry) FieldGeometry {
	if update.LengthMM > 0 {
		current.LengthMM = update.LengthMM
	}
	if update.WidthMM > 0 {
		current.WidthMM = update.WidthMM
	}
	if update.GoalWidthMM > 0 {
		current.GoalWidthMM = update.GoalWidthMM
	}
	if update.GoalDepthMM > 0 {
		current.GoalDepthMM = update.GoalDepthMM
	}
	if update.BoundaryWidthMM >= 0 {
		current.BoundaryWidthMM = update.BoundaryWidthMM
	}
	if update.PenaltyAreaDepthMM > 0 {
		current.PenaltyAreaDepthMM = update.PenaltyAreaDepthMM
	}
	if update.PenaltyAreaWidthMM > 0 {
		current.PenaltyAreaWidthMM = update.PenaltyAreaWidthMM
	}
	if update.CenterCircleMM > 0 {
		current.CenterCircleMM = update.CenterCircleMM
	}
	if update.LineThicknessMM > 0 {
		current.LineThicknessMM = update.LineThicknessMM
	}
	if update.MaxRobotRadiusMM > 0 {
		current.MaxRobotRadiusMM = update.MaxRobotRadiusMM
	}
	if update.BallRadiusMM > 0 {
		current.BallRadiusMM = update.BallRadiusMM
	}
	return current
}

func buildRobotCommands(robotIDs []uint32, input commandInput) ([]*crashpilot_interface.InterfaceRobotCommands_CP, string, error) {
	stateValue, ok := crashpilot_interface.CP_State_value[input.State]
	if !ok {
		return nil, "", fmt.Errorf("unknown state %q", input.State)
	}
	taskValue, ok := crashpilot_interface.CP_Task_value[input.Task]
	if !ok {
		return nil, "", fmt.Errorf("unknown task %q", input.Task)
	}

	commands := make([]*crashpilot_interface.InterfaceRobotCommands_CP, 0, len(robotIDs))
	for _, robotID := range uniqueRobotIDs(robotIDs) {
		cmd := &crashpilot_interface.CP_Command{
			State: ptrState(crashpilot_interface.CP_State(stateValue)),
			Task:  ptrTask(crashpilot_interface.CP_Task(taskValue)),
		}
		if input.Position != nil {
			cmd.Pos = &crashpilot_interface.CP_Vector2{X: int32Ptr(int32(math.Round(input.Position.X))), Y: int32Ptr(int32(math.Round(input.Position.Y)))}
		}
		if input.Speed != nil {
			cmd.Speed = uint32Ptr(*input.Speed)
		}
		if input.Orientation != nil {
			cmd.Orientation = uint32Ptr(*input.Orientation)
		}
		if input.KickOrientation != nil {
			cmd.KickOrient = uint32Ptr(*input.KickOrientation)
		}
		if input.KickSpeed != nil {
			cmd.KickSpeed = uint32Ptr(*input.KickSpeed)
		}
		if input.EnemyId != nil {
			cmd.EnemyId = uint32Ptr(*input.EnemyId)
		}

		commands = append(commands, &crashpilot_interface.InterfaceRobotCommands_CP{
			RobotId: uint32Ptr(robotID),
			Command: cmd,
		})
	}

	return commands, fmt.Sprintf("%s / %s -> %d robot(s)", input.State, input.Task, len(commands)), nil
}

func mapCommandView(cmd *crashpilot_interface.CP_Command) CommandView {
	if cmd == nil {
		return CommandView{State: crashpilot_interface.CP_State_STATE_UNSPECIFIED.String(), Task: crashpilot_interface.CP_Task_TASK_UNSPECIFIED.String()}
	}

	view := CommandView{State: cmd.GetState().String(), Task: cmd.GetTask().String()}
	if cmd.Pos != nil {
		x, y := normalizeCPVector(cmd.Pos.GetX(), cmd.Pos.GetY())
		view.Position = &Vector2{X: x, Y: y}
	}
	if cmd.Speed != nil {
		view.Speed = uint32Ptr(cmd.GetSpeed())
	}
	if cmd.Orientation != nil {
		view.Orientation = uint32Ptr(cmd.GetOrientation())
	}
	if cmd.KickOrient != nil {
		view.KickOrientation = uint32Ptr(cmd.GetKickOrient())
	}
	if cmd.KickSpeed != nil {
		view.KickSpeed = uint32Ptr(cmd.GetKickSpeed())
	}
	if cmd.EnemyId != nil {
		view.EnemyId = uint32Ptr(cmd.GetEnemyId())
	}
	return view
}

func mapCPBall(ball *crashpilot_interface.CP_Ball) *Ball {
	if ball == nil || ball.GetPos() == nil {
		return nil
	}
	x, y := normalizeCPVector(ball.GetPos().GetX(), ball.GetPos().GetY())
	result := &Ball{X: x, Y: y, Source: "crashpilot"}
	if ball.GetVel() != nil {
		vx, vy := normalizeCPVector(ball.GetVel().GetX(), ball.GetVel().GetY())
		result.VX = vx
		result.VY = vy
	}
	return result
}

func findSelfRobot(command *crashpilot_interface.CP_Robot) *Robot {
	for _, robot := range command.GetRobotsBlue() {
		if robot.GetRobotId() == command.GetRobotId() {
			return mapCPTrackedRobot(robot, "blue")
		}
	}
	for _, robot := range command.GetRobotsYellow() {
		if robot.GetRobotId() == command.GetRobotId() {
			return mapCPTrackedRobot(robot, "yellow")
		}
	}
	if len(command.GetRobotsBlue()) > 0 {
		return mapCPTrackedRobot(command.GetRobotsBlue()[0], "blue")
	}
	if len(command.GetRobotsYellow()) > 0 {
		return mapCPTrackedRobot(command.GetRobotsYellow()[0], "yellow")
	}
	return nil
}

func mapCPTrackedRobot(robot *crashpilot_interface.CP_TrackedRobot, team string) *Robot {
	if robot == nil || robot.GetPos() == nil {
		return nil
	}
	x, y := normalizeCPVector(robot.GetPos().GetX(), robot.GetPos().GetY())
	result := &Robot{ID: robot.GetRobotId(), Team: team, X: x, Y: y, Orientation: float64(robot.GetOrientation()), Source: "crashpilot"}
	if robot.GetVel() != nil {
		vx, vy := normalizeCPVector(robot.GetVel().GetX(), robot.GetVel().GetY())
		result.VX = vx
		result.VY = vy
	}
	return result
}

func collectKnownRobotIDs(robots []Robot, commands []RobotCommand) []uint32 {
	unique := make(map[uint32]struct{})
	for _, robot := range robots {
		if robot.ID == 0 && hasTag(robot.Tags, "id_unknown") {
			continue
		}
		unique[robot.ID] = struct{}{}
	}
	for _, command := range commands {
		unique[command.RobotID] = struct{}{}
	}
	ids := make([]uint32, 0, len(unique))
	for id := range unique {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func humanCommandLabel(cmd CommandView) string {
	label := strings.TrimPrefix(cmd.Task, "TASK_")
	if strings.HasPrefix(label, "STATE_") {
		label = strings.TrimPrefix(label, "STATE_")
	}
	if label == "UNSPECIFIED" {
		label = strings.TrimPrefix(cmd.State, "STATE_")
	}
	label = strings.ReplaceAll(label, "_", " ")
	if label == "PosBall" {
		label = "Position Ball"
	}
	return titleWords(strings.ToLower(label))
}

func fieldFromConfig(field config.FieldConfig) FieldGeometry {
	return FieldGeometry{
		LengthMM:           field.LengthMM,
		WidthMM:            field.WidthMM,
		GoalWidthMM:        field.GoalWidthMM,
		GoalDepthMM:        field.GoalDepthMM,
		BoundaryWidthMM:    field.BoundaryWidthMM,
		PenaltyAreaDepthMM: field.PenaltyAreaDepthMM,
		PenaltyAreaWidthMM: field.PenaltyAreaWidthMM,
		CenterCircleMM:     field.CenterCircleMM,
		LineThicknessMM:    field.LineThicknessMM,
		MaxRobotRadiusMM:   field.MaxRobotRadiusMM,
		BallRadiusMM:       field.BallRadiusMM,
	}
}

func normalizeCPVector(x, y int32) (float64, float64) {
	if abs32(x) <= 100 && abs32(y) <= 100 {
		return float64(x) * 1000, float64(y) * 1000
	}
	return float64(x), float64(y)
}

func uniqueRobotIDs(ids []uint32) []uint32 {
	set := make(map[uint32]struct{})
	for _, id := range ids {
		set[id] = struct{}{}
	}
	unique := make([]uint32, 0, len(set))
	for id := range set {
		unique = append(unique, id)
	}
	sort.Slice(unique, func(i, j int) bool { return unique[i] < unique[j] })
	return unique
}

func hasTag(tags []string, tag string) bool {
	for _, value := range tags {
		if value == tag {
			return true
		}
	}
	return false
}

func sleepWithContext(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (c *uiClient) writeJSON(message serverMessage) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return c.write(websocket.TextMessage, payload)
}

func (c *uiClient) write(messageType int, payload []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
		return err
	}
	return c.conn.WriteMessage(messageType, payload)
}

func (c *uiClient) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.Close()
}

func abs32(v int32) int32 {
	if v < 0 {
		return -v
	}
	return v
}

func boolPtr(v bool) *bool { return &v }

func uint32Ptr(v uint32) *uint32 { return &v }

func int32Ptr(v int32) *int32 { return &v }

func ptrState(v crashpilot_interface.CP_State) *crashpilot_interface.CP_State { return &v }

func ptrTask(v crashpilot_interface.CP_Task) *crashpilot_interface.CP_Task { return &v }

func cpModePtr(name string) *crashpilot_interface.CpMode {
	value, ok := crashpilot_interface.CpMode_value[name]
	if !ok {
		value = int32(crashpilot_interface.CpMode_MODE_MANUAL)
	}
	mode := crashpilot_interface.CpMode(value)
	return &mode
}

func cpTestPtr(name string) *crashpilot_interface.CPTests {
	value, ok := crashpilot_interface.CPTests_value[name]
	if !ok {
		value = int32(crashpilot_interface.CPTests_TEST_NONE)
	}
	test := crashpilot_interface.CPTests(value)
	return &test
}

func trackedTeamLabel(robotID *crashpilot_interface.RobotId) string {
	if robotID == nil {
		return "unknown"
	}
	switch robotID.GetTeam() {
	case crashpilot_interface.Team_BLUE:
		return "blue"
	case crashpilot_interface.Team_YELLOW:
		return "yellow"
	default:
		return "unknown"
	}
}

func titleWords(value string) string {
	parts := strings.Fields(value)
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, " ")
}
