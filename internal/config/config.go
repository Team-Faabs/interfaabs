package config

import (
	"fmt"
	"os"

	"github.com/BurntSushi/toml"
)

type Config struct {
	Server     ServerConfig     `toml:"server"`
	Crashpilot CrashpilotConfig `toml:"crashpilot"`
}

type ServerConfig struct {
	Host string `toml:"host"`
	Port int    `toml:"port"`
}

type CrashpilotConfig struct {
	WsURL         string `toml:"ws_url"`
	DefaultSource string `toml:"default_source"`
}

// Load attempts to load config.toml from the given paths in order.
// It returns the first successfully parsed config.
func Load(paths ...string) (*Config, error) {
	for _, p := range paths {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		cfg := &Config{}
		if _, err := toml.DecodeFile(p, cfg); err != nil {
			return nil, fmt.Errorf("failed to parse config %s: %w", p, err)
		}
		return cfg, nil
	}
	return nil, fmt.Errorf("no config file found in paths: %v", paths)
}

// Addr returns the server listen address.
func (s *ServerConfig) Addr() string {
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

// Addr returns the crashpilot websocket address, or empty if not configured.
func (c *CrashpilotConfig) Addr() string {
	if c.WsURL == "" {
		return ""
	}
	return c.WsURL
}
