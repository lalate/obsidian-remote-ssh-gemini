// Package ws implements a WebSocket-over-TCP transport for the
// JSON-RPC 2.0 dispatcher. It mirrors the unix-socket server.Server but
// uses gorilla/websocket for framing so mobile clients (iOS/Android over
// Tailscale) can connect directly without an SSH tunnel or relay server.
//
// Each WebSocket text message is one complete JSON-RPC 2.0 request or
// notification (no Content-Length framing — the WebSocket protocol
// already delimits messages). The server reads, dispatches via the same
// *rpc.Dispatcher the unix-socket server uses, and writes raw JSON
// response/notification text frames back.
package ws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"

	"github.com/gorilla/websocket"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/auth"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/rpc"
	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/server"
)

// SubscriptionCleaner drops watcher subscriptions when a session closes.
// The same interface as server.SubscriptionCleaner so the caller can
// pass the same watcher cleaner.
type SubscriptionCleaner = server.SubscriptionCleaner

// Options configure a WebSocket server.
type Options struct {
	// Token is the shared secret a client must present via the auth
	// method before any non-auth fs.* call succeeds.
	Token auth.Token

	// Logger is used for connection-level events. When nil messages
	// are discarded.
	Logger *slog.Logger

	// SubscriptionCleaner is invoked when a connection closes to drop
	// watcher subscriptions the session registered. Nil is fine.
	SubscriptionCleaner SubscriptionCleaner
}

// Server accepts WebSocket connections on a TCP listener and runs the
// same RPC dispatch loop as the unix-socket server, sharing the same
// dispatcher instance so all handler registrations are visible to both
// transports.
type Server struct {
	opts       Options
	dispatcher *rpc.Dispatcher
	log        *slog.Logger

	upgrader websocket.Upgrader
	connCount atomic.Int64
}

// New returns a WebSocket server wired to the given dispatcher. The
// caller must pass the same dispatcher returned by the unix-socket
// server so handler registrations are shared.
func New(dispatcher *rpc.Dispatcher, opts Options) *Server {
	if opts.Logger == nil {
		opts.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &Server{
		opts:       opts,
		dispatcher: dispatcher,
		log:        opts.Logger,
		upgrader: websocket.Upgrader{
			// Allow connections from any origin — the daemon sits
			// behind Tailscale and the origin header is meaningless
			// there.
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// Serve accepts HTTP connections on l, upgrades them to WebSocket, and
// runs the dispatch loop for each. Blocks until the listener returns an
// error or ctx is cancelled; if the listener is closed (e.g. on
// shutdown), Serve returns nil. Multiple concurrent connections are
// allowed.
func (s *Server) Serve(ctx context.Context, l net.Listener) error {
	srv := &http.Server{
		Handler: s,
		// ReadHeaderTimeout mirrors the upstream server's courtesy:
		// don't let a slow HTTP client hold a goroutine forever.
		ReadHeaderTimeout: 0, // websocket.Upgrader handles its own deadlines
	}

	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()

	if err := srv.Serve(l); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("ws serve: %w", err)
	}
	return nil
}

// ServeHTTP implements http.Handler — routes GET /token to a JSON
// token endpoint and everything else to WebSocket upgrade.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Expose the auth token via GET /token so mobile clients can
	// discover it automatically (over Tailscale) without manually
	// copying from the server's token file.
	if r.Method == http.MethodGet && r.URL.Path == "/token" {
		s.serveToken(w, r)
		return
	}

	s.serveWebSocket(w, r)
}

// serveToken writes the daemon's auth token as JSON: {"token":"..."}.
func (s *Server) serveToken(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := struct {
		Token string `json:"token"`
	}{Token: string(s.opts.Token)}
	_ = json.NewEncoder(w).Encode(resp)
}

// serveWebSocket upgrades the HTTP connection to WebSocket and runs the
// JSON-RPC dispatch loop for its lifetime.
func (s *Server) serveWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.log.Warn("ws upgrade", "err", err.Error(), "remote", r.RemoteAddr)
		return
	}

	connID := s.connCount.Add(1)
	log := s.log.With("ws_conn", connID, "remote", r.RemoteAddr)
	log.Info("ws connection opened")

	session := server.NewSession()
	defer func() {
		if s.opts.SubscriptionCleaner != nil {
			s.opts.SubscriptionCleaner.CleanupSubscriptions(session.SubscriptionIDs())
		}
		_ = conn.Close()
		log.Info("ws connection closed")
	}()

	var writeMu sync.Mutex
	session.SetNotifier(func(method string, params interface{}, meta *proto.Meta) error {
		paramsBytes, err := json.Marshal(params)
		if err != nil {
			return fmt.Errorf("ws: marshal notification params: %w", err)
		}
		envelope := proto.Notification{
			JSONRPC: proto.JSONRPCVersion,
			Method:  method,
			Params:  paramsBytes,
			Meta:    meta,
		}
		body, err := json.Marshal(envelope)
		if err != nil {
			return fmt.Errorf("ws: marshal notification: %w", err)
		}
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteMessage(websocket.TextMessage, body)
	})

	ctx := context.Background()
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return
			}
			if errors.Is(err, net.ErrClosed) {
				return
			}
			log.Warn("ws read error", "err", err.Error())
			return
		}

		callCtx := server.WithSession(ctx, session)
		reply := s.dispatcher.Process(callCtx, message)
		if reply == nil {
			continue
		}

		writeMu.Lock()
		err = conn.WriteMessage(websocket.TextMessage, reply)
		writeMu.Unlock()
		if err != nil {
			log.Warn("ws write error", "err", err.Error())
			return
		}
	}
}
