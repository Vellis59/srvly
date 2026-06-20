package main

import (
	"log"
	"net/http"

	"github.com/Vellis59/srvly/agent/store"
	"github.com/Vellis59/srvly/agent/tunnel"
)

func main() {
	db := store.New()
	defer db.Close()

	hub := tunnel.NewHub(db)
	go hub.Run()

	http.HandleFunc("/ws", hub.HandleWS)

	addr := ":8080"
	log.Printf("tunnel-server listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
