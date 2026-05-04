package crashpilot

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/protobuf/proto"

	pb "github.com/technulgy-lgnu/crashpilot-interface/gen/proto"
	"github.com/technulgy-lgnu/crashpilot-interface/internal/hub"
)

const reconnectDelay = 2 * time.Second

// Client maintains a websocket connection to Crashpilot for vision and commands.
type Client struct {
	addr   string
	hub    *hub.Hub
	sendCh chan []byte
	done   chan struct{}

	mu        sync.RWMutex
	connected bool
}

// NewClient creates a new Crashpilot websocket client.
func NewClient(addr string, h *hub.Hub) *Client {
	return &Client{
		addr:   addr,
		hub:    h,
		sendCh: make(chan []byte, 64),
		done:   make(chan struct{}),
	}
}

// Start begins the reconnecting read/write loop.
func (c *Client) Start() {
	go c.run()
}

// Stop shuts down the client.
func (c *Client) Stop() {
	close(c.done)
}

// Send enqueues a command message to be sent to Crashpilot.
func (c *Client) Send(data []byte) error {
	c.mu.RLock()
	connected := c.connected
	c.mu.RUnlock()
	if !connected {
		return fmt.Errorf("crashpilot websocket not connected")
	}

	select {
	case c.sendCh <- data:
		return nil
	default:
		return fmt.Errorf("crashpilot send queue full")
	}
}

func (c *Client) run() {
	for {
		select {
		case <-c.done:
			return
		default:
		}

		if err := c.connectAndServe(); err != nil {
			log.Printf("crashpilot: %v", err)
		}

		select {
		case <-c.done:
			return
		case <-time.After(reconnectDelay):
		}
	}
}

func (c *Client) connectAndServe() error {
	if c.addr == "" {
		return fmt.Errorf("crashpilot ws_url not configured")
	}

	conn, _, err := websocket.DefaultDialer.Dial(c.addr, nil)
	if err != nil {
		return fmt.Errorf("dial %s: %w", c.addr, err)
	}
	defer func() {
		if err := conn.Close(); err != nil {
			log.Printf("crashpilot: close error: %v", err)
		}
	}()

	log.Printf("crashpilot: connected to %s", c.addr)
	c.setConnected(true)
	defer c.setConnected(false)

	readErr := make(chan error, 1)
	go c.readLoop(conn, readErr)

	for {
		select {
		case <-c.done:
			return nil
		case err := <-readErr:
			return err
		case msg := <-c.sendCh:
			if err := conn.WriteMessage(websocket.BinaryMessage, msg); err != nil {
				return fmt.Errorf("write error: %w", err)
			}
		}
	}
}

func (c *Client) readLoop(conn *websocket.Conn, errCh chan<- error) {
	for {
		msgType, msg, err := conn.ReadMessage()
		if err != nil {
			errCh <- err
			return
		}

		if msgType != websocket.BinaryMessage {
			continue
		}

		wrapper := &pb.CP_InterfaceWrapper{}
		if err := proto.Unmarshal(msg, wrapper); err != nil {
			log.Printf("crashpilot: unmarshal error: %v", err)
			continue
		}

		if raw := wrapper.GetVisionRaw(); raw != nil {
			c.hub.UpdateVision(raw)
		}
		if tracked := wrapper.GetVisionTracked(); tracked != nil {
			c.hub.UpdateTracked(tracked)
		}
		if len(wrapper.GetRobotCommands()) > 0 {
			c.hub.UpdateRobotCommands(wrapper.GetRobotCommands())
		}
	}
}

func (c *Client) setConnected(connected bool) {
	c.mu.Lock()
	c.connected = connected
	c.mu.Unlock()
}
