// Command obsidian-remote-relay-health provides a tiny HTTPS-friendly
// health endpoint for mobile relay reachability checks.
package main

import (
	"bufio"
	"crypto/rand"
	"encoding/base64"
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
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	rpcframe "github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// Version is replaced at link time via -ldflags "-X main.Version=...".
var Version = "0.0.0-dev"

const (
	relayRPCModeStub   = "stub"
	relayRPCModeFramed = "framed"
	relayRPCModeSSH    = "ssh-framed"
)

type relaySSHBridgeConfig struct {
	SocketPath            string
	TokenPath             string
	PrivateKey            string
	PrivateKeyBase64      string
	PrivateKeyFile        string
	Password              string
	KnownHostsFile        string
	InsecureIgnoreHostKey bool
	SSHConnectTimeout     time.Duration
}

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
	rpcState   *relayRpcState
}

type relayRpcState struct {
	mu            sync.Mutex
	authenticated bool
	files         map[string]string
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
		rpcMode     = fs.String("rpc-mode", "", "relay rpc mode: stub|framed (default from RELAY_RPC_MODE or stub)")
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
	rpcModeValue := resolveRelayRPCMode(*rpcMode)
	sshBridgeCfg := resolveRelaySSHBridgeConfig()
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

		capabilities := []string{"healthz", "connect.precheck.v1"}
		if rpcModeValue == relayRPCModeFramed {
			capabilities = append(capabilities, "stream.ws.framed-rpc.v1")
		} else if rpcModeValue == relayRPCModeSSH {
			capabilities = append(capabilities, "stream.ws.ssh-framed-rpc.v1")
		} else {
			capabilities = append(capabilities, "stream.ws.stub.v1")
		}

		resp := capabilitiesResponse{
			OK:           true,
			Service:      "obsidian-remote-relay",
			Version:      Version,
			Capabilities: capabilities,
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
		if cfgErr := validateRelayModeConfig(rpcModeValue, req, sshBridgeCfg); cfgErr != nil {
			resp := connectResponse{
				OK:        false,
				Code:      "RELAY_CONFIG_ERROR",
				Message:   cfgErr.Error(),
				RequestID: strings.TrimSpace(req.RequestID),
				Received:  req,
			}
			writeJSON(w, http.StatusOK, resp, false)
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
			rpcState:   newRelayRpcState(),
		})

		resp := connectResponse{
			OK:                true,
			Code:              "PRECHECK_OK",
			Message:           connectSuccessMessage(rpcModeValue),
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
			log.Printf("stream upgrade failed session=%s remote=%s err=%v", sessionID, r.RemoteAddr, err)
			return
		}
		defer func() {
			sessionStore.Delete(sessionID)
			_ = conn.Close()
		}()

		targetConn, targetClose, upstreamAuthToken, err := openRelayUpstreamConn(session, rpcModeValue, sshBridgeCfg)
		if err != nil {
			log.Printf("stream upstream connect failed session=%s target=%s mode=%s err=%v", sessionID, session.Target, rpcModeValue, err)
			_ = conn.WriteJSON(errorResponse{Error: fmt.Sprintf("failed to connect target %s: %v", session.Target, err)})
			return
		}
		defer func() {
			_ = targetConn.Close()
			if targetClose != nil {
				targetClose()
			}
		}()

		ready := streamReadyMessage{
			Type:      "session.ready",
			SessionID: sessionID,
			Target:    session.Target,
			Message:   "websocket stream scaffold established",
		}
		if err := conn.WriteJSON(ready); err != nil {
			log.Printf("stream ready write failed session=%s err=%v", sessionID, err)
			return
		}

		if rpcModeValue == relayRPCModeFramed || rpcModeValue == relayRPCModeSSH {
			if err := proxyRelayRPCFramed(sessionID, conn, targetConn, upstreamAuthToken, strings.TrimSpace(session.RequestRef.RemotePath)); err != nil {
				log.Printf("relay rpc framed session %s closed: %v", sessionID, err)
			}
			return
		}

		streamDone := make(chan struct{})
		var writeMu sync.Mutex
		closeOnce := sync.Once{}
		closeStream := func() {
			closeOnce.Do(func() {
				close(streamDone)
			})
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
				if handleRelayRPCTextFrame(conn, session, payload) {
					continue
				}
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

	log.Printf("obsidian-remote-relay-health %s listening on %s%s (rpc-mode=%s)", Version, *listenAddr, endpoint, rpcModeValue)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return 1, err
	}
	return 0, nil
}

