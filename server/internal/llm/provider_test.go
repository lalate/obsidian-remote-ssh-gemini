package llm

import (
	"context"
	"testing"

	"github.com/sotashimozono/obsidian-remote-ssh/server/internal/proto"
)

func TestOpenCodeProvider_SessionFieldName(t *testing.T) {
	p := &OpenCodeProvider{}
	if got := p.SessionFieldName(); got != "ai_opencode_session" {
		t.Errorf("SessionFieldName() = %q, want %q", got, "ai_opencode_session")
	}
}

func TestOllamaProvider_SessionFieldName(t *testing.T) {
	p := &OllamaProvider{}
	if got := p.SessionFieldName(); got != "" {
		t.Errorf("SessionFieldName() = %q, want empty string", got)
	}
}

func TestOllamaProvider_ListModels_BinaryNotFound(t *testing.T) {
	p := &OllamaProvider{binary: "/nonexistent/ollama"}
	_, err := p.ListModels(context.Background())
	if err == nil {
		t.Error("expected error when binary not found")
	}
}

func TestOllamaProvider_ListAgents_ReturnsNil(t *testing.T) {
	p := &OllamaProvider{}
	agents, err := p.ListAgents(context.Background())
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if agents != nil {
		t.Errorf("expected nil, got %v", agents)
	}
}

func TestProviderRegistry_Get(t *testing.T) {
	registry := NewRegistry(&OllamaProvider{})
	got := registry.Get("ollama")
	if got == nil {
		t.Error("expected provider, got nil")
	}
	if got.Name() != "Ollama" {
		t.Errorf("Name() = %q, want %q", got.Name(), "Ollama")
	}
}

func TestProviderRegistry_Get_NotFound(t *testing.T) {
	registry := NewRegistry()
	got := registry.Get("nonexistent")
	if got != nil {
		t.Errorf("expected nil, got %v", got)
	}
}

func TestProviderRegistry_All(t *testing.T) {
	registry := NewRegistry(&OllamaProvider{}, &OpenCodeProvider{})
	all := registry.All()
	if len(all) != 2 {
		t.Errorf("All() returned %d providers, want 2", len(all))
	}
}

func TestLlmResponse_SessionID(t *testing.T) {
	resp := &LlmResponse{
		Text:      "hello",
		SessionID: "session123",
	}
	if resp.SessionID != "session123" {
		t.Errorf("SessionID = %q, want %q", resp.SessionID, "session123")
	}
}

func TestLlmModel_Fields(t *testing.T) {
	m := proto.LlmModel{
		ID:       "gpt-4",
		Provider: "openai",
		Name:     "GPT-4",
	}
	if m.ID != "gpt-4" {
		t.Errorf("ID = %q, want %q", m.ID, "gpt-4")
	}
	if m.Provider != "openai" {
		t.Errorf("Provider = %q, want %q", m.Provider, "openai")
	}
	if m.Name != "GPT-4" {
		t.Errorf("Name = %q, want %q", m.Name, "GPT-4")
	}
}

func TestLlmAgent_Fields(t *testing.T) {
	a := proto.LlmAgent{
		Name: "auto",
		Role: "primary",
	}
	if a.Name != "auto" {
		t.Errorf("Name = %q, want %q", a.Name, "auto")
	}
	if a.Role != "primary" {
		t.Errorf("Role = %q, want %q", a.Role, "primary")
	}
}
