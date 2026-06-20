package tunnel

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	clients map[string]*websocket.Conn
	mu      sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]*websocket.Conn),
	}
}

func (h *Hub) Run() {
	// background processor (future: relay to Redis/job queue)
}

func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade error: %v", err)
		return
	}

	// Wait for auth message
	_, data, err := conn.ReadMessage()
	if err != nil {
		conn.Close()
		return
	}

	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil || msg.Type != "auth" {
		conn.WriteJSON(Message{Type: "error", Payload: []byte(`"invalid auth"`)})
		conn.Close()
		return
	}

	// Extract server_id from payload
	var auth struct {
		ServerID string `json:"server_id"`
	}
	json.Unmarshal(msg.Payload, &auth)

	serverID := auth.ServerID
	if serverID == "" {
		conn.Close()
		return
	}

	h.mu.Lock()
	h.clients[serverID] = conn
	h.mu.Unlock()
	log.Printf("agent connected: %s (total: %d)", serverID, len(h.clients))

	// Send confirmation
	conn.WriteJSON(Message{Type: "auth_ok"})

	// Read loop — detect disconnection
	defer func() {
		h.mu.Lock()
		delete(h.clients, serverID)
		h.mu.Unlock()
		conn.Close()
		log.Printf("agent disconnected: %s", serverID)
	}()
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}