func resolveRelayRPCMode(flagValue string) string {
	mode := strings.ToLower(strings.TrimSpace(flagValue))
	if mode == "" {
		mode = strings.ToLower(strings.TrimSpace(os.Getenv("RELAY_RPC_MODE")))
	}
	switch mode {
	case "", relayRPCModeStub:
		return relayRPCModeStub
	case relayRPCModeFramed:
		return relayRPCModeFramed
	case relayRPCModeSSH:
		return relayRPCModeSSH
	default:
		log.Printf("unknown rpc mode %q; fallback to %q", mode, relayRPCModeStub)
		return relayRPCModeStub
	}
}

func connectSuccessMessage(rpcMode string) string {
	if rpcMode == relayRPCModeFramed {
		return "tcp precheck to target succeeded; relay will proxy JSON-RPC frames to upstream"
	}
	if rpcMode == relayRPCModeSSH {
		return "tcp precheck to target succeeded; relay will proxy JSON-RPC frames via SSH unix-socket bridge"
	}
	return "tcp precheck to target succeeded; SSH/RPC bridge wiring is the next step"
}

func resolveRelaySSHBridgeConfig() relaySSHBridgeConfig {
	return relaySSHBridgeConfig{
		SocketPath:            resolveDefaultEnv("RELAY_SSH_SOCKET_PATH", "~/.obsidian-remote/server.sock"),
		TokenPath:             resolveDefaultEnv("RELAY_SSH_TOKEN_PATH", "~/.obsidian-remote/token"),
		PrivateKey:            strings.TrimSpace(os.Getenv("RELAY_SSH_PRIVATE_KEY")),
		PrivateKeyBase64:      strings.TrimSpace(os.Getenv("RELAY_SSH_PRIVATE_KEY_BASE64")),
		PrivateKeyFile:        strings.TrimSpace(os.Getenv("RELAY_SSH_PRIVATE_KEY_FILE")),
		Password:              strings.TrimSpace(os.Getenv("RELAY_SSH_PASSWORD")),
		KnownHostsFile:        strings.TrimSpace(os.Getenv("RELAY_SSH_KNOWN_HOSTS_FILE")),
		InsecureIgnoreHostKey: parseEnvBool("RELAY_SSH_INSECURE_IGNORE_HOST_KEY", true),
		SSHConnectTimeout:     resolveEnvDurationMS("RELAY_SSH_CONNECT_TIMEOUT_MS", 5000),
	}
}

func validateRelayModeConfig(rpcMode string, req connectRequest, cfg relaySSHBridgeConfig) error {
	if rpcMode != relayRPCModeSSH {
		return nil
	}
	if strings.TrimSpace(req.Username) == "" {
		return errors.New("rpc-mode=ssh-framed requires request.username as SSH user")
	}
	if !cfg.hasAuthMethod() {
		return errors.New("rpc-mode=ssh-framed requires RELAY_SSH_PRIVATE_KEY(_BASE64|_FILE) or RELAY_SSH_PASSWORD")
	}
	if !cfg.InsecureIgnoreHostKey && strings.TrimSpace(cfg.KnownHostsFile) == "" {
		return errors.New("rpc-mode=ssh-framed requires RELAY_SSH_KNOWN_HOSTS_FILE when RELAY_SSH_INSECURE_IGNORE_HOST_KEY=false")
	}
	return nil
}

