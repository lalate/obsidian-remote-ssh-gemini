// Command obsidian-remote-relay-health provides a tiny HTTPS-friendly
// health endpoint for mobile relay reachability checks.
package main

import (
	"crypto/rand"
	"encoding/hex"
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
	"sync"
	"time"

	"github.com/gorilla/websocket"
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
	SessionID         string         `json:"sessionId,omitempty"`
	StreamURL         string         `json:"streamUrl,omitempty"`
	Received          connectRequest `json:"received"`
}

type relaySession struct {
	ID         string
	Target     string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	RequestRef connectRequest
}

type relaySessionStore struct {
	mu       sync.Mutex
	sessions map[string]relaySession
	ttl      time.Duration
}

type streamReadyMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Target    string `json:"target"`
	Message   string `json:"message"`
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
	sessionStore := newRelaySessionStore(5 * time.Minute)
	upgrader := websocket.Upgrader{
		CheckOrigin: func(_ *http.Request) bool { return true },
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
				"stream.ws.stub.v1",
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

		sessionID, issueErr := issueSessionID()
		if issueErr != nil {
			writeJSON(w, http.StatusInternalServerError, errorResponse{Error: "failed to issue relay session"}, false)
			return
		}
		sessionStore.Put(relaySession{
			ID:         sessionID,
			Target:     target,
			CreatedAt:  time.Now(),
			ExpiresAt:  time.Now().Add(sessionStore.ttl),
			RequestRef: req,
		})

		resp := connectResponse{
			OK:                true,
			Code:              "PRECHECK_OK",
			Message:           "tcp precheck to target succeeded; SSH/RPC bridge wiring is the next step",
			RequestID:         strings.TrimSpace(req.RequestID),
			Target:            target,
			PrecheckLatencyMs: latencyMs,
			SessionID:         sessionID,
			StreamURL:         deriveStreamURL(r, sessionID),
			Received:          req,
		}
		writeJSON(w, http.StatusOK, resp, false)
	})

	mux.HandleFunc("/v1/stream/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"}, false)
			return
		}
		if !authorizeRequest(tokenValue, r) {
			writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "unauthorized"}, false)
			return
		}

		sessionID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/v1/stream/"))
		if sessionID == "" {
			writeJSON(w, http.StatusNotFound, errorResponse{Error: "session not found"}, false)
			return
		}

		session, ok := sessionStore.Get(sessionID)
		if !ok {
			writeJSON(w, http.StatusNotFound, errorResponse{Error: "session not found or expired"}, false)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer func() {
			sessionStore.Delete(sessionID)
			_ = conn.Close()
		}()

		targetConn, err := net.DialTimeout("tcp", session.Target, 5*time.Second)
		if err != nil {
			_ = conn.WriteJSON(errorResponse{Error: fmt.Sprintf("failed to connect target %s: %v", session.Target, err)})
			return
		}
		defer func() { _ = targetConn.Close() }()

		streamDone := make(chan struct{})
		var writeMu sync.Mutex
		closeOnce := sync.Once{}
		closeStream := func() {
			closeOnce.Do(func() {
				close(streamDone)
			})
		}

		ready := streamReadyMessage{
			Type:      "session.ready",
			SessionID: sessionID,
			Target:    session.Target,
			Message:   "websocket stream scaffold established",
		}
		if err := conn.WriteJSON(ready); err != nil {
			return
		}

		go func() {
			buf := make([]byte, 32*1024)
			for {
				n, readErr := targetConn.Read(buf)
				if n > 0 {
					writeMu.Lock()
					writeErr := conn.WriteMessage(websocket.BinaryMessage, append([]byte(nil), buf[:n]...))
					writeMu.Unlock()
					if writeErr != nil {
						closeStream()
						return
					}
				}
				if readErr != nil {
					closeStream()
					return
				}
			}
		}()

		for {
			messageType, payload, readErr := conn.ReadMessage()
			if readErr != nil {
				return
			}
			if messageType == websocket.CloseMessage {
				return
			}
			if messageType == websocket.TextMessage {
				// Text frames are reserved for future control messages.
				continue
			}
			if _, writeErr := targetConn.Write(payload); writeErr != nil {
				return
			}
		}
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

func issueSessionID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func deriveStreamURL(r *http.Request, sessionID string) string {
	scheme := "ws"
	if r.TLS != nil {
		scheme = "wss"
	}
	xfp := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")))
	if xfp == "https" {
		scheme = "wss"
	}
	return fmt.Sprintf("%s://%s/v1/stream/%s", scheme, r.Host, sessionID)
}

func newRelaySessionStore(ttl time.Duration) *relaySessionStore {
	return &relaySessionStore{
		sessions: make(map[string]relaySession),
		ttl:      ttl,
	}
}

func (s *relaySessionStore) Put(session relaySession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[session.ID] = session
}

func (s *relaySessionStore) Get(id string) (relaySession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[id]
	if !ok {
		return relaySession{}, false
	}
	if time.Now().After(session.ExpiresAt) {
		delete(s.sessions, id)
		return relaySession{}, false
	}
	return session, true
}

func (s *relaySessionStore) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, id)
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
