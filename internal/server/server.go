package server

import (
	"io/fs"
	"log"
	"net/http"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/filesystem"

	"github.com/technulgy-lgnu/crashpilot-interface/internal/config"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/crashpilot"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/hub"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/ws"
)

// Server holds the Fiber application and dependencies.
type Server struct {
	app *fiber.App
	cfg *config.Config
}

// New creates a new server with the given config, hub, and embedded frontend filesystem.
func New(cfg *config.Config, h *hub.Hub, cpClient *crashpilot.Client, frontendFS fs.FS) *Server {
	app := fiber.New(fiber.Config{
		DisableStartupMessage: false,
	})

	// CORS middleware for development
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Origin,Content-Type,Accept,Authorization",
	}))

	// WebSocket handlers
	wsHandler := ws.NewHandler(h, cpClient)
	wsHandler.Register(app)
	wsHandler.RegisterREST(app)

	// Health check
	app.Get("/api/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	// Serve embedded frontend static files
	app.Use("/", filesystem.New(filesystem.Config{
		Root:         http.FS(frontendFS),
		Browse:       false,
		Index:        "index.html",
		NotFoundFile: "index.html", // SPA fallback
	}))

	return &Server{app: app, cfg: cfg}
}

// Start begins listening on the configured address.
func (s *Server) Start() error {
	addr := s.cfg.Server.Addr()
	log.Printf("server: starting on %s", addr)
	return s.app.Listen(addr)
}

// Shutdown gracefully shuts down the server.
func (s *Server) Shutdown() error {
	return s.app.Shutdown()
}