func openRelayUpstreamConn(session relaySession, rpcMode string, cfg relaySSHBridgeConfig) (net.Conn, func(), string, error) {
	if rpcMode != relayRPCModeSSH {
		conn, err := net.DialTimeout("tcp", session.Target, 5*time.Second)
		if err != nil {
			return nil, nil, "", err
		}
		return conn, nil, "", nil
	}
	return dialRelaySSHUnixSocket(session, cfg)
}

func dialRelaySSHUnixSocket(session relaySession, cfg relaySSHBridgeConfig) (net.Conn, func(), string, error) {
	sshUser := strings.TrimSpace(session.RequestRef.Username)
	if sshUser == "" {
		return nil, nil, "", errors.New("missing ssh username")
	}

	authMethods, authErr := cfg.authMethods()
	if authErr != nil {
		return nil, nil, "", authErr
	}
	hostKeyCallback, hostKeyErr := cfg.hostKeyCallback()
	if hostKeyErr != nil {
		return nil, nil, "", hostKeyErr
	}

	client, err := ssh.Dial("tcp", session.Target, &ssh.ClientConfig{
		User:            sshUser,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
		Timeout:         cfg.SSHConnectTimeout,
	})
	if err != nil {
		return nil, nil, "", fmt.Errorf("ssh dial failed (user=%s target=%s): %w", sshUser, session.Target, err)
	}

	tokenPath := resolveRelayRemoteTokenPath(cfg.TokenPath, sshUser)
	upstreamToken, tokenErr := fetchRelayDaemonToken(client, tokenPath)
	if tokenErr != nil {
		_ = client.Close()
		return nil, nil, "", fmt.Errorf("token fetch failed (user=%s path=%s): %w", sshUser, tokenPath, tokenErr)
	}

	socketPath := resolveRelayRemoteSocketPath(cfg.SocketPath, sshUser)
	conn, err := client.Dial("unix", socketPath)
	if err != nil {
		_ = client.Close()
		return nil, nil, "", fmt.Errorf("ssh dial unix socket failed (user=%s path=%s): %w", sshUser, socketPath, err)
	}
	return conn, func() { _ = client.Close() }, upstreamToken, nil
}

func resolveRelayRemoteSocketPath(rawPath string, sshUser string) string {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		trimmed = "~/.obsidian-remote/server.sock"
	}
	if strings.HasPrefix(trimmed, "~/") {
		return "/home/" + sshUser + trimmed[1:]
	}
	return trimmed
}

func resolveRelayRemoteTokenPath(rawPath string, sshUser string) string {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		trimmed = "~/.obsidian-remote/token"
	}
	if strings.HasPrefix(trimmed, "~/") {
		return "/home/" + sshUser + trimmed[1:]
	}
	return trimmed
}

func fetchRelayDaemonToken(client *ssh.Client, tokenPath string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("ssh new session failed: %w", err)
	}
	defer func() { _ = session.Close() }()

	out, err := session.Output("cat " + shellSingleQuote(tokenPath))
	if err != nil {
		return "", fmt.Errorf("read relay token failed (%s): %w", tokenPath, err)
	}
	token := strings.TrimSpace(string(out))
	if token == "" {
		return "", fmt.Errorf("relay token file is empty: %s", tokenPath)
	}
	return token, nil
}

func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

func (cfg relaySSHBridgeConfig) hasAuthMethod() bool {
	if strings.TrimSpace(cfg.Password) != "" {
		return true
	}
	if strings.TrimSpace(cfg.PrivateKey) != "" {
		return true
	}
	if strings.TrimSpace(cfg.PrivateKeyBase64) != "" {
		return true
	}
	if strings.TrimSpace(cfg.PrivateKeyFile) != "" {
		return true
	}
	return false
}

