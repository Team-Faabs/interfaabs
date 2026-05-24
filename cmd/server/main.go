package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/technulgy-lgnu/crashpilot-interface/internal/app"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/config"
)

func main() {
	cfgPath := "config.toml"
	if v := os.Getenv("CRASHPILOT_CONFIG"); v != "" {
		cfgPath = v
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	log.Printf("config loaded: server=%s:%d, ws=%s",
		cfg.Server.Host, cfg.Server.Port, cfg.CrashPilot.WSURL)

	svc, err := app.New(cfg)
	if err != nil {
		log.Fatalf("failed to create service: %v", err)
	}

	srv := &http.Server{
		Addr:    fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port),
		Handler: svc.Handler(),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go svc.RunController(ctx)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		log.Println("shutting down...")
		cancel()
		shutdownCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("server shutdown error: %v", err)
		}
	}()

	log.Printf("listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server error: %v", err)
	}
}
