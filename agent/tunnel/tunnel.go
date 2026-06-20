package tunnel

import (
	"encoding/json"
	"log"
	"time"

	"github.com/Vellis59/srvly/agent/config"
	"github.com/gorilla/websocket"
)

type Message struct {
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type Tunnel struct {
	cfg    *config.Config
	conn   *websocket.Conn
	done   chan struct{}
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
	log.Printf("received: type=%s id=%s", msg.Type, msg.ID)
	// TODO: dispatch to executor
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
