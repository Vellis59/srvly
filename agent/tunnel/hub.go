package tunnel

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/Vellis59/srvly/agent/store"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Hub struct {
	clients        map[string]*websocket.Conn
	mu             sync.RWMutex
	store          *store.Store
	pendingResults map[string]chan *CommandResult
}

type CommandResult struct {
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error"`
}

func NewHub(s *store.Store) *Hub {
	return &Hub{
		clients:        make(map[string]*websocket.Conn),
		store:          s,
		pendingResults: make(map[string]chan *CommandResult),
	}
}

func (h *Hub) Run() {}

func (h *Hub) Dispatch(serverID, commandID, script string, timeout time.Duration) *CommandResult {
	h.mu.RLock()
	conn, ok := h.clients[serverID]
	h.mu.RUnlock()

	if !ok {
		return &CommandResult{Error: "agent not connected"}
	}

	resultChan := make(chan *CommandResult, 1)
	h.mu.Lock()
	h.pendingResults[commandID] = resultChan
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.pendingResults, commandID)
		h.mu.Unlock()
	}()

	// Send command to agent
	payload, _ := json.Marshal(map[string]string{"script": script})
	msg := Message{
		Type:    "exec",
		ID:      commandID,
		Payload: payload,
	}
	data, _ := json.Marshal(msg)
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		return &CommandResult{Error: "write error: " + err.Error()}
	}

	// Wait for result
	select {
	case result := <-resultChan:
		return result
	case <-time.After(timeout):
		return &CommandResult{Error: "timeout"}
	}
}

func (h *Hub) handleMessageFrom(serverID string, data []byte) {
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("invalid message from %s: %v", serverID, err)
		return
	}

	if msg.Type == "result" && msg.ID != "" {
		h.mu.RLock()
		ch, ok := h.pendingResults[msg.ID]
		h.mu.RUnlock()
		if ok {
			var result CommandResult
			json.Unmarshal(msg.Payload, &result)
			ch <- &result
		}
		return
	}

	log.Printf("unhandled message from %s: type=%s", serverID, msg.Type)
}

func (h *Hub) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade error: %v", err)
		return
	}

	token := r.Header.Get("Authorization")

	// Auth
	_, data, err := conn.ReadMessage()
	if err != nil {
		log.Printf("auth read error: %v", err)
		conn.Close()
		return
	}

	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("auth parse error: %v", err)
		conn.WriteJSON(Message{Type: "error", Payload: []byte(`"invalid json"`)})
		conn.Close()
		return
	}

	if msg.Type != "auth" {
		log.Printf("unexpected message type: %s", msg.Type)
		conn.WriteJSON(Message{Type: "error", Payload: []byte(`"expected auth"`)})
		conn.Close()
		return
	}

	var auth struct {
		ServerID string `json:"server_id"`
	}
	json.Unmarshal(msg.Payload, &auth)
	serverID := auth.ServerID
	if serverID == "" {
		serverID = "unknown"
	}

	h.mu.Lock()
	h.clients[serverID] = conn
	h.mu.Unlock()
	log.Printf("agent connected: %s (total: %d)", serverID, len(h.clients))

	if token != "" {
		h.store.SetServerConnected(token)
	}

	conn.WriteJSON(Message{Type: "auth_ok"})

	defer func() {
		h.mu.Lock()
		delete(h.clients, serverID)
		h.mu.Unlock()
		conn.Close()
		log.Printf("agent disconnected: %s", serverID)
		if token != "" {
			h.store.SetServerDisconnected(token)
		}
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		h.handleMessageFrom(serverID, data)
	}
}