func (cfg relaySSHBridgeConfig) authMethods() ([]ssh.AuthMethod, error) {
	methods := make([]ssh.AuthMethod, 0, 2)
	keyPEM, err := cfg.resolvePrivateKeyPEM()
	if err != nil {
		return nil, err
	}
	if keyPEM != "" {
		signer, signerErr := ssh.ParsePrivateKey([]byte(keyPEM))
		if signerErr != nil {
			return nil, fmt.Errorf("invalid private key: %w", signerErr)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}
	if strings.TrimSpace(cfg.Password) != "" {
		methods = append(methods, ssh.Password(cfg.Password))
		methods = append(methods, ssh.KeyboardInteractive(
			func(_ string, _ string, questions []string, _ []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range questions {
					answers[i] = cfg.Password
				}
				return answers, nil
			},
		))
	}
	if len(methods) == 0 {
		return nil, errors.New("no ssh auth method configured")
	}
	return methods, nil
}

func (cfg relaySSHBridgeConfig) resolvePrivateKeyPEM() (string, error) {
	if s := strings.TrimSpace(cfg.PrivateKey); s != "" {
		return s, nil
	}
	if s := strings.TrimSpace(cfg.PrivateKeyBase64); s != "" {
		decoded, err := base64.StdEncoding.DecodeString(s)
		if err != nil {
			return "", fmt.Errorf("RELAY_SSH_PRIVATE_KEY_BASE64 decode failed: %w", err)
		}
		return strings.TrimSpace(string(decoded)), nil
	}
	if p := strings.TrimSpace(cfg.PrivateKeyFile); p != "" {
		content, err := os.ReadFile(p)
		if err != nil {
			return "", fmt.Errorf("read private key file failed: %w", err)
		}
		return strings.TrimSpace(string(content)), nil
	}
	return "", nil
}

func (cfg relaySSHBridgeConfig) hostKeyCallback() (ssh.HostKeyCallback, error) {
	if !cfg.InsecureIgnoreHostKey {
		return knownhosts.New(cfg.KnownHostsFile)
	}
	if strings.TrimSpace(cfg.KnownHostsFile) != "" {
		cb, err := knownhosts.New(cfg.KnownHostsFile)
		if err == nil {
			return cb, nil
		}
		log.Printf("known_hosts load failed (%s), fallback to insecure host key callback: %v", cfg.KnownHostsFile, err)
	}
	return ssh.InsecureIgnoreHostKey(), nil
}

func resolveDefaultEnv(key string, fallback string) string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v
}

func parseEnvBool(key string, fallback bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func resolveEnvDurationMS(key string, fallbackMs int) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return time.Duration(fallbackMs) * time.Millisecond
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return time.Duration(fallbackMs) * time.Millisecond
	}
	return time.Duration(n) * time.Millisecond
}

