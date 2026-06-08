package app

import "time"

type Snapshot struct {
	UpdatedAt        time.Time        `json:"updatedAt"`
	Controller       ControllerStatus `json:"controller"`
	Field            FieldGeometry    `json:"field"`
	Vision           VisionState      `json:"vision"`
	RobotCommands    []RobotCommand   `json:"robotCommands"`
	InterfaceOptions InterfaceOptions `json:"interfaceOptions"`
	Referee          *RefereeState    `json:"referee,omitempty"`
	KnownRobotIDs    []uint32         `json:"knownRobotIds"`
	Debug            DebugState       `json:"debug"`
}

type ControllerStatus struct {
	URL              string     `json:"url"`
	Connected        bool       `json:"connected"`
	ReconnectDelayMS int        `json:"reconnectDelayMs"`
	LastConnectedAt  *time.Time `json:"lastConnectedAt,omitempty"`
	LastMessageAt    *time.Time `json:"lastMessageAt,omitempty"`
	LastError        string     `json:"lastError,omitempty"`
}

type FieldGeometry struct {
	LengthMM           int32 `json:"lengthMm"`
	WidthMM            int32 `json:"widthMm"`
	GoalWidthMM        int32 `json:"goalWidthMm"`
	GoalDepthMM        int32 `json:"goalDepthMm"`
	BoundaryWidthMM    int32 `json:"boundaryWidthMm"`
	PenaltyAreaDepthMM int32 `json:"penaltyAreaDepthMm"`
	PenaltyAreaWidthMM int32 `json:"penaltyAreaWidthMm"`
	CenterCircleMM     int32 `json:"centerCircleMm"`
	LineThicknessMM    int32 `json:"lineThicknessMm"`
	MaxRobotRadiusMM   int32 `json:"maxRobotRadiusMm"`
	BallRadiusMM       int32 `json:"ballRadiusMm"`
}

type VisionState struct {
	Source      string      `json:"source"`
	SourceLabel string      `json:"sourceLabel"`
	FrameNumber uint32      `json:"frameNumber"`
	Timestamp   float64     `json:"timestamp"`
	Balls       []Ball      `json:"balls"`
	Robots      []Robot     `json:"robots"`
	HasGeometry bool        `json:"hasGeometry"`
	UpdatedAt   *time.Time  `json:"updatedAt,omitempty"`
	KickedBall  *KickedBall `json:"kickedBall,omitempty"`
}

type Robot struct {
	ID          uint32   `json:"id"`
	Team        string   `json:"team"`
	X           float64  `json:"x"`
	Y           float64  `json:"y"`
	Orientation float64  `json:"orientation"`
	VX          float64  `json:"vx,omitempty"`
	VY          float64  `json:"vy,omitempty"`
	Visibility  float64  `json:"visibility,omitempty"`
	Confidence  float64  `json:"confidence,omitempty"`
	Source      string   `json:"source,omitempty"`
	Tags        []string `json:"tags,omitempty"`
}

type Ball struct {
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Z          float64 `json:"z,omitempty"`
	VX         float64 `json:"vx,omitempty"`
	VY         float64 `json:"vy,omitempty"`
	Visibility float64 `json:"visibility,omitempty"`
	Source     string  `json:"source,omitempty"`
}

type KickedBall struct {
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	StopX      float64 `json:"stopX,omitempty"`
	StopY      float64 `json:"stopY,omitempty"`
	RobotID    uint32  `json:"robotId,omitempty"`
	RobotTeam  string  `json:"robotTeam,omitempty"`
	VelocityMM float64 `json:"velocityMm,omitempty"`
}

type RobotCommand struct {
	RobotID      uint32      `json:"robotId"`
	PacketID     uint32      `json:"packetId"`
	Timestamp    string      `json:"timestamp,omitempty"`
	Ball         *Ball       `json:"ball,omitempty"`
	Self         *Robot      `json:"self,omitempty"`
	Command      CommandView `json:"command"`
	YellowCount  int         `json:"yellowCount"`
	BlueCount    int         `json:"blueCount"`
	ReceivedAt   time.Time   `json:"receivedAt"`
	CommandLabel string      `json:"commandLabel"`
	AgeMS        int64       `json:"ageMs"`
	Meta         CommandMeta `json:"meta"`
}

type CommandMeta struct {
	HasTarget      bool `json:"hasTarget"`
	HasKick        bool `json:"hasKick"`
	HasSpeed       bool `json:"hasSpeed"`
	HasOrientation bool `json:"hasOrientation"`
}

