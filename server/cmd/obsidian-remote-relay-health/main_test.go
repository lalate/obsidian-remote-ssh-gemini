package main

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func TestValidateConnectRequest(t *testing.T) {
	t.Parallel()

	req := connectRequest{
		Host:       "",
		Port:       70000,
		Username:   "",
		RemotePath: "",
	}
	issues := validateConnectRequest(req)
	if len(issues) != 4 {
		t.Fatalf("expected 4 validation issues, got %d: %v", len(issues), issues)
	}
}

func TestConnectPrecheckReturnsReachable(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	addr := listener.Addr().(*net.TCPAddr)
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			_ = conn.Close()
		}
	}()

	token := "abc123"
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setHeaders(w, "*")
		if !authorizeRequest(token, r) {
			writeJSON(w, http.StatusUnauthorized, errorResponse{Error: "unauthorized"}, false)
			return
		}

		var req connectRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid json payload"}, false)
			return
		}
		if issues := validateConnectRequest(req); len(issues) > 0 {
			writeJSON(w, http.StatusBadRequest, errorResponse{Error: "invalid request", Details: issues}, false)
			return
		}

		if err := precheckTCPTarget(req.Host, req.Port, resolveConnectTimeout(req.TimeoutMs)); err != nil {
			resp := connectResponse{
				OK:        false,
				Code:      "TARGET_UNREACHABLE",
				Message:   err.Error(),
				RequestID: req.RequestID,
				Received:  req,
			}
			writeJSON(w, http.StatusOK, resp, false)
			return
		}

		resp := connectResponse{
			OK:        true,
			Code:      "PRECHECK_OK",
			Message:   "tcp precheck to target succeeded; SSH/RPC bridge wiring is the next step",
			RequestID: req.RequestID,
			Received:  req,
		}
		writeJSON(w, http.StatusOK, resp, false)
	})

	body := []byte(`{"requestId":"r1","host":"127.0.0.1","port":` +
		strconv.Itoa(addr.Port) +
		`,"username":"u","remotePath":"/vault"}`)
	request := httptest.NewRequest(http.MethodPost, "/v1/connect", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer abc123")
	request.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var resp connectResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Code != "PRECHECK_OK" {
		t.Fatalf("expected PRECHECK_OK, got %q", resp.Code)
	}
	if resp.Received.Host != "127.0.0.1" {
		t.Fatalf("unexpected host: %q", resp.Received.Host)
	}
}

func TestPrecheckTCPTargetReachableAndUnreachable(t *testing.T) {
	t.Parallel()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := listener.Addr().(*net.TCPAddr)

	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			_ = conn.Close()
		}
	}()

	if err := precheckTCPTarget("127.0.0.1", addr.Port, 500*time.Millisecond); err != nil {
		t.Fatalf("expected reachable target, got err: %v", err)
	}

	_ = listener.Close()
	if err := precheckTCPTarget("127.0.0.1", addr.Port, 150*time.Millisecond); err == nil {
		t.Fatal("expected unreachable target error, got nil")
	}
}

func TestAuthorizeRequest(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	if !authorizeRequest("", request) {
		t.Fatal("expected auth to pass when token is empty")
	}

	request.Header.Set("Authorization", "Bearer token-x")
	if !authorizeRequest("token-x", request) {
		t.Fatal("expected matching bearer token to pass")
	}
	if authorizeRequest("token-y", request) {
		t.Fatal("expected mismatched bearer token to fail")
	}
}