func proxyRelayRPCFramed(sessionID string, conn *websocket.Conn, targetConn net.Conn, upstreamAuthToken string, remotePath string) error {
	reader := bufio.NewReader(targetConn)
	for {
		messageType, payload, readErr := conn.ReadMessage()
		if readErr != nil {
			return readErr
		}
		if messageType == websocket.CloseMessage {
			return nil
		}
		if messageType != websocket.TextMessage {
			_ = conn.WriteJSON(errorResponse{Error: "rpc-mode=framed supports text websocket frames only"})
			continue
		}

		var req relayJSONRPCRequest
		if err := json.Unmarshal(payload, &req); err != nil {
			writeRelayRPCError(conn, nil, "invalid json-rpc payload")
			continue
		}
		reqID := req.ID
		if strings.TrimSpace(req.Method) == "" {
			writeRelayRPCError(conn, reqID, "invalid json-rpc request: method is required")
			continue
		}
		originalMethod := req.Method

		rewritten, rewriteErr := rewriteRelayAuthRequest(payload, upstreamAuthToken)
		if rewriteErr != nil {
			if req.Method == "auth" {
				log.Printf("relay rpc auth rewrite failed session=%s err=%v", sessionID, rewriteErr)
			}
			writeRelayRPCError(conn, reqID, rewriteErr.Error())
			continue
		}
		if len(rewritten) > 0 {
			payload = rewritten
			if req.Method == "auth" {
				log.Printf("relay rpc auth rewrite applied session=%s", sessionID)
			}
		}

		compatRewritten, compatErr := rewriteRelayCompatRequest(payload, remotePath)
		if compatErr != nil {
			writeRelayRPCError(conn, reqID, compatErr.Error())
			continue
		}
		if len(compatRewritten) > 0 {
			payload = compatRewritten
			if originalMethod == "fs.read" {
				log.Printf("relay rpc fs.read rewrite applied session=%s", sessionID)
			}
		}

		if err := rpcframe.WriteFrame(targetConn, payload); err != nil {
			if req.Method == "auth" {
				log.Printf("relay rpc auth upstream write failed session=%s err=%v", sessionID, err)
			}
			writeRelayRPCError(conn, reqID, fmt.Sprintf("failed to write upstream rpc frame: %v", err))
			continue
		}

		responsePayload, err := readRelayRPCUpstreamFrame(reader, conn)
		if err != nil {
			if req.Method == "auth" {
				log.Printf("relay rpc auth upstream read failed session=%s err=%v", sessionID, err)
			}
			writeRelayRPCError(conn, reqID, fmt.Sprintf("failed to read upstream rpc frame: %v", err))
			continue
		}
		if len(responsePayload) == 0 {
			continue
		}
		if req.Method == "auth" {
			normalized, normErr := normalizeRelayAuthResponse(responsePayload)
			if normErr != nil {
				log.Printf("relay rpc auth upstream normalize failed session=%s err=%v", sessionID, normErr)
			} else {
				responsePayload = normalized
			}
			logRelayAuthResponseSummary(sessionID, responsePayload)
		}
		if originalMethod == "fs.read" {
			normalized, normErr := normalizeRelayFsReadResponse(responsePayload, req.Params)
			if normErr != nil {
				log.Printf("relay rpc fs.read normalize failed session=%s err=%v", sessionID, normErr)
			} else {
				responsePayload = normalized
			}
		}
		if err := conn.WriteMessage(websocket.TextMessage, responsePayload); err != nil {
			return err
		}
	}
}

func rewriteRelayCompatRequest(payload []byte, remotePath string) ([]byte, error) {
	var req relayJSONRPCRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid compatibility rewrite payload: %w", err)
	}

	if changed, err := relativizeRelayPathParam(&req, remotePath); err != nil {
		return nil, err
	} else if changed {
		rewritten, marshalErr := json.Marshal(req)
		if marshalErr != nil {
			return nil, fmt.Errorf("compatibility rewrite marshal failed: %w", marshalErr)
		}
		payload = rewritten
	}

	if req.Method != "fs.read" {
		if len(payload) > 0 {
			return payload, nil
		}
		return nil, nil
	}
	req.Method = "fs.readText"
	rewritten, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("compatibility rewrite marshal failed: %w", err)
	}
	return rewritten, nil
}

func relativizeRelayPathParam(req *relayJSONRPCRequest, remotePath string) (bool, error) {
	switch req.Method {
	case "fs.read", "fs.readText", "fs.write":
	default:
		return false, nil
	}

	if strings.TrimSpace(remotePath) == "" {
		return false, nil
	}

	params := map[string]any{}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return false, nil
	}
	rawPath, ok := params["path"].(string)
	if !ok {
		return false, nil
	}
	relPath, changed := relativizeRelayPath(rawPath, remotePath)
	if !changed {
		return false, nil
	}
	params["path"] = relPath
	marshaled, err := json.Marshal(params)
	if err != nil {
		return false, fmt.Errorf("compatibility rewrite marshal params failed: %w", err)
	}
	req.Params = marshaled
	return true, nil
}

func relativizeRelayPath(inputPath string, remotePath string) (string, bool) {
	in := strings.TrimSpace(strings.ReplaceAll(inputPath, "\\", "/"))
	root := strings.TrimSpace(strings.ReplaceAll(remotePath, "\\", "/"))
	if in == "" || root == "" {
		return inputPath, false
	}
	in = path.Clean(in)
	root = path.Clean(root)
	if !strings.HasPrefix(in, "/") {
		return inputPath, false
	}
	if in == root {
		return ".", true
	}
	prefix := root + "/"
	if strings.HasPrefix(in, prefix) {
		return strings.TrimPrefix(in, prefix), true
	}
	return inputPath, false
}

