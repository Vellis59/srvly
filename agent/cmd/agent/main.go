package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/Vellis59/srvly/agent/config"
	"github.com/Vellis59/srvly/agent/tunnel"
)

func main() {
	var (
		configPath string
		token      string
		serverURL  string
		serverID   string
	)

	flag.StringVar(&configPath, "config", "", "path to config file")
	flag.StringVar(&token, "token", "", "agent authentication token")
	flag.StringVar(&serverURL, "server", "", "WebSocket server URL")
	flag.StringVar(&serverID, "id", "", "server ID")
	flag.Parse()

	cfg := config.Load(configPath)

	// CLI flags override env vars
	if token != "" {
		cfg.Token = token
	}
	if serverURL != "" {
		cfg.ServerURL = serverURL
	}
	if serverID != "" {
		cfg.ServerID = serverID
	}

	log.Printf("srvly-agent starting — server: %s", cfg.ServerURL)

	t := tunnel.New(cfg)
	go t.Connect()

	// Wait for shutdown
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("shutting down...")
	t.Close()
}
