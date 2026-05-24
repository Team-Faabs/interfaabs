package main

import (
	"io/fs"
	"log"
	"os"
	"os/signal"
	"syscall"

	root "github.com/technulgy-lgnu/crashpilot-interface"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/config"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/hub"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/server"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/vision"
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

	log.Printf("config loaded: server=%s, vision=%s, tracked=%s, source=%s",
		cfg.Server.Addr(), cfg.Vision.MulticastAddr, cfg.Vision.TrackedAddr, cfg.Vision.DefaultSource)

	// Create hub
	h := hub.New(cfg.Vision.DefaultSource)
	defer h.Stop()

	// Start vision receiver
	visionRx := vision.NewReceiver(cfg.Vision.MulticastAddr, cfg.Vision.MulticastIface, h)
	go func() {
		if err := visionRx.Run(); err != nil {
			log.Printf("vision receiver error: %v", err)
		}
	}()

	// Start tracked receiver
	trackedRx := vision.NewTrackedReceiver(cfg.Vision.TrackedAddr, cfg.Vision.MulticastIface, h)
	go func() {
		if err := trackedRx.Run(); err != nil {
			log.Printf("tracked receiver error: %v", err)
		}
	}()

	// Prepare embedded frontend filesystem
	frontendFS, err := fs.Sub(root.FrontendDist, "frontend/dist")
	if err != nil {
		log.Fatalf("failed to create frontend sub-filesystem: %v", err)
	}

	// Create and start server
	srv := server.New(cfg, h, frontendFS)

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

