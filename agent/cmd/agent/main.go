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
	var configPath string
	flag.StringVar(&configPath, "config", "", "path to config file")
	flag.Parse()

	cfg := config.Load(configPath)
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
