// Command obsidian-remote-relay-health provides a tiny HTTPS-friendly
// health endpoint for mobile relay reachability checks.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// Version is replaced at link time via -ldflags "-X main.Version=...".
var Version = "0.0.0-dev"

type healthResponse struct {
	OK        bool   `json:"ok"`
	Service   string `json:"service"`
	Version   string `json:"version"`
	Timestamp string `json:"timestamp"`
}

type errorResponse struct {
	Error string `json:"error"`
}

func main() {
	code, err := run(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
	}
	os.Exit(code)
}

func run(args []string) (int, error) {
	fs := flag.NewFlagSet("obsidian-remote-relay-health", flag.ContinueOnError)
	var (
		listenAddr  = fs.String("listen", ":8080", "listen address")
		path        = fs.String("path", "/healthz", "health endpoint path")
		token       = fs.String("token", "", "optional bearer token")
		allowOrigin = fs.String("allow-origin", "*", "CORS allow-origin value")
		versionFlag = fs.Bool("version", false, "print version and exit")
	)
	if err := fs.Parse(args); err != nil {
		return 2, err
	}
	if *versionFlag {
		fmt.Println(Version)
		return 0, nil
	}

	tokenValue := strings.TrimSpace(*token)
	if tokenValue == "" {
		tokenValue = strings.TrimSpace(os.Getenv("RELAY_PROBE_TOKEN"))
	}

	mux := http.NewServeMux()
	endpoint := normalizePath(*path)
	mux.HandleFunc(endpoint, func(w http.ResponseWriter, r *http.Request) {
		setHeaders(w, *allowOrigin)

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"})
			return
		}

		if tokenValue != "" {
			auth := strings.TrimSpace(r.Header.Get("Authorization"))
			expected := "Bearer " + tokenValue
			if auth != expected {
				writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "unauthorized"})
				return
			}
		}

		resp := healthResponse{
			OK:        true,
			Service:   "obsidian-remote-relay-health",
			Version:   Version,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		}
		writeJSON(w, http.StatusOK, resp)
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		setHeaders(w, *allowOrigin)
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "not found"})
	})

	server := &http.Server{
		Addr:              *listenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("obsidian-remote-relay-health %s listening on %s%s", Version, *listenAddr, endpoint)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return 1, err
	}
	return 0, nil
}

func normalizePath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "/healthz"
	}
	if !strings.HasPrefix(trimmed, "/") {
		return "/" + trimmed
	}
	return trimmed
}

func setHeaders(w http.ResponseWriter, allowOrigin string) {
	w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