func normalizeRelayAuthResponse(payload []byte) ([]byte, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, fmt.Errorf("unmarshal envelope: %w", err)
	}
	if errRaw, ok := envelope["error"]; ok && len(errRaw) > 0 && string(errRaw) != "null" {
		return payload, nil
	}
	resultRaw, ok := envelope["result"]
	if !ok || len(resultRaw) == 0 || string(resultRaw) == "null" {
		return payload, nil
	}

	result := map[string]any{}
	if err := json.Unmarshal(resultRaw, &result); err != nil {
		return payload, nil
	}
	if v, ok := result["status"]; ok {
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			return payload, nil
		}
	}
	if okValue, ok := result["ok"].(bool); ok {
		if okValue {
			result["status"] = "success"
		} else {
			result["status"] = "failed"
		}
	} else {
		return payload, nil
	}

	normalizedResultRaw, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("marshal normalized result: %w", err)
	}
	envelope["result"] = normalizedResultRaw
	normalizedPayload, err := json.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("marshal normalized envelope: %w", err)
	}
	return normalizedPayload, nil
}

func normalizeRelayFsReadResponse(payload []byte, requestParams json.RawMessage) ([]byte, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return nil, fmt.Errorf("unmarshal envelope: %w", err)
	}
	if errRaw, ok := envelope["error"]; ok && len(errRaw) > 0 && string(errRaw) != "null" {
		return payload, nil
	}
	resultRaw, ok := envelope["result"]
	if !ok || len(resultRaw) == 0 || string(resultRaw) == "null" {
		return payload, nil
	}

	result := map[string]any{}
	if err := json.Unmarshal(resultRaw, &result); err != nil {
		return payload, nil
	}
	if _, ok := result["path"]; ok {
		return payload, nil
	}

	var params struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(requestParams, &params); err != nil {
		return payload, nil
	}
	if strings.TrimSpace(params.Path) == "" {
		return payload, nil
	}
	result["path"] = params.Path

	normalizedResultRaw, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("marshal normalized result: %w", err)
	}
	envelope["result"] = normalizedResultRaw
	normalizedPayload, err := json.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("marshal normalized envelope: %w", err)
	}
	return normalizedPayload, nil
}

func logRelayAuthResponseSummary(sessionID string, payload []byte) {
	var envelope struct {
		Result struct {
			Status string `json:"status"`
		} `json:"result"`
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		log.Printf("relay rpc auth upstream response parse failed session=%s err=%v", sessionID, err)
		return
	}
	if envelope.Error != nil {
		log.Printf("relay rpc auth upstream error session=%s code=%d message=%q", sessionID, envelope.Error.Code, envelope.Error.Message)
		return
	}
	log.Printf("relay rpc auth upstream result session=%s status=%q", sessionID, strings.TrimSpace(envelope.Result.Status))
}

func rewriteRelayAuthRequest(payload []byte, upstreamAuthToken string) ([]byte, error) {
	if strings.TrimSpace(upstreamAuthToken) == "" {
		return nil, nil
	}
	var req relayJSONRPCRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, fmt.Errorf("invalid auth rewrite payload: %w", err)
	}
	if req.Method != "auth" {
		return nil, nil
	}
	paramsRaw, err := json.Marshal(map[string]string{"token": upstreamAuthToken})
	if err != nil {
		return nil, fmt.Errorf("auth rewrite marshal failed: %w", err)
	}
	req.Params = paramsRaw
	rewritten, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("auth rewrite marshal failed: %w", err)
	}
	return rewritten, nil
}

func readRelayRPCUpstreamFrame(reader *bufio.Reader, conn *websocket.Conn) ([]byte, error) {
	for {
		payload, err := rpcframe.ReadFrame(reader, 0)
		if err != nil {
			return nil, err
		}
		if isRelayRPCNotification(payload) {
			if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
				return nil, err
			}
			continue
		}
		return payload, nil
	}
}

