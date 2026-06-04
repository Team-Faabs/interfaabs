package config

import (
	"fmt"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Server            ServerConfig            `toml:"server"`
	CrashPilot        CrashPilotConfig        `toml:"crashpilot"`
	InterfaceDefaults InterfaceDefaultsConfig `toml:"interface_defaults"`
	Field             FieldConfig             `toml:"field"`
}

type ServerConfig struct {
	Host string `toml:"host"`
	Port int    `toml:"port"`
}

type CrashPilotConfig struct {
	WSURL              string `toml:"ws_url"`
	ReconnectDelayMS   int    `toml:"reconnect_delay_ms"`
	HandshakeTimeoutMS int    `toml:"handshake_timeout_ms"`
	WriteTimeoutMS     int    `toml:"write_timeout_ms"`
}

type InterfaceDefaultsConfig struct {
	EnableTestfield bool   `toml:"enable_testfield"`
	Testfield       uint32 `toml:"testfield"`
	BallTracked     bool   `toml:"ball_tracked"`
	GCData          bool   `toml:"gc_data"`
	GameMode        bool   `toml:"game_mode"`
	Side            bool   `toml:"side"`
	TeamColor       bool   `toml:"team_color"`
	Goalkeeper      uint32 `toml:"goalkeeper_id"`
	MaxSpeed        uint32 `toml:"max_speed"`
}

type FieldConfig struct {
	LengthMM           int32 `toml:"length_mm"`
	WidthMM            int32 `toml:"width_mm"`
	GoalWidthMM        int32 `toml:"goal_width_mm"`
	GoalDepthMM        int32 `toml:"goal_depth_mm"`
	BoundaryWidthMM    int32 `toml:"boundary_width_mm"`
	PenaltyAreaDepthMM int32 `toml:"penalty_area_depth_mm"`
	PenaltyAreaWidthMM int32 `toml:"penalty_area_width_mm"`
	CenterCircleMM     int32 `toml:"center_circle_radius_mm"`
	LineThicknessMM    int32 `toml:"line_thickness_mm"`
	MaxRobotRadiusMM   int32 `toml:"max_robot_radius_mm"`
	BallRadiusMM       int32 `toml:"ball_radius_mm"`
}

func Default() Config {
	return Config{
		Server: ServerConfig{
			Host: "0.0.0.0",
			Port: 8080,
		},
		CrashPilot: CrashPilotConfig{
			WSURL:              "ws://127.0.0.1:4096/ws",
			ReconnectDelayMS:   2000,
			HandshakeTimeoutMS: 10000,
			WriteTimeoutMS:     2000,
		},
		InterfaceDefaults: InterfaceDefaultsConfig{
			EnableTestfield: false,
			Testfield:       0,
			BallTracked:     true,
			GCData:          true,
			GameMode:        false,
			Side:            false,
			TeamColor:       false,
			Goalkeeper:      0,
			MaxSpeed:        0,
		},
		Field: FieldConfig{
			LengthMM:           9000,
			WidthMM:            6000,
			GoalWidthMM:        1000,
			GoalDepthMM:        180,
			BoundaryWidthMM:    300,
			PenaltyAreaDepthMM: 1000,
			PenaltyAreaWidthMM: 2000,
			CenterCircleMM:     500,
			LineThicknessMM:    10,
			MaxRobotRadiusMM:   90,
			BallRadiusMM:       22,
		},
	}
}

func Load(path string) (Config, error) {
	cfg := Default()
	if _, err := toml.DecodeFile(path, &cfg); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}

	if cfg.Server.Host == "" {
		cfg.Server.Host = "0.0.0.0"
	}
	if cfg.Server.Port <= 0 {
		cfg.Server.Port = 8080
	}
	if cfg.CrashPilot.WSURL == "" {
		return Config{}, fmt.Errorf("crashpilot.ws_url is required")
	}
	if cfg.CrashPilot.ReconnectDelayMS <= 0 {
		cfg.CrashPilot.ReconnectDelayMS = 2000
	}
	if cfg.CrashPilot.HandshakeTimeoutMS <= 0 {
		cfg.CrashPilot.HandshakeTimeoutMS = 10000
	}
	if cfg.CrashPilot.WriteTimeoutMS <= 0 {
		cfg.CrashPilot.WriteTimeoutMS = 2000
	}

	defaults := Default()
	if cfg.Field.LengthMM <= 0 {
		cfg.Field.LengthMM = defaults.Field.LengthMM
	}
	if cfg.Field.WidthMM <= 0 {
		cfg.Field.WidthMM = defaults.Field.WidthMM
	}
	if cfg.Field.GoalWidthMM <= 0 {
		cfg.Field.GoalWidthMM = defaults.Field.GoalWidthMM
	}
	if cfg.Field.GoalDepthMM <= 0 {
		cfg.Field.GoalDepthMM = defaults.Field.GoalDepthMM
	}
	if cfg.Field.BoundaryWidthMM < 0 {
		cfg.Field.BoundaryWidthMM = defaults.Field.BoundaryWidthMM
	}
	if cfg.Field.PenaltyAreaDepthMM <= 0 {
		cfg.Field.PenaltyAreaDepthMM = defaults.Field.PenaltyAreaDepthMM
	}
	if cfg.Field.PenaltyAreaWidthMM <= 0 {
		cfg.Field.PenaltyAreaWidthMM = defaults.Field.PenaltyAreaWidthMM
	}
	if cfg.Field.CenterCircleMM <= 0 {
		cfg.Field.CenterCircleMM = defaults.Field.CenterCircleMM
	}
	if cfg.Field.LineThicknessMM <= 0 {
		cfg.Field.LineThicknessMM = defaults.Field.LineThicknessMM
	}
	if cfg.Field.MaxRobotRadiusMM <= 0 {
		cfg.Field.MaxRobotRadiusMM = defaults.Field.MaxRobotRadiusMM
	}
	if cfg.Field.BallRadiusMM <= 0 {
		cfg.Field.BallRadiusMM = defaults.Field.BallRadiusMM
	}

	return cfg, nil
}
