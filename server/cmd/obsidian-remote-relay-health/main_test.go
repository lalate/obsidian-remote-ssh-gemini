package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
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

func TestConnectStubReturnsNotImplemented(t *testing.T) {
	t.Parallel()

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

		resp := connectResponse{
			OK:        false,
			Code:      "NOT_IMPLEMENTED",
			Message:   "relay connect bridge is not implemented yet; this endpoint is a scaffold",
			RequestID: req.RequestID,
			Received:  req,
		}
		writeJSON(w, http.StatusOK, resp, false)
	})

	body := []byte(`{"requestId":"r1","host":"example.com","port":22,"username":"u","remotePath":"/vault"}`)
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
	if resp.Code != "NOT_IMPLEMENTED" {
		t.Fatalf("expected NOT_IMPLEMENTED, got %q", resp.Code)
	}
	if resp.Received.Host != "example.com" {
		t.Fatalf("unexpected host: %q", resp.Received.Host)
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