func isRelayRPCNotification(payload []byte) bool {
	var envelope struct {
		Method string          `json:"method"`
		ID     json.RawMessage `json:"id"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return false
	}
	if strings.TrimSpace(envelope.Method) == "" {
		return false
	}
	return len(envelope.ID) == 0 || string(envelope.ID) == "null"
}

func extractRelayRPCID(payload []byte) json.RawMessage {
	var req relayJSONRPCRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil
	}
	return req.ID
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

func newRelayRpcState() *relayRpcState {
	return &relayRpcState{files: map[string]string{}}
}

type relayJSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type relayJSONRPCResponse struct {
	JSONRPC string             `json:"jsonrpc"`
	ID      json.RawMessage    `json:"id,omitempty"`
	Result  any                `json:"result,omitempty"`
	Error   *relayJSONRPCError `json:"error,omitempty"`
}

type relayJSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func handleRelayRPCTextFrame(conn *websocket.Conn, session relaySession, payload []byte) bool {
	var req relayJSONRPCRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		writeRelayRPCError(conn, nil, fmt.Sprintf("invalid json-rpc payload: %v", err))
		return true
	}
	if req.Method == "" {
		writeRelayRPCError(conn, req.ID, "invalid json-rpc request: method is required")
		return true
	}

	state := session.rpcState
	if state == nil {
		state = newRelayRpcState()
	}

	switch req.Method {
	case "auth":
		state.mu.Lock()
		state.authenticated = true
		state.mu.Unlock()
		writeRelayRPCResult(conn, req.ID, map[string]any{"ok": true, "status": "success"})
		return true
	case "server.info":
		writeRelayRPCResult(conn, req.ID, map[string]any{
			"name":            "obsidian-remote-relay",
			"version":         Version,
			"protocolVersion": 1,
			"capabilities":    []string{"auth", "server.info", "fs.write", "fs.read"},
		})
		return true
	case "fs.write":
		var params struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			writeRelayRPCError(conn, req.ID, fmt.Sprintf("invalid fs.write params: %v", err))
			return true
		}
		path := strings.TrimSpace(params.Path)
		if path == "" {
			writeRelayRPCError(conn, req.ID, "invalid fs.write params: path is required")
			return true
		}
		state.mu.Lock()
		state.files[path] = params.Content
		state.mu.Unlock()
		log.Printf("Writing to %s: %s", path, params.Content)
		writeRelayRPCResult(conn, req.ID, map[string]any{"ok": true, "path": path})
		return true
	case "fs.read":
		var params struct {
			Path string `json:"path"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			writeRelayRPCError(conn, req.ID, fmt.Sprintf("invalid fs.read params: %v", err))
			return true
		}
		path := strings.TrimSpace(params.Path)
		if path == "" {
			writeRelayRPCError(conn, req.ID, "invalid fs.read params: path is required")
			return true
		}
		state.mu.Lock()
		content, ok := state.files[path]
		state.mu.Unlock()
		if !ok {
			writeRelayRPCError(conn, req.ID, fmt.Sprintf("invalid fs.read params: file not found: %s", path))
			return true
		}
		writeRelayRPCResult(conn, req.ID, map[string]any{"path": path, "content": content})
		return true
	default:
		writeRelayRPCError(conn, req.ID, fmt.Sprintf("method not found: %s", req.Method))
		return true
	}
}

func writeRelayRPCResult(conn *websocket.Conn, id json.RawMessage, result any) {
	if len(id) == 0 || string(id) == "null" {
		return
	}
	_ = conn.WriteJSON(relayJSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	})
}

func writeRelayRPCError(conn *websocket.Conn, id json.RawMessage, message string) {
	if len(id) == 0 || string(id) == "null" {
		return
	}
	_ = conn.WriteJSON(relayJSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &relayJSONRPCError{
			Code:    -32602,
			Message: message,
		},
	})
}
