// Command api-go serves the read-only cafe sales API (same contract as ../python/api.py).
//
//	go run .                 # from go/, reads ../.env, listens on :8080
//	go build -o api-go .     # single self-contained binary
package main

import (
	"bufio"
	"database/sql"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

// loadDotEnv reads KEY=VALUE lines from path without overriding variables
// that are already set (same behavior as python-dotenv). A missing file is fine.
func loadDotEnv(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, value)
		}
	}
}

func getenv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func openDB() (*sql.DB, error) {
	cfg := mysql.NewConfig()
	cfg.User = os.Getenv("DB_USER")
	cfg.Passwd = os.Getenv("DB_PASSWORD")
	cfg.DBName = os.Getenv("DB_NAME")
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(getenv("DB_HOST", "127.0.0.1"), getenv("DB_PORT", "3306"))
	cfg.Timeout = 5 * time.Second

	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	return db, nil
}

func main() {
	loadDotEnv("../.env")

	db, err := openDB()
	if err != nil {
		log.Fatalf("database config: %v", err)
	}
	defer db.Close()

	addr := ":" + getenv("PORT", "8080")
	server := &http.Server{
		Addr:              addr,
		Handler:           NewServer(NewSQLRepository(db)),
		ReadHeaderTimeout: 5 * time.Second, // protects against slow-header (Slowloris) clients
	}
	log.Printf("Cafe Sales API (Go) listening on http://127.0.0.1%s", addr)
	log.Fatal(server.ListenAndServe())
}