type CommandView struct {
	State           string   `json:"state"`
	Task            string   `json:"task"`
	Position        *Vector2 `json:"position,omitempty"`
	Speed           *uint32  `json:"speed,omitempty"`
	Orientation     *uint32  `json:"orientation,omitempty"`
	KickOrientation *uint32  `json:"kickOrientation,omitempty"`
	KickSpeed       *uint32  `json:"kickSpeed,omitempty"`
	EnemyId         *uint32  `json:"enemyId,omitempty"`
}

type Vector2 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type InterfaceOptions struct {
	Mode   string        `json:"mode"`
	Manual ManualOptions `json:"manual"`
	Game   GameOptions   `json:"game"`
	Test   TestOptions   `json:"test"`
}

type ManualOptions struct {
	EnableTestfield bool   `json:"enableTestfield"`
	Testfield       uint32 `json:"testfield"`
	BallTracked     bool   `json:"ballTracked"`
	GCData          bool   `json:"gcData"`
}

type GameOptions struct {
	Running      bool   `json:"running"`
	Side         bool   `json:"side"`
	TeamColor    bool   `json:"teamColor"`
	GoalkeeperID uint32 `json:"goalkeeperId"`
	MaxSpeed     uint32 `json:"maxSpeed"`
}

type TestOptions struct {
	Test     string   `json:"test"`
	RobotIDs []uint32 `json:"robotIds"`
}

type RefereeState struct {
	Stage                  string      `json:"stage"`
	Command                string      `json:"command"`
	NextCommand            string      `json:"nextCommand,omitempty"`
	StatusMessage          string      `json:"statusMessage,omitempty"`
	StageTimeLeftUS        int64       `json:"stageTimeLeftUs,omitempty"`
	ActionTimeRemainingUS  int64       `json:"actionTimeRemainingUs,omitempty"`
	BlueTeamOnPositiveHalf bool        `json:"blueTeamOnPositiveHalf"`
	DesignatedPosition     *Vector2    `json:"designatedPosition,omitempty"`
	Blue                   RefereeTeam `json:"blue"`
	Yellow                 RefereeTeam `json:"yellow"`
}

type RefereeTeam struct {
	Name        string   `json:"name"`
	Score       uint32   `json:"score"`
	RedCards    uint32   `json:"redCards"`
	YellowCards uint32   `json:"yellowCards"`
	YellowTimes []uint32 `json:"yellowTimes"`
	Timeouts    uint32   `json:"timeouts"`
	Goalkeeper  uint32   `json:"goalkeeper"`
}

type DebugState struct {
	StartedAt         time.Time  `json:"startedAt"`
	Clients           int        `json:"clients"`
	PacketsReceived   uint64     `json:"packetsReceived"`
	PacketsSent       uint64     `json:"packetsSent"`
	BrowserMessages   uint64     `json:"browserMessages"`
	Broadcasts        uint64     `json:"broadcasts"`
	LastInboundBytes  int        `json:"lastInboundBytes"`
	LastOutboundBytes int        `json:"lastOutboundBytes"`
	RawFrames         uint64     `json:"rawFrames"`
	TrackedFrames     uint64     `json:"trackedFrames"`
	CommandFrames     uint64     `json:"commandFrames"`
	LastInboundAt     *time.Time `json:"lastInboundAt,omitempty"`
	LastOutboundAt    *time.Time `json:"lastOutboundAt,omitempty"`
	LastEvent         string     `json:"lastEvent,omitempty"`
	LastError         string     `json:"lastError,omitempty"`
	LastCommand       string     `json:"lastCommand,omitempty"`
}

type serverMessage struct {
	Type     string    `json:"type"`
	Snapshot *Snapshot `json:"snapshot,omitempty"`
	Error    string    `json:"error,omitempty"`
}

type clientMessage struct {
	Type     string            `json:"type"`
	Options  *InterfaceOptions `json:"options,omitempty"`
	RobotIDs []uint32          `json:"robotIds,omitempty"`
	Command  *commandInput     `json:"command,omitempty"`
}

type commandInput struct {
	State           string   `json:"state"`
	Task            string   `json:"task"`
	Position        *Vector2 `json:"position,omitempty"`
	Speed           *uint32  `json:"speed,omitempty"`
	Orientation     *uint32  `json:"orientation,omitempty"`
	KickOrientation *uint32  `json:"kickOrientation,omitempty"`
	KickSpeed       *uint32  `json:"kickSpeed,omitempty"`
	EnemyId         *uint32  `json:"enemyId,omitempty"`
}
