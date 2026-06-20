package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/Vellis59/srvly/agent/store"
	"github.com/Vellis59/srvly/agent/tunnel"
)

var hub *tunnel.Hub

func main() {
	db := store.New()
	defer db.Close()

	hub = tunnel.NewHub(db)
	go hub.Run()

	http.HandleFunc("/ws", hub.HandleWS)
	http.HandleFunc("/dispatch", handleDispatch)

	addr := ":8080"
	log.Printf("tunnel-server listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

type DispatchRequest struct {
	ServerID  string `json:"server_id"`
	CommandID string `json:"command_id"`
	Script    string `json:"script"`
	Timeout   int    `json:"timeout"` // seconds
}

func handleDispatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", 405)
		return
	}

	var req DispatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid json"}`, 400)
		return
	}

	if req.CommandID == "" || req.Script == "" {
		http.Error(w, `{"error":"command_id and script required"}`, 400)
		return
	}

	serverID := req.ServerID
	if serverID == "" {
		serverID = "unknown"
	}

	timeout := time.Duration(req.Timeout) * time.Second
	if timeout == 0 {
		timeout = 60 * time.Second
	}

	log.Printf("dispatch: %s -> %s (script length: %d)", req.CommandID, serverID, len(req.Script))

	result := hub.Dispatch(serverID, req.CommandID, req.Script, timeout)
	w.Header().Set("Content-Type", "application/json")

	if result.Error != "" {
		w.WriteHeader(502)
		json.NewEncoder(w).Encode(result)
		return
	}

	json.NewEncoder(w).Encode(result)
}
