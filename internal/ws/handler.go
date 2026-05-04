package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"google.golang.org/protobuf/proto"

	pb "github.com/technulgy-lgnu/crashpilot-interface/gen/proto"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/crashpilot"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/hub"
)

// Handler manages websocket endpoints.
type Handler struct {
	hub *hub.Hub
	cp  *crashpilot.Client

	// Command broadcast
	cmdSubMu sync.RWMutex
	cmdSubs  map[chan []byte]struct{}
}

// NewHandler creates a new websocket handler.
func NewHandler(h *hub.Hub, cp *crashpilot.Client) *Handler {
	return &Handler{
		hub:     h,
		cp:      cp,
		cmdSubs: make(map[chan []byte]struct{}),
	}
}

// Register sets up websocket routes on the Fiber app.
func (wh *Handler) Register(app *fiber.App) {
	// Upgrade middleware for websocket routes
	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	app.Get("/ws/vision", websocket.New(wh.handleVision))
	app.Get("/ws/command", websocket.New(wh.handleCommand))
	app.Get("/ws/commands", websocket.New(wh.handleCommandStream))
	app.Get("/ws/source", websocket.New(wh.handleSource))
}

// handleVision streams FieldState JSON to the client.
func (wh *Handler) handleVision(c *websocket.Conn) {
	ch := wh.hub.Subscribe()
	defer wh.hub.Unsubscribe(ch)

	for state := range ch {
		data, err := json.Marshal(state)
		if err != nil {
			log.Printf("ws/vision: marshal error: %v", err)
			continue
		}
		if err := c.WriteMessage(websocket.TextMessage, data); err != nil {
			log.Printf("ws/vision: write error: %v", err)
			return
		}
	}
}

// handleCommand receives protobuf-encoded InterfaceWrapper_CP messages from the client.
func (wh *Handler) handleCommand(c *websocket.Conn) {
	for {
		msgType, msg, err := c.ReadMessage()
		if err != nil {
			log.Printf("ws/command: read error: %v", err)
			return
		}

		if msgType != websocket.BinaryMessage {
			log.Printf("ws/command: expected binary message, got type %d", msgType)
			continue
		}

		cpMsg := &pb.InterfaceWrapper_CP{}
		if err := proto.Unmarshal(msg, cpMsg); err != nil {
			log.Printf("ws/command: unmarshal error: %v", err)
			continue
		}

		log.Printf("ws/command: received %d robot commands", len(cpMsg.GetRobotCommands()))

		if err := wh.cp.Send(msg); err != nil {
			log.Printf("ws/command: failed to send to crashpilot: %v", err)
		}

		// Broadcast raw protobuf to command stream subscribers
		wh.broadcastCommand(msg)
	}
}

// handleCommandStream broadcasts commands to other consumers.
func (wh *Handler) handleCommandStream(c *websocket.Conn) {
	ch := make(chan []byte, 16)
	wh.cmdSubMu.Lock()
	wh.cmdSubs[ch] = struct{}{}
	wh.cmdSubMu.Unlock()

	defer func() {
		wh.cmdSubMu.Lock()
		delete(wh.cmdSubs, ch)
		wh.cmdSubMu.Unlock()
		close(ch)
	}()

	for msg := range ch {
		if err := c.WriteMessage(websocket.BinaryMessage, msg); err != nil {
			log.Printf("ws/commands: write error: %v", err)
			return
		}
	}
}

// sourceRequest is the JSON format for source get/set.
type sourceRequest struct {
	Source string `json:"source"`
}

// handleSource allows getting and setting the active source.
func (wh *Handler) handleSource(c *websocket.Conn) {
	// Send current source on connect
	current := sourceRequest{Source: wh.hub.GetSource()}
	data, _ := json.Marshal(current)
	if err := c.WriteMessage(websocket.TextMessage, data); err != nil {
		return
	}

	for {
		_, msg, err := c.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseNoStatusReceived) {
				log.Printf("ws/source: read error: %v", err)
			}
			return
		}

		var req sourceRequest
		if err := json.Unmarshal(msg, &req); err != nil {
			log.Printf("ws/source: unmarshal error: %v", err)
			continue
		}

		if req.Source == "vision" || req.Source == "tracked" {
			wh.hub.SetSource(req.Source)
			log.Printf("ws/source: switched to %s", req.Source)
		}

		// Reply with current source
		resp := sourceRequest{Source: wh.hub.GetSource()}
		respData, _ := json.Marshal(resp)
		if err := c.WriteMessage(websocket.TextMessage, respData); err != nil {
			return
		}
	}
}

func (wh *Handler) broadcastCommand(data []byte) {
	wh.cmdSubMu.RLock()
	defer wh.cmdSubMu.RUnlock()

	for ch := range wh.cmdSubs {
		select {
		case ch <- data:
		default:
			log.Println("ws/commands: dropping command for slow subscriber")
		}
	}
}

// RegisterREST REST endpoint for source switching (non-websocket alternative)
func (wh *Handler) RegisterREST(app *fiber.App) {
	app.Get("/api/source", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"source": wh.hub.GetSource()})
	})

	app.Post("/api/source", func(c *fiber.Ctx) error {
		var req sourceRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": fmt.Sprintf("invalid body: %v", err)})
		}
		if req.Source != "vision" && req.Source != "tracked" {
			return c.Status(400).JSON(fiber.Map{"error": "source must be 'vision' or 'tracked'"})
		}
		wh.hub.SetSource(req.Source)
		return c.JSON(fiber.Map{"source": wh.hub.GetSource()})
	})
}
