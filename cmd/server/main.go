package main

import (
	"io/fs"
	"log"
	"os"
	"os/signal"
	"syscall"

	root "github.com/technulgy-lgnu/crashpilot-interface"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/config"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/crashpilot"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/hub"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/server"
)

func main() {
	// Load config
	cfg, err := config.Load(
		"config.toml",
		"/etc/crashpilot/config.toml",
	)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	log.Printf("config loaded: server=%s, crashpilot=%s, source=%s",
		cfg.Server.Addr(), cfg.Crashpilot.Addr(), cfg.Crashpilot.DefaultSource)

	// Create hub
	h := hub.New(cfg.Crashpilot.DefaultSource)
	defer h.Stop()

	// Start crashpilot websocket client
	cpClient := crashpilot.NewClient(cfg.Crashpilot.Addr(), h)
	cpClient.Start()
	defer cpClient.Stop()

	// Prepare embedded frontend filesystem
	frontendFS, err := fs.Sub(root.FrontendDist, "frontend/dist")
	if err != nil {
		log.Fatalf("failed to create frontend sub-filesystem: %v", err)
	}

	// Create and start server
	srv := server.New(cfg, h, cpClient, frontendFS)

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("shutting down...")
		if err := srv.Shutdown(); err != nil {
			log.Printf("server shutdown error: %v", err)
		}
	}()

	if err := srv.Start(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
