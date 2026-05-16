// Command obsidian-remote-relay-health provides a tiny HTTPS-friendly
// health endpoint for mobile relay reachability checks.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
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
	Error   string   `json:"error"`
	Details []string `json:"details,omitempty"`
}

type capabilitiesResponse struct {
	OK           bool     `json:"ok"`
	Service      string   `json:"service"`
	Version      string   `json:"version"`
	Capabilities []string `json:"capabilities"`
}

type connectRequest struct {
	RequestID  string `json:"requestId,omitempty"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	RemotePath string `json:"remotePath"`
	TimeoutMs  int    `json:"timeoutMs,omitempty"`
}

type connectResponse struct {
	OK                bool           `json:"ok"`
	Code              string         `json:"code"`
	Message           string         `json:"message"`
	RequestID         string         `json:"requestId,omitempty"`
	Target            string         `json:"target,omitempty"`
	PrecheckLatencyMs int64          `json:"precheckLatencyMs,omitempty"`
	Received          connectRequest `json:"received"`
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
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"}, false)
			return
		}

		if !authorizeRequest(tokenValue, r) {
			writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "unauthorized"}, r.Method == http.MethodHead)
			return
		}

		resp := healthResponse{
			OK:        true,
			Service:   "obsidian-remote-relay",
			Version:   Version,
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		}
		writeJSON(w, http.StatusOK, resp, r.Method == http.MethodHead)
	})

	mux.HandleFunc("/v1/capabilities", func(w http.ResponseWriter, r *http.Request) {
		setHeaders(w, *allowOrigin)

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"}, false)
			return
		}
		if !authorizeRequest(tokenValue, r) {
			writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "unauthorized"}, false)
			return
		}

		resp := capabilitiesResponse{
			OK:      true,
			Service: "obsidian-remote-relay",
			Version: Version,
			Capabilities: []string{
				"healthz",
				"connect.precheck.v1",
			},
		}
		writeJSON(w, http.StatusOK, resp, false)
	})

	mux.HandleFunc("/v1/connect", func(w http.ResponseWriter, r *http.Request) {
		setHeaders(w, *allowOrigin)

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"}, false)
			return
		}
		if !authorizeRequest(tokenValue, r) {
			writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "unauthorized"}, false)
			return
		}

		decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
		decoder.DisallowUnknownFields()
		var req connectRequest
		if err := decoder.Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid json payload"}, false)
			return
		}

		if issues := validateConnectRequest(req); len(issues) > 0 {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid request", Details: issues}, false)
			return
		}

		target := net.JoinHostPort(strings.TrimSpace(req.Host), strconv.Itoa(req.Port))
		timeout := resolveConnectTimeout(req.TimeoutMs)
		started := time.Now()
		err := precheckTCPTarget(strings.TrimSpace(req.Host), req.Port, timeout)
		latencyMs := time.Since(started).Milliseconds()

		if err != nil {
			resp := connectResponse{
				OK:                false,
				Code:              "TARGET_UNREACHABLE",
				Message:           fmt.Sprintf("tcp precheck failed for %s: %v", target, err),
				RequestID:         strings.TrimSpace(req.RequestID),
				Target:            target,
				PrecheckLatencyMs: latencyMs,
				Received:          req,
			}
			writeJSON(w, http.StatusOK, resp, false)
			return
		}

		resp := connectResponse{
			OK:                true,
			Code:              "PRECHECK_OK",
			Message:           "tcp precheck to target succeeded; SSH/RPC bridge wiring is the next step",
			RequestID:         strings.TrimSpace(req.RequestID),
			Target:            target,
			PrecheckLatencyMs: latencyMs,
			Received:          req,
		}
		writeJSON(w, http.StatusOK, resp, false)
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		setHeaders(w, *allowOrigin)
		writeJSON(w, http.StatusNotFound, errorResponse{Error: "not found"}, false)
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

func authorizeRequest(tokenValue string, r *http.Request) bool {
	if tokenValue == "" {
		return true
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	expected := "Bearer " + tokenValue
	return auth == expected
}

func validateConnectRequest(req connectRequest) []string {
	issues := make([]string, 0, 4)
	if strings.TrimSpace(req.Host) == "" {
		issues = append(issues, "host is required")
	}
	if req.Port < 1 || req.Port > 65535 {
		issues = append(issues, "port must be between 1 and 65535")
	}
	if strings.TrimSpace(req.Username) == "" {
		issues = append(issues, "username is required")
	}
	if strings.TrimSpace(req.RemotePath) == "" {
		issues = append(issues, "remotePath is required")
	}
	if req.TimeoutMs < 0 {
		issues = append(issues, "timeoutMs must be >= 0")
	}
	return issues
}

func resolveConnectTimeout(timeoutMs int) time.Duration {
	if timeoutMs <= 0 {
		return 3 * time.Second
	}
	if timeoutMs > 15000 {
		return 15 * time.Second
	}
	return time.Duration(timeoutMs) * time.Millisecond
}

func precheckTCPTarget(host string, port int, timeout time.Duration) error {
	target := net.JoinHostPort(strings.TrimSpace(host), strconv.Itoa(port))
	dialer := net.Dialer{Timeout: timeout}
	conn, err := dialer.Dial("tcp", target)
	if err != nil {
		return err
	}
	_ = conn.Close()
	return nil
}

func setHeaders(w http.ResponseWriter, allowOrigin string) {
	w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
}

func writeJSON(w http.ResponseWriter, status int, payload any, omitBody bool) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if omitBody {
		return
	}
	_ = json.NewEncoder(w).Encode(payload)
}
