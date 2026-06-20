package tunnel

import (
	"encoding/json"
	"log"
	"time"

	"github.com/Vellis59/srvly/agent/config"
	"github.com/Vellis59/srvly/agent/executor"
	"github.com/gorilla/websocket"
)

type Message struct {
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type execPayload struct {
	Script string `json:"script"`
}

type Tunnel struct {
	cfg  *config.Config
	conn *websocket.Conn
	done chan struct{}
}

func New(cfg *config.Config) *Tunnel {
	return &Tunnel{
		cfg:  cfg,
		done: make(chan struct{}),
	}
}

func (t *Tunnel) Connect() {
	for {
		header := map[string][]string{
			"Authorization": {t.cfg.Token},
		}

		conn, _, err := websocket.DefaultDialer.Dial(t.cfg.ServerURL, header)
		if err != nil {
			log.Printf("connection failed: %v — retrying in 5s", err)
			time.Sleep(5 * time.Second)
			continue
		}
		t.conn = conn
		log.Println("connected to platform")

		// Authenticate
		t.send(Message{
			Type: "auth",
			Payload: json.RawMessage(`{"server_id":"` + t.cfg.ServerID + `"}`),
		})

		// Read loop
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				log.Printf("read error: %v — reconnecting", err)
				conn.Close()
				break
			}
			t.handleMessage(data)
		}

		time.Sleep(2 * time.Second)
	}
}

func (t *Tunnel) handleMessage(data []byte) {
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("invalid message: %v", err)
		return
	}

	switch msg.Type {
	case "auth_ok":
		log.Printf("received: type=auth_ok id=%s", msg.ID)

	case "exec":
		log.Printf("received command: id=%s", msg.ID)
		var payload execPayload
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			log.Printf("invalid exec payload: %v", err)
			t.sendResult(msg.ID, false, "", "invalid payload: "+err.Error())
			return
		}

		// Execute the command
		result := executor.Run(executor.Command{
			ID:     msg.ID,
			Script: payload.Script,
		})

		t.sendResult(msg.ID, result.Success, result.Output, result.Error)

	default:
		log.Printf("unhandled message: type=%s id=%s", msg.Type, msg.ID)
	}
}

func (t *Tunnel) sendResult(id string, success bool, output, errMsg string) {
	payload, _ := json.Marshal(map[string]interface{}{
		"success": success,
		"output":  output,
		"error":   errMsg,
	})
	t.send(Message{
		Type:    "result",
		ID:      id,
		Payload: payload,
	})
}

func (t *Tunnel) send(msg Message) {
	data, _ := json.Marshal(msg)
	if err := t.conn.WriteMessage(websocket.TextMessage, data); err != nil {
		log.Printf("send error: %v", err)
	}
}

func (t *Tunnel) Close() {
	close(t.done)
	if t.conn != nil {
		t.conn.Close()
	}
}
