package config

import (
	"os"
)

type Config struct {
	ServerURL string
	Token     string
	ServerID  string
}

func Load(path string) *Config {
	cfg := &Config{
		ServerURL: getEnv("SRVLY_SERVER", "wss://platform.example.com/ws"),
		Token:     getEnv("SRVLY_TOKEN", ""),
		ServerID:  getEnv("SRVLY_SERVER_ID", ""),
	}

	if path != "" {
		// TODO: read from YAML file
	}

	return cfg
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
