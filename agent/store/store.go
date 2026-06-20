package store

import (
	"context"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func New() *Store {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Println("store: DATABASE_URL not set — running without persistence")
		return &Store{}
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Printf("store: cannot connect: %v — running without persistence", err)
		return &Store{}
	}

	log.Println("store: connected to database")
	return &Store{pool: pool}
}

func (s *Store) SetServerConnected(token string) {
	if s.pool == nil {
		return
	}
	_, err := s.pool.Exec(context.Background(),
		"UPDATE servers SET status = 'connected', last_seen = NOW() WHERE agent_token = $1",
		token,
	)
	if err != nil {
		log.Printf("store: failed to set connected: %v", err)
	} else {
		log.Printf("store: server connected (via token)")
	}
}

func (s *Store) SetServerDisconnected(token string) {
	if s.pool == nil {
		return
	}
	_, err := s.pool.Exec(context.Background(),
		"UPDATE servers SET status = 'disconnected' WHERE agent_token = $1 AND status = 'connected'",
		token,
	)
	if err != nil {
		log.Printf("store: failed to set disconnected: %v", err)
	} else {
		log.Printf("store: server disconnected (via token)")
	}
}

func (s *Store) Close() {
	if s.pool != nil {
		s.pool.Close()
	}
}
